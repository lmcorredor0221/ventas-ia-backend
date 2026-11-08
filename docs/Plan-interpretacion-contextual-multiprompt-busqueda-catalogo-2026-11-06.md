# Plan de interpretación contextual, búsqueda de catálogo y adjudicación LLM

**Fecha:** 2026-11-06
**Estado:** Propuesta detallada, pendiente de aprobación
**Alcance:** análisis y diseño; este documento no implica cambios de código, despliegue ni modificación de contratos en esta etapa.

## 1. Decisión arquitectónica

VIA ya tiene una separación funcional entre interpretación, búsqueda, adjudicación, estado conversacional y redacción. No se propone crear otro planner ni reemplazar los contratos actuales.

La decisión propuesta es conservar los componentes existentes y corregir la responsabilidad efectiva de cada etapa:

```text
Mensaje de Meta
      ↓
AgentRuntime: estado, idempotencia y enrutamiento
      ↓
LLMPlanner.plan(): interpretación contextual e hipótesis de búsqueda
      ↓
ToolRegistry: búsqueda de productos reales del tenant
      ↓
CatalogResolutionService + LLMPlanner.adjudicateCatalogCandidates():
adjudicación contextual sobre candidatos reales
      ↓
AgentRuntime: actualización de canasta y estado
      ↓
LLMPlanner.composeReply(): redacción de hechos validados
      ↓
WhatsApp
```

La mejora principal no consiste en agregar más agentes ni más contratos. Consiste en evitar que la primera llamada del LLM seleccione productos antes de observar los resultados de la herramienta.

## 2. Objetivos

### Objetivos funcionales

- Interpretar saludos, consultas, pedidos, aclaraciones, confirmaciones y cambios de intención usando contexto.
- Comprender modismos colombianos, errores ortográficos, abreviaciones y nombres incompletos.
- Descomponer varios productos sin perder cantidades ni atributos.
- Inferir categoría, marca, familia, presentación y atributos como hipótesis.
- Consultar el catálogo real y aislado del tenant.
- Mostrar únicamente candidatos compatibles con lo solicitado.
- Mantener alternativas cuando exista ambigüedad.
- Actualizar la canasta progresivamente sin duplicar productos.
- Preguntar únicamente por la información que realmente falta.
- Conservar el flujo de selección, confirmación, modificación y escalamiento humano.

### Objetivos técnicos

- No enviar el catálogo completo al LLM.
- Mantener `ventas-ia-llm-plan.v2` compatible.
- Reutilizar `AgentRuntime`, `LLMPlanner`, `ToolRegistry` y `CatalogResolutionService`.
- Mantener la latencia total objetivo por debajo de 8 segundos.
- Reducir sustancialmente el consumo del prompt inicial.
- Obtener telemetría por etapa y no únicamente por conversación completa.
- Preparar la búsqueda para catálogos de 300, 1.000 y 10.000 productos.

## 3. Diagnóstico de la implementación actual

### 3.1 Composición de la aplicación

La aplicación instancia un único `LLMPlanner` y lo entrega a `AgentRuntime`:

- **Componente actual:** `server/index.js`, alrededor de la creación de `LLMPlanner` y `AgentRuntime`.
- **Responsabilidad:** composición de dependencias, no razonamiento de negocio.
- **Conclusión:** existe una fachada LLM común, pero el flujo está dividido funcionalmente.

### 3.2 Interpretación inicial

- **Componente actual:** `server/services/llmPlanner.js`, método `LLMPlanner.plan()`.
- **Prompt actual:** `buildPlannerPrompt()`.
- **Responsabilidades actuales:** intención, contexto, productos, datos del cliente, cantidades, presentación, forma de pago, política comercial, `candidateItems`, `toolPlan`, campos faltantes y estrategia de respuesta.
- **Problema:** el prompt principal está sobrecargado y, en ciertos entornos, recibe el catálogo completo mediante `products`.
- **Consecuencia:** el modelo puede seleccionar o descartar productos antes de usar la herramienta.

### 3.3 Búsqueda de catálogo

- **Componente actual:** `server/services/toolRegistry.js`, método `googleSheetsReadTable()`.
- **Responsabilidad:** leer el catálogo del tenant y aplicar filtros/ranking.
- **Campos considerados:** SKU, nombre, marca, alias, categoría, presentación, presentación normalizada, descripción, familia, etiquetas y atributos.
- **Ranking actual:** `rankRowsByQuery()` utiliza coincidencias exactas, alias, prefijos, campos de apoyo y errores tipográficos.
- **Problema de escala:** la lectura live obtiene el rango completo y luego filtra en memoria. Es aceptable para catálogos pequeños, pero debe medirse para 10.000 productos.

### 3.4 Adjudicación contextual

- **Componente actual:** `server/services/catalogResolutionService.js`.
- **Método LLM:** `LLMPlanner.adjudicateCatalogCandidates()`.
- **Responsabilidad:** evaluar candidatos reales devueltos por la herramienta.
- **Fortaleza:** el prompt de adjudicación recibe un conjunto reducido de candidatos, no el catálogo completo.
- **Regla a conservar:** una adjudicación del LLM no puede seleccionar silenciosamente una variante cuando hay múltiples opciones y el cliente aún no eligió.

### 3.5 Estado y canasta

- **Componente actual:** `server/services/agentRuntime.js`.
- **Responsabilidad:** enrutamiento, estado de conversación, `orderDraft`, cantidades, selección de productos, botones, confirmación, escalamiento y persistencia.
- **Riesgo actual:** algunas funciones de filtrado y selección pueden tratar inferencias del planner como restricciones duras.
- **Principio:** `AgentRuntime` debe garantizar consistencia, no reemplazar el razonamiento del LLM.

### 3.6 Redacción de respuestas

- **Componente actual:** `LLMPlanner.composeReply()` y `buildReplyPrompt()`.
- **Responsabilidad:** redactar los hechos comerciales que ya fueron validados.
- **Regla:** no debe buscar productos, alterar precios, escoger variantes ni inventar información.

## 4. Evidencia del problema de tokens

En la prueba real con DeepSeek y un catálogo aproximado de 300 productos se observaron aproximadamente:

- 48.330 tokens de entrada en la primera llamada del planner.
- 48.501 tokens de entrada en la segunda llamada del planner.
- Más de 100.000 tokens acumulados en una conversación de dos turnos.

Esto confirma que el catálogo completo se vuelve a serializar en el prompt principal en los entornos donde el fallback local está habilitado.

En producción estricta, `listProducts()` puede devolver una lista vacía para evitar usar el catálogo local como fuente de verdad; la herramienta live consulta Google Sheets. Sin embargo, el diseño del prompt sigue permitiendo el acoplamiento y debe corregirse también para pruebas locales, simuladores y futuros entornos.

## 5. Contrato que se conserva

No se modifica el contrato externo `ventas-ia-llm-plan.v2`.

Los campos actuales se reinterpretan de esta manera:

| Campo existente | Uso correcto | No debe significar |
|---|---|---|
| `rawName` | Texto original del cliente | Nombre definitivo del producto |
| `catalogQuery` | Hipótesis de consulta | SKU confirmado |
| `requestedPresentation` | Presentación mencionada o inferida | Variante seleccionada |
| `requestedAttributes` | Atributos expresos o hipótesis | Evidencia de disponibilidad |
| `confidence` | Confianza en la interpretación | Confianza en stock o precio |
| `ambiguityReason` | Motivo de duda o información faltante | Error técnico |
| `skuHint` | SKU solamente si el cliente lo escribió | Primera coincidencia del catálogo |
| `toolPlan` | Intención de consultar una herramienta | Resultado de la búsqueda |
| `responseStrategy` | Próxima estrategia conversacional | Selección automática de producto |
| `order.items` | Líneas interpretadas y en proceso de validación | Canasta definitiva antes de validar |

No se debe pedir al LLM una cadena de pensamiento privada. La telemetría debe registrar decisiones observables, evidencias, confianza y resultado de herramientas, no razonamiento interno sensible o innecesario.

## 6. Diseño del prompt principal

### Componente actual

`buildPlannerPrompt()` en `server/services/llmPlanner.js`.

### Qué se hará

Mantener una sola llamada inicial, pero reorganizar sus instrucciones en secciones claras:

1. Comprensión de la conversación.
2. Identificación de intención.
3. Descomposición de productos.
4. Inferencia contextual de atributos.
5. Plan de búsqueda.
6. Información faltante.
7. Política comercial y seguridad.

### Cómo

El prompt debe indicarle al modelo que:

- conserve el mensaje original;
- formule hipótesis cuando no tenga certeza;
- no elija un producto real antes de consultar la herramienta;
- no convierta una inferencia en una restricción obligatoria sin evidencia;
- mantenga todas las líneas de productos;
- diferencie saludo, pedido, aclaración, adición, modificación y confirmación;
- use el historial para interpretar respuestas cortas;
- marque ambigüedades sin inventar productos;
- recomiende búsqueda cuando exista una hipótesis razonable;
- solicite aclaración cuando la hipótesis sea insuficiente.

### Para qué

Para que DeepSeek use su capacidad de interpretación sin quedar obligado a clasificar y seleccionar en una sola operación.

## 7. Guía semántica global

### Componente nuevo recomendado

`server/prompts/catalogSemanticGuide.js`.

Este archivo sería un recurso de prompt, no un nuevo agente ni un nuevo contrato.

### Qué contendría

Ejemplos pequeños y curados de:

- saludos colombianos;
- solicitudes comerciales;
- errores ortográficos;
- cantidades;
- solicitudes por valor;
- presentaciones;
- categorías y familias;
- marcas incompletas;
- referencias como “la de siempre”;
- respuestas a opciones anteriores.

### Ejemplos

- “Regálame una Coca-Cola litro y medio” → Coca-Cola, presentación 1.5 L, variante pendiente.
- “Ponme dos chocorramos” → producto Chocorramo, cantidad 2, presentación pendiente si hay más de una.
- “Browine Mamai de arequipe” → posible Brownie Mamai de Arequipe, validar en catálogo.
- “Una familiar” → concepto de presentación dependiente del catálogo y del contexto.
- “Qué más” → saludo o continuación según los mensajes anteriores.

### Regla esencial

Los ejemplos son patrones de interpretación, no equivalencias rígidas. No se debe enseñar que:

```text
familiar = 1.5 L
coca = siempre gaseosa
chocorramo = una presentación específica
```

## 8. Perfil semántico por tenant

### Componente nuevo opcional

`server/services/catalogSemanticProfileService.js`.

Debe crearse únicamente si las pruebas muestran que la guía global no es suficiente para vocabulario específico de cada tienda.

### Qué hará

Generará un resumen compacto a partir de los metadatos del catálogo:

```json
{
  "categories": ["Bebidas", "Panadería", "Lácteos"],
  "families": ["Gaseosas", "Ponqués", "Leches"],
  "presentations": ["350 ml", "1 L", "1.5 L", "65 g"],
  "attributeKeys": ["sabor", "variedad", "tipo", "empaque"]
}
```

### Qué no hará

- No enviará precios.
- No enviará stock.
- No enviará todas las filas.
- No reemplazará la herramienta de búsqueda.
- No seleccionará productos.

### Actualización

Se actualizará cuando se importe o sincronice el catálogo del tenant. El perfil debe tener límites de tamaño para evitar convertirse nuevamente en un catálogo serializado.

## 9. Herramienta de búsqueda

### Componente actual

`server/services/toolRegistry.js`, `googleSheetsReadTable()`.

### Qué se hará

Mantener la herramienta como fuente de verdad del catálogo del tenant y revisar sus filtros para separar:

- restricciones explícitas;
- preferencias inferidas;
- criterios de ranking;
- búsqueda amplia por ausencia de evidencia.

### Reglas

- Un SKU escrito explícitamente puede ser filtro exacto.
- Una marca explícita debe priorizarse y validarse.
- Una presentación explícita debe restringir candidatos incompatibles.
- “Grande”, “familiar” o “personal” deben ser preferencias o hipótesis hasta contrastarlas con el catálogo.
- Descripción, familia, tags y atributos deben participar en el ranking.
- La búsqueda debe devolver candidatos limitados y evidencia de coincidencia.

### Componente nuevo futuro, condicionado a pruebas

`server/services/catalogSearchService.js` podría extraer `filterRows()` y `rankRowsByQuery()` de `ToolRegistry` si el archivo continúa creciendo o si se requiere una estrategia de búsqueda específica para PostgreSQL.

No se recomienda crear este componente antes de medir el rendimiento real con 1.000 y 10.000 filas.

## 10. Adjudicación de candidatos

### Componentes actuales

- `server/services/catalogResolutionService.js`.
- `LLMPlanner.adjudicateCatalogCandidates()`.

### Qué se hará

Conservar esta etapa como el principal punto de razonamiento sobre evidencia real.

Debe recibir solamente:

- interpretación inicial;
- conversación reciente;
- canasta actual;
- candidatos devueltos;
- campos coincidentes;
- precios, stock y presentaciones reales.

### Acciones permitidas

- seleccionar un único candidato compatible;
- solicitar selección del cliente;
- pedir aclaración;
- reformular una búsqueda;
- conservar la línea pendiente;
- escalar a humano;
- continuar con otros productos.

### Restricción

El adjudicador no puede inventar SKU, precio, stock o presentación. Si hay múltiples variantes y no existe selección explícita del cliente, deben mantenerse como opciones pendientes.

## 11. Orquestación y estado

### Componente actual

`server/services/agentRuntime.js`.

### Qué se hará

Conservar su responsabilidad de:

- recibir mensajes;
- evitar duplicados;
- cargar conversación;
- ejecutar herramientas;
- actualizar `orderDraft`;
- mantener líneas y `lineId`;
- crear botones;
- confirmar o escalar;
- persistir cambios.

### Qué no debe hacer

- corregir semánticamente el pedido antes del LLM;
- convertir automáticamente el primer resultado en selección;
- descartar una alternativa válida por una inferencia débil;
- reconstruir toda la canasta sin considerar el estado anterior.

### Consistencia determinística permitida

El runtime sí debe impedir:

- duplicados accidentales;
- precios inventados;
- selección de un SKU no ofrecido;
- cambios de otro tenant;
- confirmaciones sin datos mínimos;
- procesamiento doble del mismo mensaje.

## 12. Redacción de respuesta

### Componente actual

`LLMPlanner.composeReply()` y `buildReplyPrompt()`.

### Qué se hará

Mantenerlo como una etapa de presentación basada en hechos cerrados.

Debe recibir:

- productos confirmados;
- candidatos pendientes;
- cantidades;
- precios;
- subtotal;
- domicilio;
- forma de pago;
- pregunta pendiente;
- siguiente acción.

No debe realizar una segunda búsqueda ni modificar los hechos.

## 13. Flujo detallado por mensaje

### Caso A: saludo

1. `AgentRuntime` carga conversación.
2. `LLMPlanner.plan()` interpreta el saludo.
3. No se llama al catálogo.
4. Se responde con `greetingReply`.
5. La canasta existente permanece intacta.

### Caso B: pedido claro

1. El LLM identifica las líneas y cantidades.
2. Genera consultas semánticas.
3. `ToolRegistry` busca productos reales.
4. Si hay un único candidato compatible, se valida.
5. Si faltan datos, se solicitan.
6. Se actualiza la canasta.
7. Se compone la respuesta.

### Caso C: varias alternativas

1. El LLM identifica el producto y sus restricciones.
2. La herramienta devuelve candidatos.
3. `CatalogResolutionService` conserva las opciones.
4. Se muestran botones o alternativas textuales.
5. El cliente responde.
6. El LLM interpreta la selección.
7. Se actualiza únicamente la línea correspondiente.

### Caso D: producto no encontrado

1. El LLM conserva el nombre original.
2. La herramienta busca con variantes razonables.
3. Si no hay evidencia suficiente, el LLM solicita más detalles o escala.
4. No se inventa una coincidencia.

### Caso E: mensajes consecutivos

1. Se persisten todos los mensajes recibidos.
2. Se agrupan los mensajes pendientes de la misma conversación.
3. El LLM interpreta el conjunto con el estado previo.
4. Se decide si son respuesta, aclaración, adición o modificación.
5. Se ejecuta una sola actualización de canasta.

## 14. Iteración controlada

No se propone un ReAct abierto ni un ciclo ilimitado.

Se recomienda como máximo:

1. interpretación inicial;
2. búsqueda de catálogo;
3. adjudicación contextual;
4. una única reformulación si no hay candidatos o la evidencia es insuficiente.

Si después de la reformulación no existe evidencia, se pregunta o se escala.

Esto permite razonamiento progresivo sin crear bucles, costos impredecibles ni latencia excesiva.

## 15. Telemetría requerida

### LLM

- duración de `llm.plan`;
- tokens de entrada y salida;
- tamaño del prompt;
- número de productos enviados al prompt;
- intención;
- confianza;
- cantidad de líneas interpretadas.

### Catálogo

- tiempo de lectura;
- rango consultado;
- número de filas leídas;
- número de candidatos;
- campos coincidentes;
- score;
- número de reformulaciones;
- fuente del catálogo.

### Adjudicación

- número de candidatos enviados;
- decisión del LLM;
- selección automática o del cliente;
- ambigüedades pendientes;
- escalamiento.

### Resultado

- productos confirmados;
- productos rechazados;
- líneas duplicadas evitadas;
- subtotal final;
- respuesta enviada;
- latencia total.

Cada medición debe compartir `traceId`, `tenantId`, `conversationId` y `messageId`.

## 16. Plan de implementación

### Fase 0: línea base

Archivos principales: pruebas E2E existentes y resultados en `test-results/`.

- Ejecutar los 50 casos.
- Guardar tokens, latencia y decisiones.
- Seleccionar regresiones conocidas.

### Fase 1: prompt sin catálogo completo

Archivo actual: `server/services/llmPlanner.js`.

- Retirar `products` completo del prompt de DeepSeek.
- Mantener el contrato de salida.
- Incorporar guía semántica compacta.
- Mantener el catálogo completo únicamente para fallback local aislado, si todavía es necesario.

### Fase 2: semántica colombiana

Componente nuevo propuesto: `server/prompts/catalogSemanticGuide.js`.

- Extraer ejemplos fuera de la lógica principal.
- Versionar la guía.
- Cubrir modismos y escenarios reales.
- Evitar equivalencias rígidas.

### Fase 3: búsqueda y filtros

Archivo actual: `server/services/toolRegistry.js`.

- Verificar que los filtros explícitos sean estrictos.
- Usar inferencias para ranking cuando corresponda.
- Devolver candidatos con evidencia.
- Medir rendimiento con 300, 1.000 y 10.000 productos.

### Fase 4: adjudicación

Archivos actuales: `catalogResolutionService.js` y `llmPlanner.js`.

- Mantener el prompt de adjudicación separado.
- Confirmar que solo reciba candidatos.
- Mantener la protección contra selección silenciosa.
- Añadir una reformulación acotada únicamente cuando sea necesario.

### Fase 5: estado y respuesta

Archivo actual: `server/services/agentRuntime.js`.

- Revisar que no descarte alternativas por inferencias.
- Verificar preservación de la canasta.
- Verificar botones, texto y selecciones.
- Mantener `composeReply()` como redactor de hechos.

### Fase 6: pruebas y comparación

- Ejecutar los 50 casos.
- Comparar contra la línea base.
- Revisar fallos de interpretación, búsqueda, adjudicación y evaluación.
- Medir tokens y latencia.

### Fase 7: despliegue gradual

- Activar primero en local.
- Ejecutar pruebas con DeepSeek real.
- Activar mediante feature flag en un tenant demo.
- Verificar telemetría.
- Desplegar backend y frontend únicamente después de aprobar los resultados.

## 17. Criterios de aceptación

- No se envía el catálogo completo al prompt normal.
- El contrato `ventas-ia-llm-plan.v2` permanece compatible.
- El LLM identifica correctamente intención y productos en los casos conocidos.
- Las inferencias no seleccionan automáticamente variantes incompatibles.
- La búsqueda utiliza descripción, marca, familia, presentación y atributos.
- Las opciones mostradas corresponden al producto solicitado.
- El cliente puede responder por botón o texto.
- La canasta conserva selecciones previas.
- No aparecen productos duplicados.
- No se inventan precios, SKU ni stock.
- El p95 permanece por debajo de 8 segundos.
- El consumo del prompt principal disminuye al menos 90% frente a la línea base.
- Se conserva el aislamiento entre tenants.
- Los casos de escalamiento humano mantienen visible la conversación y el contexto.

## 18. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El LLM genera una consulta demasiado amplia | Mantener `rawName`, confianza y reformulación limitada |
| Se pierde una marca poco común | Búsqueda aproximada usando texto original |
| “Familiar” se convierte en un tamaño fijo | Tratar presentaciones conceptuales como hipótesis |
| El catálogo live tarda demasiado | Medir primero; luego indexar o usar PostgreSQL si es necesario |
| El modelo selecciona la primera coincidencia | Mantener adjudicación y selección explícita |
| Aumentan las llamadas al LLM | Máximo una adjudicación y una reformulación |
| El perfil semántico crece demasiado | Limitar valores, resumir y actualizar por tenant |
| Cambio de comportamiento entre entornos | Registrar fuente del catálogo y modo de ejecución |

## 19. Fuera de alcance inicial

- Cambiar el contrato `ventas-ia-llm-plan.v2`.
- Crear un sistema ReAct abierto.
- Implementar embeddings o RAG.
- Crear múltiples agentes independientes.
- Cambiar el modelo DeepSeek.
- Cambiar el flujo de Meta.
- Rediseñar la canasta o los botones.
- Desplegar a producción antes de completar la validación local.

## 20. Resultado esperado

VIA debe funcionar como una cadena de responsabilidades coordinadas, no como un único prompt que intenta resolverlo todo:

```text
DeepSeek comprende
      ↓
La herramienta busca
      ↓
DeepSeek compara evidencia
      ↓
AgentRuntime conserva el estado
      ↓
DeepSeek redacta
```

La estabilidad se conserva porque se reutilizan los componentes actuales y el contrato existente. La mejora se concentra en retirar el catálogo completo del prompt inicial, permitir razonamiento progresivo y asegurar que las decisiones del LLM se basen en candidatos reales del tenant.
