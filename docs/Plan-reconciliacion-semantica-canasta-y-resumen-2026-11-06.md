# Análisis del planner subdividido y plan actualizado de canasta contextual

Fecha: 2026-11-06
Estado: análisis y diseño; no implementado
Alcance: revisar la división actual del planner y actualizar el plan para la selección iterativa de productos, la canasta y el resumen final.

## 1. Decisión principal

El planner actual **ya está subdividido funcionalmente**. No conviene crear un
nuevo planner por producto ni volver a concentrar en un único agente la
interpretación, la búsqueda, la selección, el cálculo y la mensajería.

La brecha observada es otra: después de que las herramientas devuelven
productos y evidencias, el runtime todavía puede escoger el primer producto
elegible o continuar con una canasta parcial sin una adjudicación contextual
de esas evidencias. El plan actualizado debe añadir una etapa acotada de
reconciliación de candidatos, reutilizando el estado, las herramientas y las
fases de checkout existentes.

La premisa de estabilidad es obligatoria:

- reutilizar `routeConversation`, `handleDeliveryOrder` y
  `handleOrderClarification`;
- reutilizar `orderDraft`, `checkoutProgress`, `basketKey`, las ofertas
  interactivas y la frontera de `ToolRegistry`;
- mantener las reglas de seguridad, políticas de WhatsApp, stock, precios y
  escalamiento humano fuera del razonamiento libre del modelo;
- no cambiar el esquema de PostgreSQL mientras el borrador JSON existente sea
  suficiente;
- habilitar el comportamiento nuevo con una bandera y conservar el camino
  actual como fallback;
- no desplegar ni modificar código como parte de este documento.

## 2. Evidencia revisada

La revisión se hizo contra el código ejecutable del repositorio, no solo contra
los documentos históricos.

| Evidencia | Hallazgo relevante |
| --- | --- |
| `server/services/llmPlanner.js` | Tiene una salida estructurada `ventas-ia-llm-plan.v2`, un adaptador de proveedores, recuperación/fallback y un compositor de respuestas separado. |
| `server/services/agentRuntime.js` | Orquesta la conversación, ejecuta herramientas, reconcilia el borrador, aplica políticas, crea ofertas, escala a humano y confirma pedidos. |
| `server/services/toolRegistry.js` | Es la frontera de catálogo, clientes, pedidos, Drive, WhatsApp, aprobaciones y telemetría. |
| `server/domain/orderCheckout.js` | Calcula fase, `basketKey`, revisión de canasta y bloqueo de confirmaciones obsoletas. |
| `docs/Arquitectura-y-funcionamiento-real-Ventas-IA.md` | Documenta el funnel real y el contrato del planner. |
| `docs/Arquitectura-profunda-app-y-agente.md` | Confirma la separación entre runtime, planner, herramientas y checkout. |
| `docs/Integracion-catalogo-enriquecido-2026-11-03.md` | Confirma que la búsqueda ya considera nombre, marca, alias, descripción, presentación, familia, etiquetas y atributos. |
| `docs/Correccion-consolidacion-antes-de-pago-20261103.md` | Confirma que la fase de revisión y el cierre de canasta ya existen y deben preservarse. |

## 3. Cómo está subdividido hoy

### 3.1 `LLMPlanner`: interpretación y composición, no ejecución de efectos

El servicio `server/services/llmPlanner.js` tiene actualmente estas
responsabilidades diferenciadas:

| Método o bloque | Responsabilidad actual | Resultado |
| --- | --- | --- |
| `plan(...)` | Construir el contexto del tenant, cliente, conversación, catálogo disponible y métodos de pago; llamar al proveedor o fallback; devolver interpretación estructurada. | Intención, comprensión, `candidateItems`, `toolPlan`, faltantes, estrategia, confianza, pedido y política comercial. |
| `apiStructuredParse(...)` | Resolver credencial, prompt y selección de proveedor. | Entrada al parser DeepSeek/Google. |
| `callChatCompletions` / `callGemini` | Adaptar la llamada externa y extraer uso, errores y metadatos. | Respuesta del proveedor y telemetría de tokens. |
| `mockStructuredParse(...)` y simuladores | Mantener continuidad local o de pruebas cuando el proveedor no está disponible. | Plan estructurado de fallback; no equivale al razonamiento productivo de DeepSeek. |
| `composeReply(...)` | Redactar la respuesta final con tono, nombre configurable del agente y hechos cerrados. | Texto para el cliente; fallback determinístico si el compositor no está habilitado. |
| Normalizadores y enriquecedores | Validar/coaccionar el JSON, conservar campos del contexto y normalizar la salida. | Contrato `ventas-ia-llm-plan.v2` consistente para el runtime. |

Por tanto, el planner no está haciendo directamente la lectura de Sheets, la
selección definitiva del SKU, el cálculo del subtotal, la escritura del pedido
ni el envío a WhatsApp. Esas decisiones están distribuidas en el runtime, las
herramientas y el dominio de checkout.

### 3.2 `AgentRuntime`: orquestación del ciclo de conversación

En `server/services/agentRuntime.js`, `routeConversation(...)` hace el
encadenamiento principal:

```text
mensaje normalizado
  -> idempotencia y conversación
  -> lookup de cliente
  -> LLMPlanner.plan
  -> política comercial y límites
  -> ruta por intención
  -> herramientas de catálogo/perfil/Drive
  -> reconciliación del orderDraft
  -> checkoutProgress
  -> composeReply y/o oferta interactiva
  -> outbox/WhatsApp y telemetría
```

Las rutas ya están separadas por intención y operación:

- `handleGreeting`: saludo y apertura contextual;
- `handleCatalogQuery`: consulta de disponibilidad/precio;
- `handleDeliveryOrder`: armado y actualización de la canasta;
- `handleOrderClarification`: respuestas, cambios, adiciones y correcciones;
- `handleOrderConfirmation`: escritura y escalamiento para preparación;
- `handleInteractiveReply`: botones, pago, continuar, ajustar y humano;
- `handleHumanRequest`/resolución manual: intervención del tendero;
- `composeCustomerReply`: paso final de redacción.

Esto confirma que la división realizada la semana anterior no se perdió. El
runtime es el coordinador y el planner es el intérprete; no son la misma
responsabilidad.

### 3.3 `ToolRegistry`: evidencia y efectos externos

`server/services/toolRegistry.js` concentra las llamadas a Google, Drive,
WhatsApp, aprobaciones, persistencia transaccional y handoff. Cada llamada
puede emitir `started`, `completed` o `failed` y conservar su duración.

La lectura del catálogo ya devuelve, cuando existen, estos campos: SKU, nombre,
precio, stock, categoría, marca, presentación, presentación normalizada,
descripción, etiquetas, familia, atributos, origen y referencia de Drive.

La clasificación local de resultados (`rankRowsByQuery`) combina nombre, marca,
SKU, familia, alias, categoría, presentación, descripción, atributos y
etiquetas. La búsqueda, por tanto, no es el cuello de botella conceptual que
debe reemplazarse por una regla nueva.

### 3.4 `orderCheckout.js`: estado comercial y seguridad de la canasta

El dominio actual ya aporta:

- `basketKey` para identificar la versión exacta de la canasta;
- detección de productos sin SKU/precio/total o sin disponibilidad;
- fases `collecting`, `review`, `payment` y `confirmation`;
- invalidación de una revisión cuando cambia la canasta;
- protección contra botones o confirmaciones de una versión anterior.

Este estado debe ser la base del nuevo comportamiento. No se debe crear otra
máquina de estados paralela.

## 4. Brecha real encontrada

### 4.1 El planner propone candidatos, pero no existe adjudicación posterior

`LLMPlanner.plan(...)` puede identificar varios `candidateItems` y proponer
filtros. Después, `handleDeliveryOrder(...)` ejecuta las lecturas de catálogo
en paralelo y llama a `selectAcceptableOrderProduct(...)`.

La selección actual es demasiado permisiva para los casos ambiguos:

- filtra productos aceptables;
- si no hay una presentación solicitada, toma el primer elegible;
- si la presentación solicitada no coincide, puede terminar usando el primer
  elegible disponible;
- `presentationOptionsForItem(...)` se usa para texto de alternativas, pero no
  constituye todavía una selección interactiva por línea de producto;
- las ofertas interactivas existentes representan acciones de checkout
  (`Continuar pedido`, `Agregar productos`, `Hablar con la tienda` y luego
  confirmación), no la elección de una variante concreta.

La consecuencia es que el sistema puede haber buscado bien y, sin embargo,
mostrar una sola opción, perder alternativas o construir un resumen antes de
que todas las líneas estén resueltas.

### 4.2 La búsqueda rica no llega completa a la decisión conversacional

La herramienta devuelve descripción, presentación, familia y atributos, pero el
camino de selección definitivo usa principalmente el SKU sugerido, el nombre,
la presentación y la elegibilidad. Falta un paso que entregue al LLM, en un
solo paquete por turno, la evidencia de todas las líneas:

- solicitud original y consulta inferida;
- candidatos ordenados y sus scores/tipos de coincidencia;
- presentación, descripción, familia y atributos;
- precio y stock;
- restricciones de la tienda;
- canasta existente y cambios recientes;
- pregunta pendiente y respuestas ya dadas.

### 4.3 El resumen final aún mezcla hechos en un párrafo

`buildOrderReply(...)` arma texto con productos y subtotal, mientras el
compositor puede normalizar espacios. Esto es útil como fallback breve, pero no
garantiza el formato solicitado de nombre, dirección, una fila por producto,
precio unitario, subtotal, domicilio, total y pago.

El LLM debe aportar naturalidad y tono, no hacer cálculos ni decidir la
estructura factual. La presentación final debe ser un renderer basado en datos
confirmados por la canasta, con texto contextual alrededor.

## 5. Alternativas consideradas

### Alternativa A: dividir el planner en un agente por producto

No recomendada. Aumentaría llamadas, tokens, coordinación, carreras y riesgo de
que cada agente pierda el contexto global. También duplicaría responsabilidades
que ya están resueltas por `AgentRuntime` y `orderCheckout`.

### Alternativa B: nuevo flujo determinístico de preguntas

No recomendada como solución principal. Podría corregir algunos casos, pero
volvería a introducir árboles rígidos y perdería modismos, correcciones,
respuestas sobre varias líneas y cambios de intención.

### Alternativa C: bucle ReAct abierto

No recomendado en esta etapa. Un bucle sin límite podría mejorar exploración,
pero elevaría latencia, costo y dificultad de auditoría. La conversación ya
tiene una frontera de herramientas y un planner estructurado.

### Alternativa D: reconciliación contextual acotada después de las herramientas

**Recomendada.** Mantiene la subdivisión actual y añade una sola etapa
condicional, por lote de mensaje:

```text
LLMPlanner.plan existente
  -> búsquedas existentes en paralelo
  -> evidencia completa por línea
  -> LLM adjudicador solo si hace falta
  -> orderDraft existente
  -> checkoutProgress existente
  -> renderer factual + composeReply
```

Si hay una coincidencia única, suficiente y compatible con la solicitud, se
evita una segunda llamada al LLM. Si hay dos o más alternativas, atributos
incompatibles, producto ausente, stock insuficiente o cambio de canasta, se
hace una sola adjudicación contextual para todas las líneas pendientes. La
respuesta puede seleccionar, preguntar, conservar una duda o escalar a humano.

## 6. Plan actualizado de implementación

### Fase 0 — Instrumentación y contrato, sin alterar el camino actual

1. Capturar en la traza de cada línea el `rawName`, `catalogQuery`, filtros,
   `source_revision`, número de candidatos, `matchScore`, `matchType`, stock y
   presentación.
2. Registrar si la decisión provino de coincidencia única, adjudicación LLM,
   fallback o humano.
3. Añadir `basketRevision` derivada del `basketKey` y correlacionarla con cada
   oferta y respuesta.
4. Verificar que la telemetría distinga `llm/plan`, `llm/catalog_adjudication`
   y `llm/reply`. La ausencia de un log no debe interpretarse como ausencia de
   llamada cuando el umbral de logging solo registra operaciones lentas o con
   error.

Archivos candidatos:

- `server/services/runtimeTelemetry.js`;
- `server/services/toolRegistry.js`;
- `server/services/agentRuntime.js`;
- pruebas de contrato de telemetría existentes.

### Fase 1 — Estado de selección dentro del borrador existente

Sin migración inicial de base de datos, extender el JSON de `orderDraft` con
campos compatibles:

```json
{
  "basketRevision": "derivada-de-basketKey",
  "items": [
    {
      "lineId": "estable-por-linea",
      "rawName": "texto original",
      "quantity": 1,
      "selectionStatus": "selected|pending|not_found|handoff",
      "product": "solo si fue seleccionado con evidencia",
      "candidates": [],
      "selectionEvidence": [],
      "lastQuestion": null
    }
  ],
  "pendingSelections": [],
  "lastSelectionQuestion": null
}

## 8. Implementación local realizada

La primera iteración del plan quedó implementada localmente, sin despliegue ni
modificación de datos de producción:

- `server/services/catalogResolutionService.js` añade una reconciliación
  acotada por lote. Reutiliza el planner existente y solo permite seleccionar
  entre candidatos devueltos por el catálogo.
- `server/services/llmPlanner.js` incorpora
  `adjudicateCatalogCandidates(...)`, con una llamada adicional únicamente
  cuando existen varias evidencias para una línea. El contrato no permite
  inventar SKU, precio o stock, y registra `llm/catalog_adjudication`.
- `server/services/agentRuntime.js` conserva la búsqueda paralela y añade
  `lineId`, `selectionStatus`, candidatos compactos, ofertas interactivas de
  selección y reconciliación con `orderDraft`/`basketKey` existentes.
- `server/services/agentRuntime.js` también usa un renderer factual de resumen
  con cliente, dirección, filas de producto, precio unitario, total de línea,
  subtotal, pago y pregunta de continuación/confirmación. El compositor ya no
  aplana los saltos de línea.
- `server/config.js` añade `CONTEXTUAL_PRODUCT_SELECTION_V2`. El valor por
  defecto es `false` para conservar el camino estable; se habilita localmente
  con `CONTEXTUAL_PRODUCT_SELECTION_V2=true` o mediante la configuración del
  runtime.
- `server/tests/catalog-selection-reconciliation.mjs` cubre la ambigüedad,
  la oferta de opciones, la selección y el resumen estructurado.
- `server/tests/llm-provider.mjs` verifica el contrato real del adjudicador
  contra el adaptador DeepSeek con una respuesta de proveedor controlada.

La selección contextual es deliberadamente una sola llamada por lote; no se
creó un planner por producto ni un bucle ReAct abierto. Si la llamada falla,
la evidencia queda pendiente para aclaración segura y el camino legacy continúa
disponible cuando la bandera está apagada.

## 9. Validación ejecutada

Se ejecutaron localmente, sin WhatsApp real ni datos de producción:

- `npm run test:checkout`
- `npm run test:catalog`
- `node server/tests/agent-runtime-quote-continuity.mjs`
- `node server/tests/llm-provider.mjs`
- `node server/tests/agent-runtime-greeting.mjs`

Los contratos ejecutados pasaron. La prueba de continuidad confirmó además que
una salida LLM que trae un precio incorrecto no puede sustituir el precio
verificado del catálogo cuando se conserva el SKU.
```

No se deben guardar como producto confirmado los candidatos que solo son
hipótesis. `product`, precio y stock deben proceder del resultado de la
herramienta o de una edición humana autorizada.

Archivos candidatos:

- `server/services/agentRuntime.js`;
- `server/domain/orderCheckout.js`;
- `server/store/jsonStore.js` y `server/store/postgresStore.js` solo si la
  persistencia actual no conserva el JSON completo.

### Fase 2 — Reconciliación contextual en lote

Crear una etapa estrecha, no un planner paralelo por producto. La opción
preferida es un `CatalogResolutionService` que:

1. recibe las hipótesis del planner y los resultados de `ToolRegistry`;
2. agrupa todas las líneas pendientes de la misma conversación;
3. determina si existe evidencia suficiente para evitar otra llamada;
4. cuando sea necesario, solicita al LLM una adjudicación estructurada;
5. devuelve únicamente decisiones sobre candidatos proporcionados, nunca
   productos inventados ni valores calculados;
6. conserva la duda y formula una pregunta concreta o crea handoff cuando la
   evidencia no alcanza.

El contrato propuesto para la adjudicación es:

```json
{
  "decisions": [
    {
      "lineId": "...",
      "action": "select|ask|preserve|remove|handoff",
      "selectedSku": null,
      "reason": "...",
      "question": null,
      "confidence": 0
    }
  ],
  "collectionStatus": "ready|pending|partial|handoff"
}
```

El modelo puede interpretar `litro y medio`, errores ortográficos, modismos,
respuestas cortas y referencias como “la grande” usando el contexto y la
evidencia. El backend conserva límites duros:

- `selectedSku` debe estar entre los candidatos devueltos;
- el precio y el stock no vienen del LLM;
- no se confirma una línea con stock insuficiente;
- atributos incompatibles no se silencian;
- productos restringidos, comprobantes, pagos confirmados y baja confianza
  conservan el handoff existente;
- una respuesta de un botón solo aplica a la revisión de canasta vigente.

Archivos candidatos:

- nuevo `server/services/catalogResolutionService.js`;
- `server/services/agentRuntime.js` para integrarlo después de la lectura de
  catálogo y antes de mutar la canasta;
- `server/services/llmPlanner.js` únicamente para reutilizar el adaptador de
  proveedor y el contrato estructurado, sin moverle la responsabilidad de
  ejecutar herramientas;
- `server/services/toolRegistry.js` para asegurar que la evidencia completa se
  conserve.

### Fase 3 — Selección conversacional sin flujo rígido

Reutilizar las ofertas de WhatsApp y extenderlas con una acción por selección
solo cuando el canal y la respuesta lo soporten. Para mensajes libres, el LLM
debe interpretar respuestas como:

- “la de litro y medio”;
- “la primera y el segundo también”;
- “cámbiame esa por la pequeña”;
- “agrega el pan”;
- “no, solo la Coca”.

La acción no debe depender únicamente de palabras clave. El contexto de la
pregunta pendiente, `lineId`, candidatos y `basketRevision` es la referencia.
Si el cliente responde por varias líneas, la adjudicación debe actualizar la
canasta en una sola operación y volver a revisar el conjunto completo.

Archivos candidatos:

- `server/services/agentRuntime.js`;
- `server/services/whatsappCommercePolicy.js` y ofertas existentes solo si
  requieren compatibilidad de canal;
- `src/App.jsx` únicamente si el tendero necesita ver candidatos y decisiones
  pendientes en la consola.

### Fase 4 — Renderer factual del resumen

Separar la construcción factual del resumen de la redacción del LLM. El
renderer debe recibir únicamente líneas seleccionadas y generar:

```text
Pedido para domicilio
Cliente: <nombre>
Dirección: <dirección>

Productos
1 x <producto/presentación> — $<precio unitario> = $<subtotal línea>
1 x <producto/presentación> — $<precio unitario> = $<subtotal línea>

Subtotal productos: $<subtotal>
Domicilio: $<costo configurado>
Total: $<total>
Pago: <medio>
```

El LLM puede adaptar el saludo, tono y llamada a la acción, pero no alterar
cantidades, precios, domicilio, total, dirección, forma de pago ni líneas. Se
debe revisar el comportamiento actual de `validateComposedReply`, porque la
normalización de espacios puede eliminar saltos de línea útiles para este
resumen. Este ajuste pertenece a la implementación, no a este análisis.

### Fase 5 — Despliegue gradual y pruebas

1. Activar con una bandera propuesta, por ejemplo
   `CONTEXTUAL_PRODUCT_SELECTION_V2=false` por defecto.
2. Ejecutar primero los contratos locales y los 50 casos existentes.
3. Comparar contra el camino actual en modo observación, sin duplicar envíos a
   WhatsApp ni escribir pedidos dos veces.
4. Habilitar por tenant demo y revisar latencia, costo, candidatos, preguntas
   repetidas y escalaciones.
5. Solo después promover la bandera; mantener fallback y rollback inmediato.

## 7. Manejo de mensajes consecutivos y concurrencia

La estrategia debe consolidar una ráfaga de mensajes sin retrasar de forma
perceptible la primera respuesta:

- reclamar cada `messageId` con la idempotencia existente;
- trabajar sobre la última versión conocida de la conversación;
- agrupar mensajes pendientes solo dentro de una ventana corta y trazable,
  nunca esperar indefinidamente;
- usar `basketKey`/`basketRevision` para detectar una respuesta obsoleta;
- persistir primero la decisión de canasta y luego producir el efecto externo;
- si dos mensajes compiten, replanear sobre el estado más reciente en vez de
  aplicar parches ciegos;
- conservar outbox y reintentos para que una falla de WhatsApp no repita el
  pedido ni la selección.

La ventana de consolidación y el máximo de llamadas al LLM deben ser
configurables. El límite inicial recomendado es una adjudicación adicional por
turno, con timeout y fallback a pregunta/handoff, no un bucle ilimitado.

## 8. Latencia y costos

La segunda llamada al LLM no debe ejecutarse siempre. Solo procede cuando:

- hay más de una alternativa razonable;
- falta una presentación, marca, sabor o atributo que cambia la selección;
- el catálogo devuelve resultados parciales o incompatibles;
- el mensaje modifica una línea ya resuelta;
- hay una ráfaga que cambia la intención o la canasta.

En una coincidencia única con evidencia suficiente, el camino sigue siendo una
sola interpretación más la búsqueda existente. En una adjudicación por lote,
se envían todas las líneas en una sola llamada, con candidatos resumidos y sin
repetir el catálogo completo innecesariamente.

Se deben medir por caso:

- tiempo de cola, búsqueda, adjudicación, composición y envío;
- llamadas y tokens por etapa;
- porcentaje de adjudicación omitida por coincidencia clara;
- porcentaje de selección, pregunta, parcial y handoff;
- respuestas repetidas, botones obsoletos y reintentos.

## 9. Criterios de aceptación

La implementación futura solo se considera lista si cumple todo lo siguiente:

- no regresa el primer producto cuando existen alternativas relevantes;
- usa descripción, presentación, familia, etiquetas y atributos como evidencia
  cuando están presentes;
- permite resolver varias líneas en una respuesta del cliente;
- conserva cantidades, selecciones y cambios sin duplicar productos;
- no vuelve a preguntar un dato ya confirmado;
- permite agregar, sustituir, quitar y corregir productos durante la canasta;
- no solicita pago ni confirma mientras haya selección pendiente;
- el resumen muestra nombre, dirección, una fila por producto, precio unitario,
  subtotal de línea, subtotal, domicilio, total y pago;
- el LLM no inventa SKU, precio, stock, domicilio ni disponibilidad;
- baja evidencia, ausencia, stock insuficiente y restricciones escalan según la
  política vigente;
- botones y mensajes solo operan sobre la versión actual de la canasta;
- la suite de 50 casos no empeora y los casos de supermercado se reproducen;
- la latencia se mantiene dentro del presupuesto operativo actual y la
  adjudicación adicional queda visible en telemetría;
- el fallback existente sigue funcionando si DeepSeek no responde.

## 10. Archivos que no se deben cambiar en la primera iteración

No se propone modificar de entrada migraciones PostgreSQL, contratos de Meta,
autenticación, configuración de tenants, infraestructura de Render/Supabase ni
la lógica de precios y stock. Tampoco se debe reemplazar el planner actual ni
el catálogo enriquecido.

Solo si las pruebas demuestran una limitación concreta se evaluarán cambios
acotados en persistencia, UI del tendero o payload de botones.

## 11. Conclusión

La separación existente es la dirección correcta: el planner interpreta, el
runtime coordina, las herramientas aportan evidencia y checkout gobierna el
estado comercial. El ajuste recomendado no es volver a subdividir por
responsabilidad ni convertir el sistema en un ReAct abierto. Es añadir una
reconciliación contextual, acotada y observable después de las búsquedas,
seguida de un renderer factual del resumen.

Este documento actualiza el plan con esa realidad del repositorio.

## 12. Implementación local de la primera iteración

Se implementó una primera iteración acotada y reversible, reutilizando el
planner subdividido existente, `AgentRuntime`, `orderDraft`, `checkoutProgress`,
las herramientas actuales de catálogo y los botones ya soportados:

- `server/services/catalogResolutionService.js`: reconciliación contextual por
  lote de candidatos ambiguos. Hace una sola adjudicación opcional, valida que
  el SKU elegido pertenezca a la evidencia del catálogo y conserva fallback a la
  ruta anterior.
- `server/services/agentRuntime.js`: integra la reconciliación después de las
  búsquedas, conserva `catalogCandidates` y `selectionStatus` en el borrador,
  ofrece botones por producto, procesa la selección contra `basketKey` y
  `lineId`, y genera un resumen estructurado factual.
- `server/services/llmPlanner.js`: agrega la operación acotada
  `adjudicateCatalogCandidates`, con contrato JSON, evidencia obligatoria,
  límite de tokens, timeout y telemetría separada. También conserva saltos de
  línea del resumen estructurado.
- `server/config.js`: agrega `contextualProductSelectionV2`, desactivada por
  defecto para preservar el comportamiento actual.
- `server/tests/catalog-selection-reconciliation.mjs`: cubre ambigüedad,
  opciones, selección de botón, canasta y resumen.
- `server/tests/llm-provider.mjs`: cubre el contrato real del adjudicador sin
  enviar mensajes ni llamar un proveedor externo durante la prueba.
- `package.json`: incluye la nueva prueba en `test:catalog`.

La bandera se activa localmente mediante `CONTEXTUAL_PRODUCT_SELECTION_V2=true`
o mediante `contextualProductSelectionV2: true` en el fixture de prueba. No se
activó en producción, no se modificó la base de datos, no se enviaron mensajes
reales y no se desplegó.

## 13. Validación realizada

Pasaron localmente:

- `node server/tests/catalog-selection-reconciliation.mjs`
- `npm run test:catalog`
- `npm run test:checkout`
- `node server/tests/agent-runtime-quote-continuity.mjs`
- `node server/tests/llm-provider.mjs`
- `node server/tests/agent-runtime-greeting.mjs`
- `npm run test:backend` (incluye 50 escenarios de Colombia y contratos de
  Google/WhatsApp)

También pasaron las comprobaciones sintácticas de los servicios modificados y
`git diff --check`. La bandera queda pendiente de una decisión explícita de
activación por entorno; no se habilitó producción.
