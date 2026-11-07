# Plan consolidado: interpretación contextual, catálogo híbrido y grafo de productos

**Fecha:** 2026-11-07
**Estado:** Implementado y validado localmente; pendiente revisión, commit y despliegue
**Alcance actual:** separación de interpretación/inferencia, índice derivado por tenant, relaciones genéricas, sincronización versionada y telemetría. No se ha desplegado ni modificado producción.

## Estado de ejecución de esta versión

Se implementó la primera fase sin reemplazar la fachada `LLMPlanner` ni el contrato `ventas-ia-llm-plan.v2`:

- `server/prompts/catalogSemanticGuide.js`: contratos separados para contexto/intención e inferencia de productos.
- `server/services/contextInterpreterService.js` y `server/services/productInferenceService.js`: fachadas especializadas sobre el planner existente.
- `server/services/catalogKnowledgeIndex.js`: índice por tenant con familias, productos, presentaciones, atributos, relaciones y fingerprint vectorial léxico.
- `server/services/catalogSearchService.js`: publicación atómica en memoria/estado y telemetría de sincronización.
- `server/domain/catalogRelations.js`: tipos de nodos y relaciones genéricas; no contiene reglas por familia.
- `server/services/toolRegistry.js`: cada lectura de catálogo publica o reutiliza una `catalog_version` estable y devuelve evidencia del índice.
- `server/db/migrations/015_catalog_knowledge_indexes.sql`: persistencia de la versión publicada y del documento derivado en PostgreSQL.
- `server/store/postgresStore.js`: escritura idempotente del índice derivado, sin tocar tablas operativas de pedidos.
- `server/tests/catalog-knowledge-index.mjs`: aislamiento por tenant, variantes compatibles, versionado y búsqueda.

La implementación local usa un fingerprint vectorial determinista de bajo costo como índice auxiliar de recuperación. No pretende sustituir embeddings semánticos ni el razonamiento de DeepSeek: el LLM interpreta el lenguaje y el índice solo recupera evidencia real. La adopción de embeddings de un proveedor externo queda como una optimización posterior, condicionada a métricas de precisión y latencia.

## Estado final de ejecución y correcciones

La validación detectó y corrigió una regresión en el contrato entre el planificador y la herramienta de catálogo. El planificador sí producía candidatos separados, pero el runtime enviaba únicamente los filtros y omitía el texto específico de cada candidato al llamar a `google_sheets_read_table`. Como consecuencia, varias líneas podían recuperar las mismas primeras filas y la deduplicación ocultaba productos válidos.

La corrección conserva la separación de responsabilidades y aplica estas reglas de contrato:

- Los candidatos concretos interpretados por el LLM se envían como `query` a la búsqueda especializada.
- Las consultas de categoría amplia conservan solo el filtro de categoría; no se estrechan artificialmente con la frase completa del cliente.
- Las consultas por SKU usan el filtro estructurado sin contaminarlo con texto libre.
- La respuesta de categoría se identifica como tal para poder ofrecer resultados representativos sin confundirlos con una coincidencia de producto concreto.
- La evidencia sigue siendo exclusivamente la del catálogo del tenant y se conserva `catalog_version`.

Esto resuelve el caso de solicitudes combinadas como “arroz, aceite o huevos”, mantiene las búsquedas por SKU y evita perder alternativas por una deduplicación causada por consultas idénticas. No se añadió una regla específica para una familia: la decisión sigue partiendo de la interpretación del LLM y la herramienta solo recupera evidencia verificable.

## Validación ejecutada

Se ejecutó localmente, sin despliegue:

1. `npm run test:catalog`: pasó importación CSV, contrato enriquecido, runtime, recuperación, índice de conocimiento, regresión de ambigüedad y reconciliación de selección.
2. `node server/tests/colombia-scenarios.mjs`: pasó 50 escenarios y 63 pasos.
3. `node server/tests/whatsapp-commerce-policy.mjs`: pasó las restricciones de comercio del canal.
4. `npm test`: pasó la suite general, incluyendo smoke backend, identidad/contexto, continuidad de checkout, concurrencia y errores, recuperación JSON, proveedor LLM, autenticación, integraciones Google/WhatsApp, Embedded Signup y política comercial.
5. `git diff --check`: sin errores de espacios o formato.

La suite produjo líneas de error esperadas en pruebas de contratos de fallos, pero el resultado final de los comandos fue exitoso. No se usó la base de datos productiva ni se enviaron mensajes reales como parte de esta validación.

### Medición de latencia del índice

Se ejecutó una medición local aislada del componente nuevo, sin DeepSeek, Google, WhatsApp ni PostgreSQL:

| Filas del catálogo | Construcción del índice | Búsqueda en índice |
|---:|---:|---:|
| 20 | 4,3 ms | 6,1 ms |
| 300 | 57,4 ms | 67,9 ms |
| 1.000 | 195,1 ms | 186,5 ms |

Estos valores representan el costo local del índice y no una medición end-to-end. Por tanto, el cambio no explica por sí solo respuestas de varios minutos ni altera el consumo de tokens de DeepSeek. La latencia dominante debe seguir midiéndose por etapa: lectura de Google, llamada al LLM, PostgreSQL/cola y envío a Meta.

La implementación actual sincroniza el índice durante cada lectura de catálogo. Si una solicitud contiene varias líneas, el runtime ejecuta esas lecturas en paralelo, por lo que el tiempo de pared se aproxima al candidato más lento, pero aumenta el trabajo total y las lecturas externas. La siguiente optimización recomendada es reutilizar una lectura/sincronización por mensaje y resolver todas las líneas sobre la misma `catalog_version`; no forma parte de esta ejecución para preservar la estabilidad validada.

## 1. Objetivo

Mejorar la comprensión de pedidos de VIA sin convertir el agente en un flujo rígido ni delegar al LLM responsabilidades que corresponden al catálogo y al backend.

El objetivo es que VIA pueda interpretar correctamente expresiones como:

- “Una Coca-Cola de litro y medio”.
- “Un Chocorramo”.
- “Browine Mamai de arequipe”.
- “La familiar de la misma marca”.
- “La otra, pero sin azúcar”.

El sistema debe:

1. Comprender el contexto conversacional.
2. Inferir la familia, producto conceptual, categoría, presentación, cantidad, sabor y atributos solicitados.
3. Buscar productos reales del catálogo del tenant.
4. Usar las relaciones entre familias, variantes y presentaciones.
5. Resolver ambigüedades mediante el LLM.
6. Actualizar progresivamente la canasta.
7. Presentar un resumen únicamente con productos, precios y atributos verificados.

## 2. Decisión arquitectónica

El flujo correcto es:

```text
Mensaje de WhatsApp
        ↓
LLM: contexto e intención
        ↓
LLM: inferencia estructurada de productos
        ↓
Búsqueda especializada del catálogo
        ↓
Grafo de familias, variantes y relaciones
        ↓
LLM: adjudicación contextual de candidatos
        ↓
Estado y canasta de VIA
        ↓
Resumen, botones y respuesta por WhatsApp
```

La separación es funcional y contractual. No se debe crear un agente monolítico que interprete, busque, seleccione, calcule y cierre el pedido en una sola llamada.

## 3. Principios no negociables

### 3.1 El LLM interpreta primero

El LLM debe analizar el mensaje actual, el historial, la canasta y las preguntas pendientes antes de decidir qué representa el mensaje.

Debe identificar si el cliente:

- saluda;
- consulta disponibilidad;
- inicia un pedido;
- responde una pregunta;
- selecciona una variante;
- agrega productos;
- modifica cantidades;
- elimina productos;
- confirma;
- solicita atención humana;
- envía un comprobante.

### 3.2 El LLM infiere hipótesis, no inventa SKUs

El LLM puede inferir:

- familia;
- producto conceptual;
- categoría;
- marca;
- presentación;
- sabor;
- cantidad;
- valor solicitado;
- atributos;
- relaciones entre productos.

No puede afirmar que un SKU, precio o stock existe sin evidencia del catálogo.

### 3.3 El catálogo busca y verifica

La búsqueda debe ser responsabilidad de una herramienta especializada, aislada por tenant.

El catálogo devuelve candidatos reales y evidencia de coincidencia. No debe seleccionar arbitrariamente la primera fila.

### 3.4 El grafo representa relaciones, no reglas por familia

El grafo no debe implementarse como una colección de condiciones:

```js
if (family === 'coca-cola') { ... }
```

Debe utilizar relaciones genéricas que funcionen para cualquier familia:

```text
familia → variantes → presentaciones → sabores → alternativas
```

### 3.5 El backend conserva las invariantes

VIA debe controlar fuera del LLM:

- tenant propietario;
- precio vigente;
- stock;
- cálculo de subtotal;
- costo del domicilio;
- mínimo de domicilio;
- productos restringidos;
- estado del pedido;
- idempotencia;
- persistencia.

## 4. Situación actual de VIA

La solución ya tiene una separación parcial:

```text
AgentRuntime
   ↓
LLMPlanner.plan()
   ↓
ToolRegistry.googleSheetsReadTable()
   ↓
CatalogResolutionService
   ↓
AgentRuntime actualiza orderDraft
   ↓
LLMPlanner.composeReply()
```

Componentes actuales:

- `server/services/agentRuntime.js`: enrutamiento, estado, pedido, escalamiento y persistencia.
- `server/services/llmPlanner.js`: interpretación inicial, adjudicación y redacción.
- `server/services/toolRegistry.js`: lectura y búsqueda de catálogo.
- `server/services/catalogResolutionService.js`: adjudicación contextual sobre candidatos reales.
- `server/services/usageService.js`: consumo y telemetría del LLM.

### Brecha principal

`buildPlannerPrompt()` todavía puede incluir el catálogo completo en el prompt principal:

`server/services/llmPlanner.js`

Esto hace que el planner intente interpretar el lenguaje y conocer todo el catálogo al mismo tiempo. En las pruebas anteriores se observaron aproximadamente 48.000 tokens por llamada del planner con 300 productos.

El flujo actual también representa las variantes principalmente como listas planas (`presentationOptions`). No existe todavía una estructura explícita de familias y relaciones que permita navegar de forma genérica entre:

- familia;
- producto vendible;
- presentación;
- sabor;
- variante;
- alternativa;
- sustituto.

## 5. Etapa 1: intérprete de contexto e intención

### Responsabilidad

Interpretar la conversación sin cargar el catálogo.

### Entrada

```json
{
  "message": "Una Coca-Cola litro y medio y un chocorramo",
  "history": [],
  "orderDraft": {},
  "pendingSelection": null,
  "customerProfile": {},
  "tenantPolicy": {}
}
```

### Salida propuesta

```json
{
  "intent": "delivery_order",
  "dialogueAct": "new_order",
  "productRequestDetected": true,
  "respondsToPendingQuestion": false,
  "addsToExistingCart": false,
  "modifiesExistingCart": false,
  "customerDetails": {
    "name": null,
    "address": null
  },
  "pendingAction": null,
  "confidence": 0.96
}
```

No debe devolver productos seleccionados ni SKUs.

## 6. Etapa 2: inferencia estructurada de productos

Solo se ejecuta cuando la etapa de contexto detecta una intención relacionada con productos.

### Entrada

```json
{
  "message": "Una Coca-Cola litro y medio y un chocorramo",
  "conversationAnalysis": {},
  "orderDraft": {}
}
```

### Salida propuesta

```json
{
  "items": [
    {
      "lineId": "coca-cola-1",
      "rawText": "Coca-Cola litro y medio",
      "familyHypothesis": "Coca-Cola",
      "productHypothesis": "gaseosa Coca-Cola",
      "category": "gaseosa",
      "brand": "Coca-Cola",
      "quantity": 1,
      "budgetAmount": null,
      "explicitAttributes": {
        "presentation": "1.5 L"
      },
      "inferredAttributes": {},
      "uncertainties": ["variant"],
      "searchQuery": "Coca-Cola 1.5 L",
      "confidence": 0.95
    },
    {
      "lineId": "chocorramo-2",
      "rawText": "chocorramo",
      "familyHypothesis": "Chocorramo",
      "productHypothesis": "ponqué Chocorramo",
      "category": "ponqué",
      "brand": "Ramo",
      "quantity": 1,
      "budgetAmount": null,
      "explicitAttributes": {},
      "inferredAttributes": {},
      "uncertainties": ["presentation"],
      "searchQuery": "Chocorramo",
      "confidence": 0.91
    }
  ]
}
```

### Reglas de interpretación

- Conservar siempre el texto original.
- Separar atributos explícitos de atributos inferidos.
- No convertir una inferencia en una restricción obligatoria.
- Mantener cantidades y valores solicitados.
- Corregir ortografía solo como hipótesis verificable.
- No seleccionar un SKU.
- No inventar precios, stock o presentaciones.

## 7. Etapa 3: búsqueda especializada

La herramienta recibe la inferencia estructurada y consulta el catálogo real del tenant.

### Estrategia de búsqueda

```text
Restricciones explícitas
        +
Nombre y alias normalizados
        +
Descripción y atributos
        +
Tolerancia ortográfica
        +
Similitud semántica opcional
        ↓
Candidatos reales
```

### Prioridad de filtros

| Tipo de atributo | Tratamiento |
|---|---|
| Marca explícita | Restricción obligatoria |
| Presentación explícita | Restricción obligatoria |
| Sabor explícito | Restricción obligatoria |
| Categoría explícita | Restricción fuerte |
| Atributo inferido | Evidencia, no filtro absoluto |
| “Familiar”, “grande”, “personal” | Interpretación contextual |
| Atributo ausente | Ambigüedad pendiente |

La búsqueda puede utilizar texto, PostgreSQL, `pg_trgm` y posteriormente `pgvector`. Google Sheets/Drive continúa siendo la fuente operativa mientras PostgreSQL actúa como índice derivado.

### Sincronización obligatoria del índice

Cada modificación del catálogo en Drive/Sheets debe actualizar los índices derivados del tenant:

```text
Cambio en Drive/Sheets
        ↓
Detección de cambio y nueva catalog_version
        ↓
Normalización de productos y atributos
        ↓
Actualización de familias y relaciones del grafo
        ↓
Regeneración o actualización de embeddings
        ↓
Publicación atómica de la nueva versión
```

La base vectorial y el grafo nunca deben quedar en una versión diferente a la del catálogo operativo. La sincronización debe ser por tenant y debe conservar:

- `tenant_id`;
- `catalog_version`;
- hash o huella del archivo y del rango utilizado;
- fecha de lectura;
- estado de sincronización;
- cantidad de filas procesadas;
- cantidad de nodos, relaciones y vectores generados;
- errores de validación;
- última versión publicada para búsqueda.

Mientras una nueva versión se procesa, el sistema debe continuar utilizando la última versión válida. No se debe publicar una versión parcial.

Si una fila se modifica, agrega o elimina, la sincronización puede actualizar únicamente los productos y relaciones afectados. Si no es posible determinar el cambio con seguridad, se debe reconstruir el índice completo del tenant de forma idempotente.

El proceso debe invalidar la versión anterior únicamente después de completar y validar la nueva versión. Las consultas de búsqueda deben utilizar una sola `catalog_version` durante toda la operación para evitar mezclar candidatos de distintas versiones.

## 8. Etapa 4: grafo de familias y productos

El grafo es un componente obligatorio del modelo de relaciones, aunque la primera implementación física pueda usar PostgreSQL.

### Nodos

```text
Tenant
Familia
Producto / SKU
Marca
Categoría
Presentación
Sabor
Atributo
```

### Relaciones

```text
PRODUCT_BELONGS_TO_FAMILY
PRODUCT_HAS_PRESENTATION
PRODUCT_HAS_VARIANT
PRODUCT_HAS_FLAVOR
PRODUCT_HAS_ATTRIBUTE
PRODUCT_SAME_BRAND
PRODUCT_ALTERNATIVE_OF
PRODUCT_SUBSTITUTE_OF
PRODUCT_RELATED_TO
```

### Ejemplo Coca-Cola

```text
Familia Coca-Cola
├── Original 350 ml
├── Original 1.5 L
├── Sin azúcar 1.5 L
└── Sin azúcar 3 L
```

Interpretación del LLM:

```text
familia = Coca-Cola
presentación explícita = 1.5 L
variante = desconocida
```

Consulta genérica del grafo:

```text
Buscar variantes de la familia Coca-Cola
que tengan presentación 1.5 L
```

Resultado:

```text
Original 1.5 L
Sin azúcar 1.5 L
```

No se muestran 350 ml ni 3 L porque contradicen la presentación explícita.

### Aislamiento por tenant

Todas las relaciones deben estar identificadas por `tenant_id` y `catalog_version`.

No se deben compartir familias, productos, precios, stock ni relaciones entre tenants, aunque tengan nombres iguales.

## 9. Modelo físico recomendado

El modelo de grafo debe existir desde la primera fase. Para reducir riesgo operativo, inicialmente puede representarse en PostgreSQL:

```text
catalog_families
catalog_products
catalog_attributes
catalog_product_relations
catalog_search_documents
```

Una base de grafos nativa como Neo4j puede evaluarse posteriormente si se demuestra que las consultas requieren navegación de muchos saltos o relaciones más complejas.

Esto no convierte el diseño en determinístico. Las tablas representan conocimiento y relaciones; el LLM sigue interpretando la conversación y decide cómo usar la evidencia.

## 10. Etapa 5: adjudicación contextual

Se reutiliza `CatalogResolutionService`.

El adjudicador recibe:

- mensaje original;
- interpretación del LLM;
- historial;
- canasta;
- candidatos reales;
- relaciones encontradas;
- atributos explícitos;
- incertidumbres.

Puede devolver:

```text
select
ask
preserve
remove
handoff
```

### Reglas de seguridad

- Una coincidencia compatible y única puede seleccionarse.
- Varias variantes compatibles requieren pregunta.
- Una selección textual del cliente puede confirmar una variante.
- Una variante incompatible con una presentación explícita debe rechazarse.
- No se puede inventar SKU, precio, stock o atributos.
- Si la evidencia es insuficiente, se pregunta o se escala.

## 11. Estado de la canasta

Cada línea debe conservar:

```text
lineId
rawText
familyHypothesis
productHypothesis
quantity
budgetAmount
explicitAttributes
inferredAttributes
candidates
selectedProduct
selectionStatus
pendingQuestion
selectionEvidence
```

Estados mínimos:

```text
interpreted
searching
pending_selection
selected
not_found
handoff
removed
```

Una línea `pending_selection` no puede entrar como producto definitivo en el resumen ni en la orden confirmada.

## 12. Búsqueda vectorial y grafo

Cumplen funciones diferentes:

| Componente | Función |
|---|---|
| LLM | Interpretar el lenguaje y generar hipótesis |
| Texto estructurado | Buscar por campos y atributos |
| Vectorial | Relacionar expresiones semánticamente parecidas |
| Grafo | Navegar familias, variantes y relaciones |
| LLM adjudicador | Resolver ambigüedades con evidencia |
| Backend | Aplicar invariantes comerciales |

No se debe utilizar la similitud vectorial para ignorar una presentación explícita.

No se debe utilizar el grafo para interpretar directamente lenguaje coloquial.

## 13. Prompt y caché de DeepSeek

No se recomienda cargar todo el catálogo en el prompt `system` como mecanismo principal.

El prompt estable puede contener:

- instrucciones globales;
- guía semántica breve;
- contrato de salida;
- reglas de seguridad.

El catálogo debe consultarse mediante la búsqueda especializada y el grafo. Esto reduce el contexto, evita información obsoleta y mantiene la responsabilidad del catálogo fuera del planner.

El caché puede utilizarse para instrucciones estables, pero no debe reemplazar la indexación del catálogo.

## 14. Latencia y costos

Para preservar el objetivo actual de latencia p95 de 8 segundos:

- El intérprete de contexto no recibe el catálogo.
- La inferencia de productos se ejecuta solo cuando corresponde.
- Las búsquedas de varias líneas se ejecutan en paralelo.
- La expansión del grafo debe ser local o de baja latencia.
- La adjudicación LLM solo se ejecuta cuando existe ambigüedad.
- La redacción final reutiliza el compositor actual.
- Se registra latencia y tokens por etapa.

El flujo de coincidencia única sería:

```text
Contexto → Inferencia → Búsqueda/Grafo → Respuesta
```

El flujo ambiguo sería:

```text
Contexto → Inferencia → Búsqueda/Grafo → Adjudicación → Pregunta
```

No se propone un ciclo ReAct abierto. La búsqueda progresiva debe ser acotada, observable e idempotente.

## 15. Archivos involucrados

### Reutilizar y ajustar

- `server/services/agentRuntime.js`
- `server/services/llmPlanner.js`
- `server/services/catalogResolutionService.js`
- `server/services/toolRegistry.js`
- `server/services/usageService.js`
- contratos y pruebas de pedidos existentes.

### Componentes nuevos propuestos

- `server/services/contextInterpreterService.js`
- `server/services/productInferenceService.js`
- `server/services/catalogSearchService.js`
- `server/domain/catalogRelations.js`
- `server/prompts/catalogSemanticGuide.js`

### Persistencia futura

- migraciones para familias;
- atributos normalizados;
- relaciones de productos;
- documentos de búsqueda;
- versión del catálogo por tenant;
- embeddings opcionales.

La introducción de archivos nuevos no debe romper `LLMPlanner` ni el contrato externo existente. Se recomienda mantener una fachada compatible durante la transición.

## 16. Plan de implementación

### Fase 0: línea base

- Ejecutar nuevamente los 50 casos.
- Registrar interpretación, búsqueda, candidatos y selección.
- Medir variantes incorrectas, duplicados y escalamiento.
- Comparar contra la conversación real de SuperMarket.

### Fase 1: separación de contratos

- Separar formalmente contexto e inferencia.
- Eliminar el catálogo completo del prompt del intérprete.
- Mantener `rawText`, hipótesis y atributos explícitos.
- Mantener el contrato externo compatible.

### Fase 2: modelo de familias, relaciones y sincronización

- Definir familias y variantes.
- Crear relaciones genéricas.
- Sincronizar automáticamente desde Drive/Sheets.
- Detectar modificaciones, altas y eliminaciones del catálogo.
- Crear una nueva `catalog_version` por cambio publicado.
- Actualizar de forma incremental el índice vectorial y el grafo.
- Mantener una versión anterior válida durante la reindexación.
- Publicar la nueva versión de forma atómica.
- Reintentar fallos sin duplicar nodos, relaciones ni embeddings.
- Versionar el índice.

### Fase 3: búsqueda híbrida sobre una versión sincronizada

- Búsqueda estructurada.
- Texto normalizado y tolerante a errores.
- Descripción, alias y atributos.
- Vectorial únicamente si mejora los casos medidos.
- Resolver siempre contra la `catalog_version` publicada del tenant.
- Rechazar o poner en espera una consulta si el catálogo no tiene una versión válida.

### Fase 4: adjudicación contextual

- Reutilizar `CatalogResolutionService`.
- Mostrar únicamente alternativas compatibles.
- Evitar selecciones silenciosas.
- Conservar selecciones y pendientes por `lineId`.

### Fase 5: validación

Probar:

- Coca-Cola 1.5 L con Original y Zero.
- Chocorramo normal y mini.
- Brownie Mamai con error ortográfico.
- Presentaciones personal, grande y familiar.
- Solicitudes por valor.
- Productos en varios mensajes.
- Adiciones y eliminaciones.
- Cambios de variante.
- Respuestas por texto y botones.
- Productos no encontrados.
- Stock insuficiente.
- Escalamiento humano.

## 17. Telemetría

Cada mensaje debe tener una traza con:

```text
traceId
tenantId
conversationId
messageId
catalog_version
catalog_sync_status
context_duration_ms
inference_duration_ms
search_duration_ms
graph_duration_ms
adjudication_duration_ms
reply_duration_ms
input_tokens_by_stage
output_tokens_by_stage
interpreted_items
candidate_count
selected_sku
pending_selections
handoff_reason
```

También deben existir eventos operativos de sincronización:

```text
catalog.sync.started
catalog.sync.source_read
catalog.sync.normalized
catalog.sync.graph_updated
catalog.sync.vector_index_updated
catalog.sync.published
catalog.sync.failed
```

Cada evento debe incluir `tenantId`, `catalogVersion`, duración, filas leídas, nodos, relaciones, vectores, errores y versión anterior. Esto permitirá saber si una búsqueda utilizó el catálogo recién actualizado o una versión anterior válida.

No se debe almacenar razonamiento privado del modelo. Se registran decisiones observables, evidencia y resultados.

## 18. Criterios de aceptación

- El LLM identifica correctamente la intención antes de buscar.
- El LLM identifica familia, producto conceptual, categoría, presentación y cantidad.
- La búsqueda solo devuelve productos reales del tenant.
- El grafo encuentra variantes relacionadas de forma genérica.
- Se respetan las presentaciones explícitas.
- No se seleccionan variantes arbitrariamente.
- Se muestran únicamente opciones compatibles.
- Se conservan las líneas y cantidades de la canasta.
- Se evitan duplicados.
- Se entiende la selección por texto o botón.
- Se pregunta solo por la ambigüedad pendiente.
- Se escalan casos sin evidencia suficiente.
- El resumen contiene únicamente productos verificados.
- No se cruza información entre tenants.
- La latencia p95 permanece dentro de 8 segundos.
- No se degrada el comportamiento de los casos ya exitosos.

## 19. Decisión final

La arquitectura aprobada conceptualmente debe ser:

```text
LLM interpreta contexto
      ↓
LLM infiere familia, producto y atributos
      ↓
Catálogo busca productos reales
      ↓
Grafo navega familias, variantes y relaciones
      ↓
LLM adjudica ambigüedades
      ↓
VIA actualiza y valida la canasta
```

El grafo no será reemplazado por reglas `if`. Será una representación genérica de conocimiento del catálogo por tenant.

La búsqueda vectorial ayudará a localizar familias y productos cuando el lenguaje sea imperfecto. El grafo resolverá relaciones y variantes. El LLM conservará la responsabilidad de comprender el contexto y decidir cómo continuar la conversación.

La implementación y las pruebas de este plan se realizaron localmente. No se hizo commit, push ni despliegue como parte de esta ejecución; quedan como una actividad posterior explícita para revisión del diff y aprobación del usuario.
