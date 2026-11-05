# Propuesta de descomposición del planner y grounding progresivo del LLM

Fecha: 2026-11-04
Estado: implementación local parcial bajo feature flag; pausada para incorporar y revisar la política de domicilios por tenant (§14), sin habilitación productiva
Alcance: interpretación conversacional, búsqueda de catálogo, consultas comerciales y condiciones de domicilio por tenant

## 1. Objetivo

Recuperar y fortalecer la capacidad de VIA para interpretar mensajes comerciales reales, incluyendo errores ortográficos, modismos colombianos, nombres incompletos, presentaciones implícitas y mensajes consecutivos, sin convertir el flujo en un árbol determinístico ni perder las validaciones de negocio.

La propuesta mantiene la separación entre interpretación y hechos comerciales, pero agrega una etapa de grounding progresivo:

```text
Interpretar → buscar → observar resultados → reevaluar → resolver o preguntar
```

El LLM debe decidir la interpretación y la siguiente acción conversacional. El backend debe seguir validando hechos que no pueden inventarse: tenant, SKU, precio, stock, estado activo, permisos y políticas.

## 2. Diagnóstico cruzado con el repositorio

### 2.1 Responsabilidades actuales de `LLMPlanner`

`server/services/llmPlanner.js` actualmente concentra responsabilidades que deberían estar separadas:

1. Construcción del contexto del tenant y configuración del proveedor.
2. Selección de DeepSeek, Gemini o simuladores.
3. Resolución de secretos, timeout y reintentos.
4. Construcción del prompt de interpretación.
5. Ejecución del intérprete semántico.
6. Normalización y conversión de `semantic-frame` a plan legado.
7. Sobrescrituras de intención mediante `coercePlanWithConversation`.
8. Fallback heurístico y simuladores locales.
9. Composición de la respuesta final.
10. Registro de eventos y uso de tokens.

El archivo ya delega parte de la interpretación en `server/services/semanticInterpreter.js`, pero `LLMPlanner` sigue funcionando como fachada, gateway de proveedor, compatibilidad, fallback, composer y telemetría al mismo tiempo.

### 2.2 Punto donde se pierde el razonamiento contextual

El prompt productivo de `buildPlannerPrompt` recibe el mensaje, historial y estado del pedido, pero no recibe el catálogo real ni sus candidatos. El código incluso documenta que los productos son una dependencia del simulador/fallback y no del prompt productivo.

Por tanto, el modelo puede inferir:

- `Browine` → `Brownie`;
- `litro y medio` → `1.5 L`;
- `Pon que` → `Ponque`;

pero no puede contrastar esas hipótesis con la evidencia del catálogo antes de terminar su decisión.

### 2.3 Búsqueda y resolución actuales

`server/services/toolRegistry.js` carga los campos enriquecidos del catálogo, incluyendo `atributos_json`, pero `rankRowsByQuery` no incorpora completamente el objeto `attributes` en el ranking.

`server/domain/semanticContracts.js` conserva la hipótesis del LLM, pero la consulta prioriza el texto original del cliente y la validación de evidencia ortográfica es demasiado estricta para errores como `Browine`/`Brownie`.

`server/services/agentRuntime.js` tiene dos caminos distintos:

- `handleCatalogQuery`: toma candidatos y puede presentar la primera fila sin aplicar toda la resolución semántica.
- `handleDeliveryOrder`: usa `resolveCatalogItem`, pero puede escalar cuando hay variantes con la misma presentación y no siempre genera opciones.

Esto provoca que una misma frase produzca resultados diferentes según haya sido clasificada como consulta de catálogo o pedido.

### 2.4 Reglas que pueden sobrescribir al LLM

`coercePlanWithConversation` puede cambiar la intención con heurísticas como:

- `looksLikePurchaseRequest`;
- `isAvailabilityOrOptionsQuestion`;
- `planHasConcreteQuantity`;
- detección de método de pago;
- detección de reclamaciones.

Algunas protecciones son necesarias, pero no deben actuar como un segundo intérprete silencioso. La propuesta las divide entre:

- validaciones de integridad y seguridad, que permanecen en backend;
- decisiones semánticas, que deben volver al LLM.

## 3. Casos que la propuesta debe resolver

### Coca-Cola litro y medio

El catálogo contiene `BOG-BEB-044`, Coca-Cola original de 1.5 L, con alias `coca litro y medio`. También contiene Coca-Cola Sin Azúcar de 1.5 L y otras presentaciones.

El agente debe reconocer la intención, consultar el catálogo, observar las variantes y decidir entre:

- seleccionar la original si la evidencia contextual es suficientemente clara;
- presentar opciones originales/sin azúcar;
- pedir una aclaración.

No debe escalar solamente porque existen dos productos con la misma presentación.

### Pon que Ramo tradicional

El catálogo contiene Ponque Chocoramo, alias `ponque ramo`, y otros productos Ramo. El LLM debe corregir `Pon que`, pero no debe asumir qué significa `tradicional` si existen varias coincidencias.

Debe presentar opciones significativas o hacer una pregunta concreta.

### Browine Mamai de arequipe

El catálogo actual no contiene Brownie Mamai. La búsqueda puede encontrar productos que contienen `arequipe`, pero no existe evidencia suficiente para sustituir el producto solicitado.

El flujo debe permitir una reformulación limitada y luego:

- informar que la referencia no está en el catálogo;
- escalar al tendero;
- conservar la solicitud original para no perderla.

Nunca debe confirmar Arequipe Alpina como si fuera Brownie Mamai.

## 4. Arquitectura objetivo

```text
Meta / WhatsApp
      ↓
Recepción, idempotencia y coalescencia de mensajes
      ↓
SemanticInterpreter
      ↓
SemanticFrameValidator
      ↓
ConversationGroundingCoordinator
      ├─ genera búsqueda inicial
      ├─ consulta catálogo del tenant
      ├─ entrega candidatos al LLM
      ├─ reformula una vez si es necesario
      └─ decide resolver, preguntar o escalar
      ↓
CatalogPolicyGuard
      ↓
Memoria, pedido y estado conversacional
      ↓
ReplyComposer
      ↓
Meta / WhatsApp
```

El `LLMPlanner` existente se conserva inicialmente como fachada para no romper el runtime, pero deja de concentrar todos los detalles internos.

## 5. Archivos existentes que se modificarían

### `server/services/llmPlanner.js`

Objetivo del cambio:

- conservar `plan()` como API compatible para `agentRuntime`;
- delegar proveedor, retries y timeout a un gateway;
- delegar interpretación a `SemanticInterpreter`;
- reemplazar las sobrescrituras semánticas silenciosas por un guard de integridad;
- mantener los eventos y el registro de uso;
- dejar `composeReply()` temporalmente disponible por compatibilidad, pero preparar su extracción posterior.

No debe:

- ejecutar búsquedas de catálogo;
- elegir SKU;
- decidir precio o stock;
- contener la lógica de reformulación de búsquedas.

### `server/services/semanticInterpreter.js`

Objetivo del cambio:

- mantener una interpretación global por turno;
- ampliar el contrato para incluir variantes de consulta sugeridas por el LLM;
- conservar el texto original y las hipótesis corregidas;
- incluir evidencia lingüística breve, no cadena de pensamiento privada;
- distinguir entre hipótesis de producto, presentación y atributo.

Ejemplo de salida conceptual:

```json
{
  "rawText": "Browine Mamai de arequipe",
  "productHypothesis": "Brownie Mamai de Arequipe",
  "queryVariants": [
    "Brownie Mamai de Arequipe",
    "Brownie de Arequipe"
  ],
  "confidence": 0.78,
  "ambiguity": "La referencia no está confirmada en el catálogo"
}
```

El intérprete no debe generar SKU, precio, stock ni confirmar un producto.

### `server/domain/semanticContracts.js`

Objetivo del cambio:

- ampliar los contratos semánticos y de grounding;
- separar `rawText`, `productHypothesis`, `queryVariants` y `catalogEvidence`;
- permitir correcciones ortográficas acotadas para generar candidatos;
- conservar calificadores que no hayan sido comprobados;
- permitir que el resolutor diferencie variantes de presentación y variantes de producto.

La similitud ortográfica solo debe generar candidatos. Nunca debe ser suficiente por sí sola para confirmar un producto.

### `server/services/toolRegistry.js`

Objetivo del cambio:

- incluir atributos normalizados en la búsqueda y el ranking;
- ponderar por separado nombre, marca, alias, presentación, descripción, familia, etiquetas y atributos;
- devolver evidencia por campo, no únicamente un `matchScore` agregado;
- soportar consultas alternativas de una misma hipótesis;
- mantener el aislamiento por `tenantId`.

Salida conceptual de una coincidencia:

```json
{
  "sku": "BOG-BEB-044",
  "matchScore": 13.5,
  "evidence": {
    "alias": ["coca litro y medio"],
    "presentation": ["1.5 L"],
    "brand": ["Coca-Cola"]
  },
  "attributes": {
    "volumen_ml": 1500
  }
}
```

### `server/domain/catalogResolver` o módulo equivalente actual

Si la función `resolveCatalogItem` permanece en `semanticContracts.js`, se debe extraer gradualmente la resolución de dominio a un módulo específico sin duplicar reglas.

Objetivo del cambio:

- recibir candidatos y evidencia, no solamente filas ordenadas;
- representar explícitamente `resolved`, `needs_selection`, `human_review`, `unavailable` y `refine_search`;
- reconocer variantes con la misma presentación, como original/sin azúcar;
- devolver opciones reales cuando existan;
- no sustituir calificadores no encontrados.

### `server/services/agentRuntime.js`

Objetivo del cambio:

- centralizar la búsqueda de catálogo de consultas y pedidos mediante el nuevo coordinador;
- evitar que `handleCatalogQuery` seleccione directamente la primera fila;
- reutilizar la misma resolución para pedido, cotización y consulta;
- conservar el estado del pedido y sus `rawItemId`;
- permitir que un mensaje posterior agregue, modifique o aclare productos;
- ejecutar efectos comerciales solo después del `CatalogPolicyGuard`.

No debe decidir por palabras clave si el cliente quiere agregar o confirmar. Debe recibir una decisión contextual estructurada.

### `server/config.js`

Objetivo del cambio:

- agregar configuración opcional y documentada para el ciclo grounding;
- número máximo de rondas;
- timeout por ronda;
- habilitación gradual mediante feature flag;
- límites de tokens del intérprete y del resolutor.

Valores iniciales sugeridos:

```text
LLM_GROUNDING_ENABLED=false
LLM_GROUNDING_MAX_ROUNDS=2
LLM_GROUNDING_REFORMULATIONS=1
LLM_GROUNDING_TIMEOUT_MS=<valor validado por pruebas>
```

Los valores deben comenzar desactivados en producción hasta finalizar las pruebas E2E.

## 6. Archivos nuevos propuestos

### `server/domain/groundingContracts.js`

Nuevo contrato puro para:

- `GroundingRequest`;
- `CatalogObservation`;
- `GroundingDecision`;
- `GroundingTrace`.

Debe definir estados, acciones permitidas y validaciones de estructura sin llamar proveedores ni herramientas.

### `server/services/llmProviderGateway.js`

Nuevo adaptador para:

- DeepSeek;
- Gemini si permanece habilitado;
- timeout;
- retries;
- metadatos de tokens;
- clasificación de errores;
- proveedor activo.

Esto evita que `LLMPlanner` mezcle transporte con interpretación.

### `server/services/conversationGroundingCoordinator.js`

Nuevo orquestador del ciclo progresivo.

Responsabilidades:

1. recibir el `semantic-frame`;
2. preparar la consulta inicial;
3. invocar `google_sheets_read_table` con el tenant actual;
4. entregar candidatos al LLM;
5. ejecutar como máximo una reformulación adicional;
6. producir una decisión estructurada;
7. devolver evidencias y trazas al runtime.

No debe enviar mensajes ni actualizar pedidos directamente.

### `server/services/groundedDecisionAgent.js`

Nuevo adaptador de prompt y respuesta para el LLM que observa resultados de catálogo.

Debe recibir:

- semantic frame;
- pedido actual;
- mensajes recientes;
- candidatos reales;
- evidencia por campo;
- opciones permitidas.

Debe devolver únicamente una acción estructurada, nunca una operación libre sobre la base de datos o Google Sheets.

### `server/services/llmReplyComposer.js`

Extracción posterior, no necesariamente obligatoria en la primera iteración.

Su objetivo es mover `composeReply()` fuera de `LLMPlanner`, manteniendo:

- tono por tenant;
- nombre del agente;
- validación de términos obligatorios;
- fallback seguro;
- métricas de tokens y duración.

## 7. Componentes que no deben modificarse estructuralmente

No se propone cambiar en esta etapa:

- el esquema de PostgreSQL;
- el contrato principal del webhook de Meta;
- la separación de datos por tenant;
- Google Drive/Sheets como catálogo operativo;
- el flujo de outbox y envío a Meta;
- el frontend, salvo que sea necesario mostrar nuevas opciones ya soportadas por el backend.

La primera implementación debe ser backend-only y estar protegida por feature flag.

## 8. Límites para evitar un ReAct incontrolado

El ciclo progresivo debe cumplir:

1. máximo dos rondas de búsqueda por turno;
2. máximo una reformulación automática;
3. solo herramientas permitidas por el coordinador;
4. solo selección entre candidatos reales;
5. no exponer el razonamiento privado del modelo;
6. registrar un resumen estructurado de la decisión;
7. cancelar el ciclo si el cliente solicita humano;
8. cancelar el ciclo si el estado de la conversación cambió por concurrencia;
9. no confirmar pedidos si falta información obligatoria;
10. no enviar una respuesta parcial si ya existe una ráfaga pendiente por consolidar.

## 9. Observabilidad requerida

Cada turno debe registrar:

- `traceId`;
- `tenantId`;
- `conversationId`;
- mensaje y lote de mensajes interpretados;
- intención inicial;
- hipótesis de productos;
- consultas ejecutadas;
- ronda de búsqueda;
- candidatos y evidencia;
- acción propuesta por el LLM;
- validación del backend;
- resultado final;
- uso de fallback;
- tokens de entrada y salida;
- duración por etapa;
- número de llamadas a herramientas;
- motivo de escalamiento.

Eventos sugeridos:

```text
llm.interpretation.created
catalog.grounding.started
catalog.grounding.observed
catalog.grounding.refined
llm.grounded_decision.created
catalog.grounding.rejected
conversation.action.selected
llm.plan.fallback
llm.reply.fallback
```

## 10. Plan de implementación

### Fase 0: línea base

- No cambiar comportamiento.
- Ejecutar los casos de Coca-Cola, Ramo, Brownie Mamai, mensajes consecutivos y ambigüedad.
- Capturar planner, catálogo, resolver, composer y tiempos.
- Confirmar cuántos casos usan fallback.

### Fase 1: contratos y gateway

- Crear `groundingContracts.js`.
- Extraer proveedor/retries a `llmProviderGateway.js`.
- Mantener `LLMPlanner` como fachada.
- No cambiar todavía la decisión comercial.

### Fase 2: recuperación enriquecida

- Incorporar atributos al ranking.
- Devolver evidencia por campo.
- Admitir consultas alternativas de la hipótesis del LLM.
- Agregar pruebas unitarias de ranking y atributos.

### Fase 3: grounding progresivo

- Crear `conversationGroundingCoordinator.js`.
- Crear `groundedDecisionAgent.js`.
- Activar únicamente en pruebas locales mediante feature flag.
- Comparar contra el flujo actual sin reemplazarlo todavía.

### Fase 4: integración del runtime

- Unificar `handleCatalogQuery` y `handleDeliveryOrder` alrededor del coordinador.
- Conservar los estados y contratos existentes.
- Activar resolución interactiva para variantes reales.

### Fase 5: validación E2E

- Ejecutar los 40 casos existentes y los casos adicionales de semántica.
- Comparar exactitud, escalamiento, latencia y tokens.
- Revisar especialmente falsos positivos y sustituciones indebidas.

### Fase 6: extracción del composer

- Mover `composeReply()` a `llmReplyComposer.js`.
- Mantener respuestas fallback seguras.
- Activar en producción solo cuando la telemetría sea estable.

## 11. Criterios de aceptación

La propuesta se considerará exitosa si:

- `Coca Cola litro y medio` resuelve o presenta opciones correctas;
- `Pon que Ramo tradicional` solicita una aclaración útil;
- `Browine Mamai de arequipe` no se sustituye por Arequipe;
- se utilizan descripción y atributos del catálogo;
- la misma lógica funciona para consulta y pedido;
- los mensajes consecutivos se interpretan como una unidad contextual;
- se conservan adiciones, modificaciones y confirmaciones;
- el LLM puede solicitar una reformulación de búsqueda;
- el backend impide inventar SKU, precio o stock;
- ningún tenant puede observar productos de otro tenant;
- se conoce el costo y la latencia de cada ronda;
- el fallback queda identificado y no se confunde con DeepSeek;
- el flujo mejora sin aumentar indiscriminadamente el tiempo de respuesta.

## 12. Decisión recomendada

Sí se debe dividir más el planner, pero únicamente en responsabilidades técnicas y etapas de decisión:

1. gateway de proveedor;
2. intérprete semántico;
3. validador del marco;
4. coordinador de grounding;
5. agente de decisión fundamentada;
6. guard de catálogo y negocio;
7. composer;
8. telemetría.

No se recomienda dividir la comprensión en agentes separados para saludo, producto, ortografía, cantidad o presentación. Eso fragmentaría el contexto y podría reducir la capacidad de razonamiento que se busca recuperar.

La implementación recomendada es un ciclo de grounding progresivo, acotado y observable. Es una arquitectura inspirada en ReAct, pero controlada por contratos, límites de ronda y validaciones de negocio.

Las secciones anteriores conservan el diagnóstico y diseño anteriores a la implementación. La ejecución autorizada se registra a continuación; no se realizó despliegue.

## 13. Seguimiento de ejecución local — 2026-11-04

Base revisada: commit `9db2c20` en `codex/backend-plan-payload-20261020`. Se conservaron los cambios existentes de separación intérprete/resolutor, ofertas interactivas, idempotencia, lotes, outbox y estados de pedidos. El documento original estaba sin seguimiento de Git; no se sobrescribió con otra versión ni se hizo checkout/reset.

| Fase | Resultado local | Evidencia / límite |
|---|---|---|
| 0. Línea base | Revisada | E2E P9 previo `20261104152951_d4af6f21`: 40/40. Contratos de intérprete, resolución y recuperación ejecutados antes del cambio: PASS. |
| 1. Contratos y gateway | Implementada | Transporte y credenciales extraídos. La fachada mantiene `plan()` y `composeReply()`. El timeout incluye lectura del cuerpo HTTP. |
| 2. Recuperación enriquecida | Implementada | Atributos anidados indexados; evidencia textual por campo. La búsqueda no confirma productos por score. |
| 3. Grounding | Implementada, opt-in | Hasta dos rondas; la segunda es una reformulación decidida por el LLM. Máximo doce ítems, dos consultas iniciales e inventario de candidatos acotado por ítem. |
| 4. Runtime | Implementada | Consultas y pedidos comparten coordinador. Cambios del carrito por identidad estable; datos de cliente y forma de pago persisten entre turnos. |
| 5. Validación | Revisión de expectativas antes de continuar | Run `20261104174118_beda0cd8`: 6/40 con el oráculo anterior. Pruebas focalizadas pasan en corridas separadas, pero no sustituyen la aceptación completa. Se identificaron expectativas rígidas, problemas de instrumentación y defectos reales. |
| 6. Composer | Extraído | Voz/nombre por tenant y comprobaciones de hechos conservadas. Fallo del proveedor se identifica y no se anuncia como inferencia real. |

### Archivos realmente modificados y nuevos

| Archivo | Estado | Responsabilidad implementada |
|---|---|---|
| `server/services/llmPlanner.js` | Modificado | Fachada; usa gateway/composer. Con grounding activo deshabilita `coercePlanWithConversation` y `enrichPlannerOutput`; un error de interpretación escala de forma segura. Prompt con variantes de consulta, actualización del carrito y distinción entre pago elegido y pago realizado. |
| `server/services/semanticInterpreter.js` | Reutilizado sin cambios | Ya separaba proveedor, normalización y fallback. No fue necesario crear otro intérprete ni duplicar esa frontera. |
| `server/domain/semanticContracts.js` | Modificado | Conserva `queryVariants` y `removeItemIds`; exporta comprobación de medidas para reutilizarla, sin duplicar conversión de unidades. |
| `server/domain/catalogEvidence.js` | Nuevo | Representación buscable de atributos y coincidencias textuales por campo. |
| `server/domain/groundingContracts.js` | Nuevo | Guard de SKU real, pertenencia al tenant, precio, stock, activo y medida explícita; actualización del carrito por `rawItemId`. |
| `server/services/toolRegistry.js` | Modificado | Integra atributos en recuperación y devuelve `matchEvidence`. Mantiene herramientas y autorización existentes. |
| `server/services/llmProviderGateway.js` | Nuevo | Transporte DeepSeek/Gemini/OpenAI compatible; secretos por referencias, timeout y reintentos. No contiene decisiones de catálogo. |
| `server/services/conversationGroundingCoordinator.js` | Nuevo | Búsqueda → observación → decisión → reformulación opcional; presupuesto de tiempo y comprobación de vigencia. No escribe pedidos ni envía mensajes. |
| `server/services/groundedDecisionAgent.js` | Nuevo | Prompt de decisión sobre candidatos; exige una decisión por ítem del pedido acumulado. Usa proveedor real y registra tokens/duración con etapa `grounding`. |
| `server/services/llmReplyComposer.js` | Nuevo | Redacción final, voz por tenant y validación de términos/importes; API de compatibilidad conservada en planner. |
| `server/services/agentRuntime.js` | Modificado | Integra resoluciones y memoria; conserva ofertas. Consulta mensajes en cola y descarta resultados vencidos o interrumpidos por atención manual. |
| `server/services/usageService.js` | Modificado | Expone métricas específicas de grounding además del total de LLM. |
| `server/config.js`, `.env.example`, `.env.e2e.local.example` | Modificados | Configuración opt-in documentada; `LLM_GROUNDING_ENABLED=false` por defecto. |
| `server/tests/grounding-contract.mjs` | Nuevo | Atributos, opciones, SKU ajeno, stock, medidas, dos rondas, fallo de proveedor, deadline, mensaje pendiente, memoria y runtime. Dobles de prueba explícitos. |
| `server/tests/grounding-deepseek.mjs` | Nuevo | Diez escenarios específicos disponibles con DeepSeek real, almacenamiento temporal y WhatsApp simulado. Reporte por caso, turnos y eventos. Sus expectativas también deben alinearse; no se afirma una corrida final 10/10 del mismo estado del código. |
| `server/tests/e2e-local-deepseek-40.mjs` | Modificado | Telemetría incluye etapa grounding. Conserva las expectativas originales para hacer visible cualquier diferencia; no convierte fallos en éxitos. |
| `package.json` | Modificado | Comandos `test:grounding` y `test:grounding:real`. |

### Decisiones y diferencias respecto al diseño conceptual

- Se extrajo el composer en esta iteración: evitó mantener dos implementaciones del transporte. El resolutor legado sigue en `semanticContracts.js`, exclusivamente para compatibilidad; el nuevo guard es `groundingContracts.js`.
- `LLM_GROUNDING_REFORMULATIONS` no se agregó: `MAX_ROUNDS` se acota a 1–2 y ya impide más de una reformulación. No hay dos variables que puedan contradecirse.
- `TIMEOUT_MS` es el presupuesto total del ciclo de búsqueda/decisión, no un tiempo completo nuevo por cada ronda. Default 15 s; se usaron 20 s en las pruebas reales para medir antes de decidir el valor de operación.
- Una decisión del LLM utiliza todos los ítems del turno acumulado; no se crea un agente por producto, ortografía o saludo. Normalmente se añade una llamada, dos si el modelo pide reformular. El intérprete y el composer siguen siendo etapas distintas.
- No se exige reformular cuando el modelo ya tiene evidencia suficiente para resolver, preguntar o escalar. Forzar esa llamada convertiría la estrategia en una secuencia rígida e incrementaría la latencia.
- Las cantidades, SKU, precios, stock, vigencia de las ofertas y permisos se validan como invariantes de negocio. El score no decide aceptación automática. Los fallos del modelo se escalan explícitamente; no se sustituyen por un parser de palabras clave con grounding habilitado.
- Los botones existentes representan elecciones explícitas sobre ofertas versionadas y conservan su contrato; no se añade otra llamada al LLM para reinterpretar un identificador ya validado.
- No se añadió aprendizaje persistente, RAG, embeddings, un nuevo framework, migraciones PostgreSQL ni pantallas.

### Validación y reproducción

1. `npm run test:grounding`: no consume un proveedor externo.
2. `npm run test:backend` y `npm run test:architecture`: preservan los contratos anteriores.
3. Con `DEEPSEEK_API_KEY` suministrada localmente y sin `LLM_SIMULATOR`, `npm run test:grounding:real`. Solo DeepSeek puede salir a la red; WhatsApp está simulado. No imprimir ni guardar la clave en evidencias.
4. Configurar `.env.e2e.local` desde su plantilla, apuntando `E2E_SOURCE_DATABASE_URL` al PostgreSQL local y activar explícitamente `LLM_GROUNDING_ENABLED=true`. Ejecutar `npm run test:e2e:local`. El runner clona la base de desarrollo, crea un tenant sombra y captura Graph; no envía WhatsApp ni modifica la base fuente. Usar presupuesto suficiente de llamadas para los 40 casos y registrar ese límite.
5. `npm run build` y `git diff --check` antes de consolidar.

Resultados, límites y revisión de aceptación: [Revisión de expectativas E2E](Revision-expectativas-E2E-contextuales-2026-11-04.md). El flag debe permanecer deshabilitado hasta cerrar las discrepancias funcionales y validar los diálogos completos con los oráculos actualizados. Un build exitoso o escenarios focalizados no sustituyen la aceptación E2E completa.

### Reorientación solicitada por el usuario

El 2026-11-04 se detuvo la continuación de correcciones para revisar primero la matriz. La nueva especificación documenta los 40 casos uno a uno, propone incorporar como obligatorios los 10 casos reales ya existentes y separa resultados de negocio, contratos técnicos y calidad conversacional. No se cambiaron fixtures ni resultados históricos durante esta revisión. Primero se alinearán evaluador y actores de prueba; después se compararán ambas implementaciones y se corregirán los fallos demostrados.

### Continuación: instrumento de aceptación v2

Tras la autorización «adelante», se implementaron los fixtures contextuales, el comprador simulado con DeepSeek, un juez separado y el oráculo independiente de negocio. El corpus anterior queda disponible como `legacy40`; la nueva campaña es `contextual50`. La aplicación no se corrigió durante esta continuación.

El contrato del evaluador pasó controles positivos y mutaciones de precio, cantidad, total, identidad, presupuesto y consentimiento. La calibración encontró además trabajos heredados del clon que contaminaban la medición, evidencias inventadas por el juez y un fallo real de duplicación de agua al reiterar el cliente que solo quería una botella. Se preservaron los resultados de calibración, identificados como tales.

Archivos de esta etapa: `server/tests/fixtures/contextualAcceptanceScenarios.js`, `server/tests/helpers/contextualCustomerActor.js`, `server/tests/helpers/businessOutcomeAssertions.js`, `server/tests/helpers/contextualScenarioRunner.js`, `server/tests/contextual-acceptance-contract.mjs`, `server/tests/run-contextual-e2e.mjs`, runner E2E existente, expectativa focalizada de arepas y comandos de `package.json`. No se modificó el corpus histórico para convertir fallos en éxitos.

Seguimiento detallado, reproducción, límites y resultados: [sección 11 de la revisión de expectativas](Revision-expectativas-E2E-contextuales-2026-11-04.md#11-implementación-autorizada-de-la-aceptación-v2).

### Cierre de la revisión de expectativas

Ejecutados 50 escenarios/182 turnos con la descomposición activa y seis escenarios comparables con el flag apagado, sobre las mismas fuentes. Se conservó la implementación anterior de este plan; no se revirtió ni se corrigió nuevamente el código productivo durante la revisión.

La auditoría confirmó duplicaciones intermedias de productos, confirmaciones con referencias pendientes, tareas humanas duplicadas y silencios. También identificó errores del comprador/juez que antes se atribuían al backend. Se reforzó exclusivamente el instrumento 2.1 y se reevaluaron las conversaciones guardadas sin alterar los originales.

**Estado de la fase 5: ejecutada y no aprobada para liberación.** Nueve pedidos se completaron con el flujo del tendero, pero el resultado final correcto no compensa una cotización intermedia duplicada. Antes de continuar deben revisarse [los resultados](Evidencia-aceptacion-contextual-v2-2026-11-04.md) y [la auditoría por caso](Auditoria-manual-aceptacion-contextual-2026-11-04.md). Permanecen pendientes los diálogos truncados por el actor, las repeticiones críticas y las variantes concurrentes; no se hizo commit, push ni despliegue en esta etapa.

### Corrección autorizada: duplicación y confirmación incompleta

Se reanudó la implementación únicamente para estas prioridades. La reproducción, archivos y resultados se registran en [Corrección de canasta y confirmaciones](Correccion-canasta-y-confirmacion-local-2026-11-04.md). Se conservó el código de la descomposición y los resultados anteriores.

La elección explícita sigue validándose por ID, tenant y versión. La primera implementación de esta continuación volvió a pasar el título abreviado por el intérprete y reprodujo una regresión en el caso 24: se reabría la misma variante. Se corrigió para que producto/pago retomen directamente el **resolutor contextual LLM**, con la elección estructurada y todos los pendientes. El intérprete lingüístico continúa atendiendo los mensajes libres. Los SKU ya resueltos se conservan durante ese turno estructurado, pero se revalidan precio, stock y tenant contra el catálogo actual; una modificación posterior por texto vuelve a interpretarse normalmente. No se consume otra llamada para adivinar una elección ya validada. Esta versión final tiene contratos específicos y una repetición real focalizada posterior a la campaña de 50 casos; no se atribuye a esta última ejecución el código corregido después.

## 14. Ampliación revisada: precios, domicilio, mínimo y pago por texto

Fecha de revisión: 2026-11-04. **Implementación local y validación focalizada completadas; campaña general no aprobada.** El usuario autorizó esta ampliación después del diseño. Las secciones 14.1 y 14.2 conservan el diagnóstico previo; no describen el estado final. El seguimiento, la versión evaluada, los 15/15 casos nuevos aprobados y las brechas de la campaña general están en [Implementación de condiciones de domicilio](Implementacion-domicilio-precios-pago-local-2026-11-04.md). No se autoriza ni se realiza despliegue en esta etapa.

### 14.1 Diagnóstico histórico al detener la implementación

Antes de esta ampliación se inició la corrección de consultas comerciales: se creó una regresión local, se extrajeron los helpers existentes de medios de pago a `server/domain/paymentMethods.js` y se comenzó a entregar al intérprete los IDs de pago de la tienda, con reparación acotada de un contrato inválido. Los tres controles iniciales de `commerce-questions-contract.mjs` fallaron antes de corregir; no se ejecutó una validación posterior completa de esos cambios parciales.

En ese momento, esos cambios permanecían en el árbol de trabajo junto con la descomposición y las correcciones de canasta anteriores. No se revirtieron ni se consideraron una versión lista. La revisión previa se limitó a documentación. La implementación y las pruebas locales fueron autorizadas después; su estado final se registra en §14.11 y en el informe enlazado.

La instrucción más reciente amplía el alcance: ya no basta con contestar que la tarifa no está configurada. Hay que permitir que **cada dueño configure el costo y el mínimo de su tienda**, incorporar ambos a la decisión contextual y conservarlos en cotización y pedido.

### 14.2 Comprobación contra el código anterior a esta ampliación

| Área y evidencia del repositorio | Capacidad existente | Brecha comprobada / reutilización |
|---|---|---|
| `tenantConfigPolicy.js`: `OWNER_EDITABLE_SECTIONS`, `ADMIN_EDITABLE_SECTIONS`, `mergeTenantConfig` | Configuración por tenant, lista de campos permitidos y merge parcial. El dueño puede editar `orderPolicy.paymentMethods`. | No admite costo ni mínimo. Ampliar esta misma política, con validación idéntica para dueño y administrador. |
| `routes/api.js`: `PATCH /tenants/:tenantId/config` | Autoriza rol `owner` sobre el tenant de la ruta y registra la acción. | Reutilizar endpoint y auditoría; verificar persistencia y lectura posterior. No crear variables de entorno globales. |
| `saasControlPlane.js`: configuración inicial y normalización; `data/seed.js` | `orderPolicy` contiene datos requeridos, medios de pago y destinos de persistencia. | No hay tarifa ni mínimo predeterminados. La normalización debe distinguir valores ausentes de cero, sin alterar pedidos existentes. |
| `src/App.jsx`: `Configuration`, `saveCustomerReplySettings` | Editor por tienda de tono y medios de pago. | Faltan controles de domicilio; usar `onSaveConfig` y los estados de guardado existentes. |
| `semanticContracts.js`: `advanceOrderDraft` | Conserva líneas, recalcula `subtotal` e incrementa versión. | Solo calcula productos. No tiene desglose del domicilio, mínimo, faltante ni total final. |
| `agentRuntime.js`: `handleDeliveryOrder`, `handleOrderConfirmation`, ofertas versionadas | Canasta, resolución LLM, datos, pago, validaciones y confirmación. | No comprueba condiciones de domicilio; transmite principalmente subtotal. La pregunta comercial actual no llega al composer de cotización. |
| `groundedDecisionAgent.js`, `conversationGroundingCoordinator.js` | LLM evalúa productos, historial y siguiente acción, con límites de búsqueda. | No recibe una evaluación comercial del domicilio ni una acción explícita para responder consultas intercaladas. |
| `llmReplyComposer.js`: `validateComposedReply` | Valida términos e importes antes de enviar. | Extrae importes con símbolo `$` de JSON/texto; los precios numéricos de catálogo no habilitan correctamente un precio unitario. El texto del cliente no debe convertirse en evidencia monetaria. |
| `toolRegistry.js`: `googleSheetsOrderWrite`, `orderToSheetRow` | Guarda primero el pedido local/PostgreSQL y encola Sheets. Proyección de 13 columnas A:M. | Conserva `subtotal`, pero no tarifa/total/snapshot de condiciones. Ampliar payload y proyección sin redefinir `subtotal` ni desplazar columnas existentes. |
| `store/postgresStore.js`: `upsertOrder`; migración `001_initial_postgres_store.sql` | Tenant y pedido tienen `payload JSONB`; orders tiene columna `subtotal`. | Se pueden conservar los nuevos datos en JSONB sin exigir DDL inicialmente; verificar round-trip real. No reutilizar la columna subtotal para el total. |
| `routes/api.js`: `enrichPendingRequests`; `App.jsx`: cola humana; `OrderProgressCard.jsx` | El tendero ve importes provenientes de subtotal. | Mostrar productos, entrega y total consistentemente, incluso en tareas humanas y órdenes históricas. |
| `agentRuntime.js`: `resolveHumanRequest`; herramientas `human_handoff` y `approval_gate` | Escalamiento, respuesta humana y continuidad; alistamiento de una orden ya creada. | No existe una excepción estructurada al mínimo ni una cotización autorizada de tarifa para este caso. Una nota o aprobar una tarea genérica no equivalen a aceptar condiciones comerciales ni al consentimiento del comprador. |
| `helpers/businessOutcomeAssertions.js` y campaña `contextual50` | Verifica precios, subtotal, consentimiento, identidad y cantidades independientemente de VIA. | Sus expectativas de importe no modelan tarifa/mínimo. Deben ampliarse antes de usar resultados como aceptación de esta funcionalidad. |

La búsqueda de campos y usos de tarifa/mínimo en `server`, `src` y los planes no encontró una implementación previa de estas capacidades. Las menciones a costos por domicilio en estudios financieros corresponden a costos de VIA; no son la tarifa de entrega cobrada al comprador.

### 14.3 Contrato de configuración propuesto

Reutilizar `tenant.config.orderPolicy`, con dos campos independientes:

```json
{
  "orderPolicy": {
    "deliveryFee": 3000,
    "deliveryMinimumSubtotal": 15000
  }
}
```

Los importes de este ejemplo son **datos de prueba**, no valores que deban aplicarse a las tiendas actuales. En esta etapa la unidad es COP y los valores son pesos enteros no negativos, dentro de un rango numérico seguro. Rechazar negativos, fracciones, booleanos, valores no finitos y texto ambiguo; validar del mismo modo por API administrativa y de dueño.

| Valor | `deliveryFee` | `deliveryMinimumSubtotal` |
|---|---|---|
| Entero mayor que cero | Tarifa fija por pedido entregado, no por producto. | Subtotal mínimo de productos para acceder al domicilio. |
| `0` explícito | Entrega gratuita decidida por esa tienda. | Esa tienda no exige mínimo. |
| `null` o campo ausente | Tarifa todavía no definida. No equivale a gratis. | Condición todavía no definida. No equivale a ausencia de mínimo. |

- Guardar un campo no modifica el otro ni los medios de pago, catálogo, voz o conexiones.
- El dueño administra únicamente su tenant. La sesión, la ruta, el guard y la persistencia deben comprobarlo; nunca aceptar `tenantId` ni importes del comprador como autoridad.
- Las tiendas existentes conservan los campos sin definir. La UI debe mostrar «Sin configurar» y permitir definir explícitamente cero. No introducir un fallback global comercial.
- Se puede consultar catálogo y seguir armando la canasta con una condición sin definir; la confirmación autónoma de un **domicilio** necesita ambas condiciones conocidas o una resolución humana válida para ese pedido.
- Retiro en tienda no genera tarifa ni aplica mínimo de domicilio, pero solo se adopta si el cliente lo solicita o acepta y la tienda efectivamente ofrece esa modalidad. La IA no lo presupone para eludir el mínimo.
- Tarifa por zonas, distancia, franjas horarias, subsidios y umbral de envío gratis quedan fuera de esta primera versión. Tampoco se infiere cobertura o tiempo de entrega a partir de estos dos valores.

### 14.4 Cálculo y fuente única de hechos comerciales

Crear un módulo puro y pequeño `server/domain/deliveryPolicy.js` para normalizar/evaluar la política y producir el snapshot de cotización. No interpreta lenguaje ni elige el siguiente mensaje.

Para productos resueltos con precios y cantidades válidos:

```text
subtotal = suma de los importes de las líneas de productos
minimumBase = subtotal de productos, sin incluir el cargo de entrega
shortfall = max(0, deliveryMinimumSubtotal - minimumBase)
minimumMet = minimumBase >= deliveryMinimumSubtotal
total = subtotal + deliveryFee                 (si es domicilio y ambos importes son conocidos)
```

Si existe un descuento explícitamente autorizado que reduzca productos, usar la base neta de productos y conservar el descuento auditable. No crear una segunda implementación de descuentos ni aceptar importes calculados por el LLM. El alcance inicial debe cubrir los importes efectivamente soportados por VIA.

**El mínimo no es un recargo.** No se suma `shortfall` al total. El cargo de entrega tampoco ayuda a alcanzar el mínimo. Una canasta incompleta puede tener subtotal parcial, pero no debe presentarse como cotización final; marcar la elegibilidad como pendiente de resolución y recalcular al aclarar los productos.

Ejemplo: productos por $10.000, entrega $3.000 y mínimo $15.000 → faltan $5.000 en productos. El importe calculable sería $13.000, pero el pedido no está habilitado para confirmación autónoma. Si el comprador agrega $5.000 en productos reales, el subtotal pasa a $15.000 y el total a $18.000.

Conservar `subtotal` como campo compatible. Agregar un snapshot `pricing` al borrador y a la orden, con:

- versión del contrato, moneda y modalidad de entrega;
- subtotal, tarifa conocida o `null`, total conocido o `null`;
- mínimo aplicado, base elegible, faltante y estado: cumplido, insuficiente, configuración incompleta, canasta incompleta o no aplicable;
- identidad/revisión de la política del tenant, fecha de cotización y versión del borrador;
- referencia de resolución humana, si existe, sin copiar autoridad desde el texto del comprador.

Los importes son calculados por backend con catálogo/política confiables. El LLM recibe estos hechos y selecciona cómo explicarlos o continuar. La misma función de dominio debe emplearse al cotizar y en la frontera de escritura; el backend debe rechazar la confirmación de una cotización comercial inválida aunque el modelo proponga confirmarla.

### 14.5 Flujo contextual y distribución de responsabilidades

1. **Intérprete existente:** recibe mensaje/lote, historial, estado, pregunta pendiente y medios de pago del tenant. Distingue consulta de precio, pregunta por domicilio, adición, modificación y elección de pago. Una pregunta no agrega productos ni equivale a confirmar. No calcula importes ni resuelve SKU.
2. **Coordinador existente:** conserva la canasta y obtiene evidencia del catálogo. Cuando hay productos ambiguos, mantiene sus identidades y las opciones; no omite líneas para aparentar que cumple el mínimo.
3. **Evaluación comercial pura:** a partir de líneas verificadas y política del tenant genera los hechos anteriores. Incorporarlos a la llamada de decisión existente una vez disponible la evidencia; no añadir un agente de cálculo ni obligar otra llamada para cada regla. Ante una segunda búsqueda, actualizar también la evaluación.
4. **Resolutor contextual LLM:** recibe hechos, preguntas recientes, `collectionComplete`, oferta vigente y respuestas anteriores. Decide responder la consulta, aclarar productos, invitar a completar el pedido, seguir esperando la colección o escalar. La decisión debe expresar un motivo breve y verificable, no razonamiento privado.
5. **Runtime/guard:** valida la acción contra los límites comerciales. No traduce automáticamente `minimumMet=false` a escalamiento o venta adicional; sí impide crear la orden sin mínimo cumplido o excepción humana válida. Mantiene idempotencia y vigencia del turno.
6. **Composer existente:** recibe pregunta actual, contexto breve, decisión LLM y desglose confiable. Responde lo preguntado antes de proponer el siguiente paso; conserva el tono y nombre del tenant. Si se puede cotizar, informa «Productos / Domicilio / Total» antes de confirmar.
7. **Consentimiento y persistencia:** tras aceptación del comprador de una cotización vigente, persistir orden y outbox; Sheets continúa siendo una proyección asíncrona. El transporte del webhook no debe esperar esta conversación.

Ampliar el contrato de decisión con `answer_question` y `invite_additions` (nombres definitivos sujetos a integración), conservando las acciones actuales de aclaración y escalamiento. Para consultas sin pedido, reutilizar `handleContextualConversation` con hechos de política y pago; no disparar búsquedas de catálogo para preguntar la tarifa.

Ejemplos de alternativas legítimas que debe resolver el LLM:

| Situación conversacional | Conducta esperada, sin guion literal |
|---|---|
| Pedido bajo el mínimo, cliente todavía agregando productos | Conservar la colección y comunicar oportunamente el mínimo; no interrumpir con pago ni escalar automáticamente. |
| Cliente terminó y falta poco | Explicar cuánto falta e invitar a agregar si el contexto lo permite. Recomendar solo productos reales; no incorporarlos sin consentimiento. |
| Cliente dice que no puede agregar, tiene un presupuesto cerrado o pide una excepción | Ofrecer/realizar escalamiento contextual, conservando canasta, faltante y consulta. No repetir indefinidamente la misma invitación. |
| Consulta «¿cuánto cuesta cada uno y cuánto el envío?» | Responder precios unitarios reales y tarifa; distinguir subtotal y total. No volver a preguntar pago ignorando la consulta. |
| Cliente escribe «pago con débito» | Inferir el ID del medio habilitado según contexto. No inventar `tarjeta_debito` ni afirmar que ya pagó. |
| Cliente elige pago mientras faltan productos o mínimo | Conservar la preferencia, pero continuar los pendientes antes de ofrecer confirmar. |
| Cliente retira un producto y cae por debajo del mínimo | Recalcular, invalidar la cotización anterior y volver al análisis contextual; no cobrar el faltante como cargo. |
| Tarifa o mínimo desconocidos | Decir qué falta conocer; consultar al humano si el cliente necesita esa condición para continuar. No decir «gratis» ni «sin mínimo». |
| Atención humana activa | Respetar la toma de control; el agente no envía en paralelo ni reanuda por interpretar aisladamente una palabra. |

Las restricciones numéricas y de autorización son obligatorias. Lo contextual es decidir cómo continuar dentro de ellas; delegar al LLM la aritmética o la autorización de excepciones no mejora la naturalidad y compromete los cobros.

### 14.6 Atención humana y excepciones comerciales

Reutilizar la cola de `human_handoff`/`approval_gate`, las tareas y el endpoint de resolución. Agregar un tipo explícito `delivery_policy_review` para distinguir revisar condiciones de **alistar un pedido ya confirmado**. No usar palabras del título como prueba de que existe una orden.

El snapshot de la tarea debe incluir canasta, subtotal, tarifa, mínimo, faltante, pregunta del cliente, datos de entrega disponibles, política/versión y pago elegido. Una sola tarea activa por conversación, revisión de canasta y motivo; nuevos mensajes actualizan el contexto sin multiplicar tarjetas.

Resoluciones propuestas: mantener condiciones, autorizar una excepción al mínimo para ese pedido, establecer una tarifa faltante para ese pedido o rechazar la excepción. No dar al LLM autoridad para concederlas. La decisión humana requiere usuario autenticado con permiso del tenant, motivo y valores explícitos validados; el actor se obtiene de la sesión, no de un `approverId` enviado por el cliente.

La resolución queda ligada a tenant, conversación, borrador y política; no cambia las condiciones de todos los pedidos ni de otras tiendas. Si cambian las condiciones relevantes, se invalida/revisa la excepción. Al reanudar, el LLM comunica las condiciones autorizadas y solicita al comprador aceptar el nuevo resumen antes de crear el pedido. Aprobar la tarea no autoriza cobrar ni cambia automáticamente a alistamiento. No se reinterpretará una nota libre como un precio aprobado.

### 14.7 Vigencia, concurrencia y compatibilidad

- Incorporar una revisión derivada de los dos valores comerciales y tenant al snapshot; puede ser una huella calculada en servidor, sin otro campo editable ni una tabla nueva.
- Al cambiar canasta, modalidad, precio, tarifa, mínimo o pago relevante, recalcular e invalidar ofertas antiguas. La validación actual de `draftVersion` debe comprobar también la revisión comercial.
- Releer la política antes de confirmar. Si cambió después de cotizar, informar la nueva cotización y pedir aceptación; no cobrar silenciosamente el nuevo total. Un cambio concurrente no debe poder ocurrir entre la comprobación válida y el commit sin ser detectado: reutilizar las transacciones/versionado del store y agregar el control necesario, con prueba real de carrera.
- Conservar comprobación de mensajes pendientes, versión de conversación y toma de control humana antes de enviar. Una respuesta compuesta con condiciones antiguas debe descartarse.
- Una orden ya confirmada conserva su snapshot; editar la tarifa de la tienda no recalcula órdenes históricas.
- Pedidos históricos sin `pricing`: mostrar subtotal y «desglose de domicilio no registrado»; no inventar envío gratis ni reescribir sus totales.
- Aprovechar `payload JSONB` de tenant, conversación, tarea y pedido. No se anticipa una migración DDL; su necesidad se reevaluará solo si las pruebas de persistencia muestran una carencia concreta.
- Mantener Sheets A:M compatible: conservar subtotal en F y estado en G. Primera extensión propuesta: incorporar el snapshot `pricing` en el JSON de metadatos existente de M; columnas adicionales visibles de tarifa/total pueden añadirse al final, de forma versionada y sin sobrescribir contenido del dueño, si se incluyen en el alcance de UI de Sheets. La API y las tarjetas sí deben mostrar el desglose explícito desde la primera versión.

### 14.8 Archivos y cambios previstos

| Archivo | Cambio propuesto |
|---|---|
| `server/domain/deliveryPolicy.js` **nuevo** | Normalización comercial, evaluación y snapshot; ninguna detección de intención ni selección de respuesta. |
| `server/services/tenantConfigPolicy.js` | Permitir los dos campos, validar valores y conservar merge independiente; usar el validador comercial para dueño y administrador. |
| `server/routes/api.js` | Reutilizar autorización/guardado y auditoría; transportar desglose en tareas y validar resoluciones humanas tipadas y actor real. |
| `server/services/saasControlPlane.js`, `server/data/seed.js` | Valores ausentes explícitos para tenants nuevos/legados; fixtures con valores decididos para cada escenario, sin un precio global. |
| `src/App.jsx` | Controles «Costo del domicilio (COP)» y «Pedido mínimo para domicilio (COP)» en Ajustes de la tienda; distinguir vacío/cero, errores y guardado. Mostrar desglose en cotización/cola humana y gestionar revisión comercial sin confundirla con preparación. |
| `src/features/orders/OrderProgressCard.jsx` | Mostrar subtotal, entrega y total del snapshot; fallback histórico explícito. |
| `server/services/llmPlanner.js` | Terminar contexto de pagos y preguntas comerciales; datos de política compactos, sin volver a concentrar búsqueda ni cálculos en el intérprete. |
| `server/domain/paymentMethods.js` **extracción completada** | Reutilizar normalización/configuración existentes y validar IDs habilitados; la equivalencia semántica por texto sigue a cargo del LLM. |
| `server/domain/semanticContracts.js` | Preservar consultas/elección de pago, incluido medio solicitado no disponible, sin convertirlas en mutaciones de canasta. Integrar snapshot/versionado sin duplicar cálculo monetario. |
| `server/services/conversationGroundingCoordinator.js` | Entregar evaluación comercial y pregunta contextual a la decisión existente; actualizarla después de búsquedas. Conservar presupuesto de llamadas y comprobaciones de vigencia. |
| `server/services/groundedDecisionAgent.js` | Resolver continuidad con hechos comerciales; responder, invitar a completar o escalar sin umbral textual que reemplace al LLM. |
| `server/services/agentRuntime.js` | Reutilizar cálculo en cotización/confirmación, contexto del composer, pago por texto, bloqueo comercial, ofertas y resolución humana; no crear orden por cerrar una tarea de revisión. |
| `server/domain/groundingContracts.js` | Ampliar invariantes de confirmación con política, snapshot, canasta completa y excepción válida, preservando los guards actuales. |
| `server/services/llmReplyComposer.js` | Recibir contexto y hechos confiables. Validar precio unitario, subtotal, tarifa, mínimo, faltante y total por significado, no solo porque un número aparece en algún texto. Registrar rechazo/fallback sin etiquetarlo como composición aceptada. |
| `server/services/toolRegistry.js` | Revalidar y persistir snapshot en la frontera de orden; conservarlo en tareas y proyección Sheets vía outbox. No confiar en total enviado por el LLM/cliente. |
| `server/store/postgresStore.js` y `server/services/orderService.js` | Reutilizar payload, transacciones, versión y outbox. Modificar solo si hace falta para vigencia atómica, round-trip o proyección; no rediseñar estados ni almacenamiento. |
| `server/tests/commerce-questions-contract.mjs` **iniciado** | Completar regresiones de precios y pagos; separar evidencia del proveedor, respuesta rechazada y datos del cliente. |
| `server/tests/delivery-policy-contract.mjs` **nuevo** | Cálculo, límites, validación API, aislamiento, snapshots, guard de confirmación y resoluciones humanas. |
| Fixtures/actores/oráculo/runner E2E existentes | Incorporar política por tenant, desglose y aceptación del total; seguir usando DeepSeek real y Meta/Sheets simulados. No duplicar el runner. |

### 14.9 Validación y criterios de aceptación

Antes de repetir la campaña, actualizar las expectativas y el comprador/juez para que distingan `subtotal`, tarifa y total. El oráculo independiente calcula los resultados desde catálogo y política del fixture; no importa `deliveryPolicy.js` ni toma la respuesta del modelo como resultado esperado.

| Grupo | Pruebas obligatorias |
|---|---|
| Aislamiento/configuración | Dos tenants con misma canasta y políticas distintas; dueño A no consulta/edita B; modificar tarifa conserva mínimo y pagos; persistencia tras reinicio; valor cero explícito vs vacío; negativos/fracciones/tipos inválidos rechazados. |
| Aritmética | Tarifa positiva, gratuita y ausente; mínimo cero, exacto, inferior y superior; tarifa que haría superar el mínimo si se sumara incorrectamente; cargo aplicado una sola vez; canasta parcial no presentada como final. |
| Contexto | Pregunta solo por envío, pregunta por precios durante compra, entrega+pago en un mismo texto, adiciones en ráfaga, retirar productos, presupuesto limitado, cliente que insiste en no agregar y solicitud de humano. |
| Elección LLM | Bajo el mismo mínimo, cliente aún comprando recibe continuidad/invitación; cliente que requiere excepción escala. No exigir frases literales ni aprobar un caso solo por una palabra clave. |
| Pago | Texto coloquial que corresponde a un medio habilitado, medio personalizado, medio no habilitado, cambio de preferencia y elección de pago antes de terminar. No interpretar preferencia como pago verificado. |
| Confirmación | No ofrecer/crear pedido con mínimo incumplido sin autorización; respuesta afirmativa a una consulta no es consentimiento; aceptar texto/botón solo sobre desglose vigente; entrega desconocida nunca total definitivo. |
| Humano | Una sola tarea, permiso del actor, excepción tipada y acotada, rechazo, reanudación desde memoria y nueva aceptación del comprador; nunca pasar una revisión comercial directamente a alistamiento. |
| Concurrencia | Cambio de tarifa/mínimo entre cotización y clic; cambio durante cálculo/commit; mensaje nuevo durante composición; atención manual simultánea; botón atrasado; reintentos sin doble pedido/cargo/tarea. |
| Persistencia/UI | WhatsApp, API, PostgreSQL, tarjeta del tendero y proyección Sheets conservan mismos importes y snapshot; fallo Sheets no bloquea guardado; historial no recalculado; retiro aceptado no cobra domicilio. |
| Composición | Precio correcto no cae a fallback por ser numérico; no se permite asociar el mínimo como tarifa o viceversa aunque ambos números estén en hechos; importes inyectados por comprador no son evidencia; incertidumbre expresada correctamente. |

Reutilizar las regresiones de canasta/confirmación y focalizar inicialmente los casos 01, 24, 29, 30, 33, 40, 44 y 50, más variantes nuevas de política. Conservar los 50 escenarios base y sus resultados históricos. Los fixtures antiguos sin cargos deben declarar explícitamente `deliveryFee: 0` y `deliveryMinimumSubtotal: 0` cuando esa sea su expectativa comercial; una configuración ausente se evalúa separadamente como desconocida.

Luego ejecutar la campaña completa local con PostgreSQL clonado, API DeepSeek real, webhook firmado y captura Graph. Ningún mensaje real ni escritura en Drive productivo. Registrar hash de fuentes y fixtures, número de llamadas, tokens y duración por etapa. Una falla del comprador/juez se informa separada de un defecto de VIA; no atribuir aprobación por completar la suite ni por alcanzar el subtotal final.

Aceptación mínima: cero importes inventados, cargos duplicados, órdenes sin consentimiento vigente, cruces de tenant y excepciones no autorizadas. Verificar tres repeticiones de variantes críticas con lenguaje distinto; informar latencias p50/p95 y consumo comparable antes/después. La política comercial no debe añadir una llamada LLM obligatoria por turno; las reparaciones de contrato siguen acotadas y visibles.

### 14.10 Orden de ejecución y riesgos

1. Acordar este contrato y las expectativas; realizado y posteriormente autorizado para implementación local.
2. Crear regresiones de política y extender oráculos antes de alterar el comportamiento.
3. Implementar dominio/configuración/UI de tenant y snapshots, conservando los cambios locales anteriores; completar la corrección parcial de pago por texto.
4. Integrar hechos en resolutor/composer y validaciones en confirmación/persistencia, sin crear un nuevo planner monolítico.
5. Completar resolución humana comercial y vigencia concurrente antes de considerar el flujo apto para pedidos reales.
6. Ejecutar contratos, pruebas de configuración/aislamiento, E2E focalizado y campaña completa; revisar diálogos y evidencias.
7. Documentar resultados, riesgos restantes y diferencias contra la línea base. No hacer despliegue en esta ejecución; la validación solicitada permanece local.

Riesgos principales: convertir ausente en cero, mezclar mínimo y tarifa, validar números sin su significado, aceptar cotizaciones antiguas, atribuir autoridad a notas humanas sin contrato, ignorar mensajes en cola y que el evaluador confunda subtotal con total. Cada uno tiene una prueba en la matriz anterior.

Esta ampliación **sí requiere cambios puntuales de frontend**, a diferencia del primer alcance backend-only de §7: son necesarios para que cada dueño administre sus dos valores y vea el total. Reutiliza las pantallas existentes. No exige de entrada nuevas tablas, un framework de agentes, un proveedor externo de tarifas ni configuración global.

### 14.11 Seguimiento final de esta ejecución

| Entregable | Estado al cierre local |
|---|---|
| Costo y mínimo independientes, UI y autorización por tienda | Implementados; vacío no equivale a cero; conservación de la configuración previa. |
| Consultas de precios/domicilio y pago por texto | Implementados en los componentes LLM existentes; cálculos e IDs validados por backend. |
| Revisión humana comercial y aceptación posterior del comprador | Implementadas, con resolución tipada y ligada a tenant/canasta/política. No equivale a preparar una orden. |
| Persistencia de desglose y protección concurrente | 36 comprobaciones PostgreSQL local aprobadas; sin nueva migración DDL. Sheets permanece asíncrono. |
| Pruebas focalizadas reales | 15/15 aprobadas, cinco escenarios en tres variantes, sin fallback semántico admitido. |
| Regresiones de contratos/backend/arquitectura y compilación | Aprobadas. Los escenarios con simulador se distinguen de los de DeepSeek real. |
| Campaña contextual general de 50 casos | Ejecutada antes de las correcciones finales: 8 aprobados, 21 clasificados como fallos funcionales, 18 por revisar, 3 errores de evaluador. No aprobada ni reemplazada por el resultado focalizado. |
| Nueva ejecución HTTP/PG de 30 y 32 sobre correcciones finales | 30 aprobado; 32 por revisar. No representa una repetición completa. |
| Repetición posterior de los 50 sobre la versión final congelada | **Completada y auditada:** 13 aprobados, 17 fallos funcionales, 16 revisiones, 2 errores de evaluador, 1 error de infraestructura y 1 fallback de integración. 168 turnos; fuentes y base original sin cambios. No aprobada para autonomía general. |
| Auditoría del runner y de los casos aprobados | 15 pedidos con importes/cantidades y ciclo del tendero correctos; seis aprobados automáticos ocultan defectos. Se separan fallos de VIA, del evaluador y rendimiento. Repetición diagnóstica adicional de 03/17 sin reemplazar resultados: 03 pasó; 17 falla por negativa incorrecta de catálogo. |
| Producción | Sin despliegue, push, mensajes reales ni modificaciones comerciales de tiendas. |

El [informe de implementación](Implementacion-domicilio-precios-pago-local-2026-11-04.md) conserva archivos, evidencias, consumo/latencia, fallos del evaluador y pendientes funcionales. Estos resultados permiten revisar esta ampliación; no acreditan todavía la aptitud de toda VIA para producción.

La [auditoría de la campaña final de 50 casos](Resultado-50-casos-version-final-y-auditoria-2026-11-04.md) conserva la referencia histórica de esa versión: incluye cada conversación, causas contrastadas con archivos, defectos de agregación del evaluador y orden de corrección. En esa tarea se ejecutó y analizó; las correcciones posteriores se documentan por separado en el [seguimiento de causas y correcciones Pareto](Causas-y-correcciones-Pareto-2026-11-04.md), con huellas y resultados de cada versión. No se sustituyó razonamiento contextual por reglas.

### 14.12 Aclaración de alcance: medio de pago y aviso de comprobante

Definición del usuario posterior a la auditoría: **la verificación/cobro del pago corresponde al domiciliario; si el comprador envía un comprobante en imagen, VIA avisa al tendero. VIA no verifica, acredita ni concilia pagos.** Esta definición prevalece sobre cualquier propuesta anterior que convierta el comprobante en una aprobación de pago obligatoria dentro de VIA.

Responsabilidades:

- VIA identifica mediante el LLM la preferencia de pago, la valida contra los medios habilitados por el tenant y la conserva en el pedido. La selección de un medio no significa dinero recibido ni aceptación del pedido.
- El LLM distingue por contexto una preferencia («pagaré por Bre-B»), una declaración («ya transferí»), una imagen anunciada como comprobante y una foto de producto. No se identifica un comprobante únicamente por ser imagen ni se valida su autenticidad por IA.
- Ante un comprobante, VIA conserva la referencia al adjunto y el contexto de conversación/pedido del tenant, registra un aviso accesible al tendero y acusa recibo al comprador. El aviso es informativo: no es una solicitud de aprobación financiera ni un bloqueo automático del alistamiento o despacho.
- La declaración textual de transferencia no acredita dinero ni permite afirmar que se recibió una imagen que aún no llegó. Se comunica al tendero según el contexto, sin iniciar una verificación bancaria dentro de VIA.
- Confirmar, alistar, despachar y cerrar mantienen sus reglas de pedido y consentimiento. No se introduce una condición adicional de «pago verificado por VIA». Recibir un comprobante después del despacho no reabre por sí solo el pedido ni crea una compra nueva.
- No se añaden pasarela, consulta bancaria, OCR validador, conciliación ni un nuevo circuito de estados/aprobación financiera.

Brechas identificadas y cubiertas por la implementación local posterior:

| Componente | Ajuste necesario dentro de este alcance |
|---|---|
| `agentRuntime.js`: `payment_confirmation` | Sustituir el uso de `approval_gate` para registrar pago por aviso informativo al tendero y acuse contextual; no escribir pago acreditado ni bloquear el pedido. |
| `agentRuntime.js`: manejo de imágenes | Reutilizar conservación del adjunto, pero evitar la respuesta universal «retomaremos la cotización con el producto identificado» ante un comprobante. El propósito lo determina el contexto LLM; si no es claro, no inventarlo. |
| Intérprete/resolutor/composer existentes | Distinguir preferencia, declaración y adjunto recibido; redactar el acuse según lo realmente registrado y mantener el hilo del pedido. Sin añadir llamadas ni agentes financieros innecesarios. |
| Registro/aviso al tendero | Reutilizar mecanismos de eventos/atención y referencias de medios. Deduplicar reentregas; conservar tenant, comprador y pedido cuando esté identificado. No vincular a otro pedido por suposición. |
| Fixtures, comprador y juez E2E | Reemplazar la expectativa de «aprobar/registrar pago» de 38/48 por declaración atendida y aviso; añadir un caso con imagen real simulada de comprobante. No exigir pago recibido para confirmar o despachar. |

Criterios de aceptación de esta implementación:

1. Elegir efectivo/tarjeta/Bre-B habilitado conserva preferencia y permite continuar; no exige comprobante ni marca pagado.
2. «Ya transferí y te mando comprobante» recibe respuesta contextual y se comunica al tendero; no afirma haber recibido el archivo ni acreditado fondos.
3. Comprobante en imagen: referencia al adjunto disponible para el tendero del tenant, aviso único y acuse de recepción al comprador, sin aprobación financiera ni bloqueo automático.
4. Foto de producto y comprobante usan su contexto respectivo; una imagen ambigua no se clasifica como pago por defecto.
5. Reintento del mismo webhook no duplica el aviso. «Gracias» posterior no genera otra tarea.
6. Comprobante posterior al cierre conserva el pedido relacionado cuando hay evidencia suficiente; no crea una nueva compra ni reabre automáticamente la anterior.
7. Ningún caso exige que VIA compruebe cobro, autenticidad de comprobante o saldo bancario. El evaluador sí rechaza que VIA afirme haber realizado esas operaciones.

Estado: **implementado y probado localmente, sin despliegue**. Se conserva la interpretación contextual del LLM; `payment_confirmation` queda como nombre compatible para un aviso, no una aprobación financiera. Evidencia, archivos, límites y resultados en [Implementación de avisos de comprobante](Implementacion-avisos-comprobante-local-2026-11-04.md). Los resultados históricos de los 50 casos se conservan; la repetición focalizada de 38/48 aprobó ambos casos con la expectativa corregida, sin declarar aprobados los demás hallazgos pendientes.

### Seguimiento de correcciones causales posteriores

Se implementaron localmente controles de identidad de líneas con reparación del intérprete, continuidad de consultas, recuperación contextual de solicitudes tras timeout, conservación de modalidad de entrega, validación comercial de presupuestos sin cantidad y revisión de respuestas de catálogo/cotización. Se mantiene la separación intérprete → herramientas/resolutor → compositor: no se vuelve a cargar al planner con la selección de SKU, aritmética o verificación de pagos.

También se corrigió el harness: preparación del catálogo sin carrera de escrituras, errores del comprador que no oculten el estado persistido, evaluación contextual de confirmaciones por texto y distinción de subtotales parciales. Los resultados automáticos se contrastan con conversaciones y estado; un cambio del evaluador no se presenta como una nueva ejecución exitosa de VIA.

Seguimiento por causa, archivo, prueba antes/después, campañas y pendientes en [Causas y correcciones](Causas-y-correcciones-Pareto-2026-11-04.md). **Sin commit, push ni despliegue.** La aprobación del piloto requiere una campaña final completa sobre la versión que se decida liberar y medición de carga; las repeticiones focalizadas de versiones distintas no suman 50/50.
