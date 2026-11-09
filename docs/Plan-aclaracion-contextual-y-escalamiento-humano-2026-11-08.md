# Plan: aclaración contextual antes del escalamiento humano

**Fecha:** 8 de noviembre de 2026

**Estado:** Implementado y validado localmente — pendiente de activación controlada por tenant.

**Alcance:** continuidad conversacional ante solicitudes vagas, ambiguas o sin coincidencia de catálogo.
**Línea base que se debe preservar:** `00329e4` (ancestro de la rama actual), especialmente reconocimiento, alternativas, selección y consolidación de productos.

## 1. Objetivo y resultado esperado

VIA debe actuar como vendedor conversacional: ante una petición comercial insuficiente, primero interpreta el contexto y formula hasta **dos aclaraciones específicas generadas por el LLM**. Solo debe escalar a una persona cuando:

1. las dos rondas no resuelven la misma ambigüedad;
2. el cliente solicita explícitamente hablar con la tienda;
3. existe un reclamo operativo, una restricción de política o un fallo técnico que exige intervención; o
4. el tendero toma manualmente control de la conversación.

El contador de dos rondas es una protección operacional, no un árbol de decisión ni un clasificador por palabras. DeepSeek interpreta el mensaje, el historial, las alternativas y lo ya preguntado; el backend solo conserva estado, aplica políticas obligatorias y evita bucles.

## 2. Diagnóstico cruzado con el repositorio

### 2.1 Evidencia de producción ya corroborada

Para la conversación del cliente terminado en `5060`:

| Hecho | Evidencia | Conclusión |
| --- | --- | --- |
| DeepSeek entendió una solicitud comercial de dos ítems. | Dos etapas: interpretación de contexto e inferencia de productos. | No fue un saludo ni una incapacidad inicial de comprensión. |
| El catálogo respondió candidatos. | 22 candidatos para gaseosas y 25 para papas. | No fue ausencia de catálogo ni fallo de PostgreSQL. |
| No hubo `catalog.reconciliation`. | Telemetría de la misma traza. | La ruta de selección contextual no intervino; la evidencia no quedó como alternativa pendiente. |
| Después apareció una tarea humana. | Respuesta observada: “lo subo a validación con la tienda”. | La ambigüedad se transformó prematuramente en escalamiento. |
| Un mensaje posterior tardó 192 ms, sin DeepSeek, catálogo ni envío. | Traza de producción posterior. | El mensaje quedó registrado y fue detenido antes del análisis por una tarea pendiente. |

La reconstrucción completa y sus límites están en [Diagnostico-checkout-seleccion-y-rollback-2026-11-08.md](Diagnostico-checkout-seleccion-y-rollback-2026-11-08.md).

### 2.2 Ruta actual y puntos confirmados en código

| Componente | Estado actual | Riesgo confirmado |
| --- | --- | --- |
| `server/config.js` | `CONTEXTUAL_PRODUCT_SELECTION_V2` es opt-in y por defecto es `false`. | Si no está activo, se usa el fallback legado, que no conserva alternativas para aclaración contextual. |
| `server/services/catalogResolutionService.js` | Puede mantener productos como `selectionStatus: 'pending'`, candidatos y pregunta contextual. | Solo funciona si la bandera está activa y el planificador puede adjudicar candidatos. |
| `server/services/agentRuntime.js` — `handleDeliveryOrder` | Un ítem sin producto produce `product:<consulta>` salvo que ya esté como selección pendiente con candidatos. | `needsHumanProductResolution` considera `product:`, `price:` y `stock:` como escalamiento obligatorio. |
| `server/services/agentRuntime.js` — `processInbound` | `hasOpenHumanRequest(...)` retorna antes de `routeConversation`. | Una tarea pendiente impide toda nueva interpretación de DeepSeek y toda respuesta automática. |
| `server/services/pendingRequestPolicy.js` | Mezcla `human_handoff`, `approval.requested` y `decision.requested` en la misma condición de bloqueo. | Una aprobación comercial o una transferencia humana tienen semánticas distintas, pero hoy inmovilizan igual la conversación. |
| `server/services/events.js` y `server/services/toolRegistry.js` | Crean/reutilizan solicitudes pendientes para eventos humanos y de aprobación. | Falta una separación explícita entre “aclaración automática abierta”, “humano tomó el caso” y “aprobación de operación”. |
| `server/services/llmPlanner.js` | El contrato principal indica que ambigüedad o producto no encontrado debe seguir como flujo comercial. | La orquestación posterior contradice ese contrato cuando convierte el faltante en `product:<consulta>`. |
| `server/tests/backend-smoke.mjs` | Prueba como comportamiento esperado que, con `human_handoff` abierto, un mensaje posterior no genera respuesta del agente. | La regresión está codificada como contrato de prueba; debe modificarse únicamente tras definir los tipos de bloqueo. |

### 2.3 Hipótesis de causa raíz

**Hipótesis confirmada con evidencia de código y telemetría:** el problema no se origina en el razonamiento de DeepSeek ni en la recuperación de catálogo. Nace en la transición entre recuperación y estado conversacional:

1. la ruta legado no conserva candidatos como selección pendiente;
2. `handleDeliveryOrder` registra `product:<consulta>`;
3. `needsHumanProductResolution` eleva ese faltante a `human_handoff`;
4. la tarea pendiente hace que `processInbound` no llame nuevamente a DeepSeek.

Esto explica tanto el escalamiento prematuro como el silencio posterior. La hipótesis debe volver a verificarse con trazas de staging/local antes de cambiar producción.

## 3. Principios de diseño para la corrección

1. **LLM para interpretación, backend para integridad.** DeepSeek decide qué quiso decir el cliente, qué ambigüedad sigue vigente y qué pregunta concreta corresponde. El backend conserva el estado y aplica políticas/comercio.
2. **Catálogo como evidencia, no como decisión implícita.** La búsqueda devuelve candidatos reales; no elige SKU ni descarta una solicitud por no haber coincidencia textual exacta.
3. **Una ambigüedad es un estado, no una tarea humana.** Mientras pueda aclararse, no se crea `human_handoff`.
4. **Alcance de aclaración estable.** Dos mensajes sobre la misma necesidad no reinician el contador. Una nueva necesidad material o una resolución válida cierra el alcance anterior y puede abrir otro.
5. **Escalamiento humano explícito y reversible.** Solo una toma humana real bloquea al agente; al cerrarse se puede retomar desde el estado conservado.
6. **Compatibilidad incremental.** No reescribir búsqueda, selección interactiva, checkout ni consolidación que ya funcionan desde `00329e4`.

## 4. Diseño objetivo mínimo

### 4.1 Estado persistido de aclaración

Agregar a la conversación un objeto JSON pequeño y versionado, sin crear una tabla nueva en la primera entrega:

```json
{
  "version": 1,
  "status": "open",
  "scopeKey": "catalog:gaseosas|papas",
  "kind": "catalog_ambiguity",
  "attempts": 1,
  "maxAttempts": 2,
  "unresolvedLineIds": ["gaseosa-1", "papas-1"],
  "lastQuestion": "¿Qué gaseosa y qué papas prefieres?",
  "evidence": {
    "candidateCounts": { "gaseosa-1": 22, "papas-1": 25 },
    "catalogVersion": "..."
  },
  "openedAt": "...",
  "updatedAt": "..."
}
```

Ubicación propuesta: `conversation.clarificationState`. Si el almacenamiento PostgreSQL actual no persiste campos nuevos del documento de conversación, la primera tarea debe añadir una migración JSON mínima y compatible; no se utilizará una tabla independiente salvo que el modelo actual lo exija.

No se persiste cadena de razonamiento del modelo. Solo estado operativo, candidatos resumidos, pregunta enviada y evidencia suficiente para auditar la transición.

### 4.2 Ciclo contextual

1. El runtime recibe el mensaje y recupera conversación, canasta y aclaración abierta.
2. DeepSeek recibe el historial compacto, el mensaje reciente, la canasta y los candidatos reales disponibles. Devuelve una interpretación estructurada: resolver, agregar, modificar, pedir aclaración, escalar explícitamente o cambiar de intención.
3. La búsqueda recupera candidatos; `CatalogResolutionService` conserva los compatibles como `pending` cuando aún no existe selección fundada.
4. Si faltan datos o no hay evidencia suficiente, el compositor existente genera una pregunta natural apoyada en `facts`, candidatos y aclaración previa.
5. El runtime persiste `clarificationState.attempts + 1`, el alcance y la pregunta enviada; no crea `human_handoff`.
6. En el siguiente mensaje, DeepSeek decide si resolvió el alcance, añadió/modificó productos o si aún requiere la segunda pregunta.
7. Solo tras la segunda aclaración no resuelta, el runtime crea `human_handoff` con la canasta, evidencia y respuestas previas para el tendero.

### 4.3 Tipos de bloqueo

Definir una función de política explícita, por ejemplo `getPendingConversationMode(...)`, en lugar de usar un booleano global:

| Tipo de solicitud pendiente | Efecto sobre DeepSeek | Razón |
| --- | --- | --- |
| `human_handoff` con humano que ya tomó el caso | Pausa la respuesta automática, conserva y muestra mensajes para el tendero. | Evita respuestas simultáneas de humano y agente. |
| `human_handoff` recién creado por escalamiento | Debe existir únicamente tras dos aclaraciones agotadas o caso obligatorio. | No aplica a la primera ambigüedad. |
| `approval.requested` / `decision.requested` | No bloquea la comprensión de nuevos mensajes; bloquea únicamente la acción que requiere aprobación. | Un cliente puede seguir aclarando, agregando productos o cambiar datos. |
| `clarificationState` abierto | Permite DeepSeek y catálogo; limita el alcance a la ambigüedad activa. | Es conversación autónoma, no intervención humana. |

La condición de pausa sigue siendo determinista porque previene concurrencia humano/agente; la decisión de preguntar, resolver o continuar la toma DeepSeek a partir del contexto.

## 5. Plan de implementación y seguimiento

### Fase 0 — Línea base y observabilidad (sin cambio de comportamiento)

| ID | Trabajo | Archivos probables | Criterio de salida | Estado |
| --- | --- | --- | --- | --- |
| A0-01 | Capturar una reproducción local de `dos gaseosas y dos paquetes de papas` con la configuración de catálogo equivalente a demo. | `server/tests/` | Traza reproduce candidatos y el escalamiento actual. | Implementado localmente mediante el contrato de aclaración. |
| A0-02 | Verificar valor efectivo de `CONTEXTUAL_PRODUCT_SELECTION_V2` por ambiente y registrar versión de catálogo usada. | Configuración de Render; `server/config.js` | Evidencia de bandera y versión sin alterar producción. | Pendiente |
| A0-03 | Añadir telemetría de transición, no contenido sensible: `candidate_count`, `resolution_status`, `missing_field_type`, `handoff_reason`, `pending_mode`. | `agentRuntime.js`, `telemetry` | Se puede ubicar cada transición sin inspeccionar mensajes privados. | Implementado parcialmente: se registra la transición `clarification` con intentos, límite, agotamiento e ítems no resueltos. |

### Fase 1 — Estado de aclaración y candidatos

| ID | Trabajo | Archivos probables | Criterio de salida | Estado |
| --- | --- | --- | --- | --- |
| A1-01 | Definir y persistir `clarificationState` por conversación, con compatibilidad de datos existentes. | Store/repository de conversaciones, migración si es necesaria | Conversaciones previas sin el campo siguen funcionando. | Implementado en el documento de conversación; requiere validación controlada de persistencia PostgreSQL antes de ampliar. |
| A1-02 | Asegurar que la resolución contextual conserve candidatos compatibles con `selectionStatus: pending`; activar la ruta solo mediante bandera de lanzamiento. | `catalogResolutionService.js`, `agentRuntime.js`, `config.js` | Una ambigüedad genera alternativas, nunca selección silenciosa ni escalamiento inmediato. | Pendiente |
| A1-03 | Reemplazar `product:<consulta>` como escalamiento inmediato por un faltante de aclaración mientras queden intentos. | `agentRuntime.js`, helpers de faltantes | Los faltantes comerciales se distinguen de stock/precio/política obligatorios. | Implementado: producto sin resolver aclara hasta dos rondas; precio, inventario y política siguen siendo obligatorios. |

### Fase 2 — Interpretación de la respuesta y dos rondas

| ID | Trabajo | Archivos probables | Criterio de salida | Estado |
| --- | --- | --- | --- | --- |
| A2-01 | Extender el contrato de interpretación con `clarificationAction`, `resolvedLineIds`, `scopeDisposition` y `explicitHumanRequest`. | `llmPlanner.js`, validadores de respuesta | El modelo puede resolver, preguntar, modificar o escalar explícitamente con salida estructurada. | Pendiente |
| A2-02 | Alimentar al intérprete con la aclaración abierta y candidatos resumidos, reutilizando el historial compacto actual. | `llmPlanner.js`, `agentRuntime.js` | Las preguntas no repiten información ya entregada. | Implementado para el estado de aclaración; se reutiliza la evidencia de candidatos ya proporcionada por el flujo actual. |
| A2-03 | Construir la pregunta con `composeCustomerReply`, manteniendo el fallback seguro actual. | `agentRuntime.js`, `llmPlanner.js` | La pregunta es contextual; no hay plantilla fija por palabra clave. | Implementado: el compositor recibe los hechos de aclaración y conserva el fallback seguro. |
| A2-04 | Aplicar límite de dos rondas por `scopeKey`; resolver, cerrar o reemplazar alcance cuando el cliente cambie materialmente de necesidad. | `agentRuntime.js`, helper nuevo de estado | No hay bucles ni reinicios injustificados del contador. | Implementado: `scopeKey` normalizado, dos rondas configurables y reemplazo del alcance ante necesidad material distinta. |

### Fase 3 — Escalamiento y concurrencia humano/agente

| ID | Trabajo | Archivos probables | Criterio de salida | Estado |
| --- | --- | --- | --- | --- |
| A3-01 | Convertir `hasOpenHumanRequest` en una política con modo y tipo de bloqueo. | `pendingRequestPolicy.js`, `agentRuntime.js` | Solo una toma humana activa pausa respuestas automáticas. | Implementado: `getPendingConversationMode` diferencia `human_takeover` y `approval_pending`. |
| A3-02 | Separar solicitudes de aprobación de una transferencia humana en eventos y estado de conversación. | `events.js`, `toolRegistry.js`, `pendingRequestPolicy.js` | Una aprobación no silencia nuevos mensajes del comprador. | Implementado en la política de bloqueo: aprobación pendiente no activa el bloqueo reservado a una toma humana. |
| A3-03 | Mantener escalamiento inmediato para solicitud explícita, reclamo, restricción comercial y error de proveedor documentado. | `llmPlanner.js`, `agentRuntime.js`, política comercial | Estos casos conservan la protección actual. | Validado localmente: restricciones de comercio permanecen en la ruta de política; una toma humana real sigue bloqueando al agente. |
| A3-04 | Al resolver una tarea humana, cerrar `clarificationState` o reabrirlo de forma explícita según la acción del tendero. | Endpoint/servicio de resolución de tareas | No quedan conversaciones bloqueadas por estado huérfano. | Implementado: al resolverse la toma humana se cierra el alcance; una necesidad posterior vuelve a iniciar sus dos rondas. |

### Fase 4 — Validación y lanzamiento controlado

| ID | Trabajo | Archivos probables | Criterio de salida | Estado |
| --- | --- | --- | --- | --- |
| A4-01 | Pruebas unitarias y de runtime del nuevo ciclo. | Nuevos `server/tests/*clarification*` | Casos críticos aprobados localmente. | Implementado: tres intentos, dos preguntas, escalamiento, y modos de bloqueo. |
| A4-02 | Regresión de los flujos de `00329e4`. | `catalog-ambiguity-regression.mjs`, `checkout-*`, `backend-smoke.mjs` | Alternativas, selección y consolidación sin cambios funcionales. | Validado localmente: regresión de catálogo, checkout y smoke backend aprobados. |
| A4-03 | Activar bandera solamente para Demo De Tienda y observar telemetría. | Render/configuración controlada | Sin aumento de handoffs improcedentes ni degradación de latencia. | Pendiente |
| A4-04 | Ampliar por tenant después de resultados acordados. | Configuración | Evidencia de salida de piloto documentada. | Pendiente |

## 6. Matriz mínima de pruebas

| Caso | Resultado esperado |
| --- | --- |
| “Quiero dos gaseosas y dos paquetes de papas” | Pregunta 1 contextual con opciones/categoría relevante; no `human_handoff`. |
| Respuesta “Coca-Cola y papas Margarita” | Resuelve marcas, conserva cantidades y pregunta solo presentación/sabor faltante. |
| Segunda respuesta aún vaga | Pregunta 2, distinta y apoyada en lo ya dicho. |
| Tercera respuesta aún insuficiente | Crea tarea humana con contexto completo, sin perder canasta ni mensajes. |
| “Quiero hablar con la tienda” | Escala de inmediato y no responde automáticamente tras toma humana. |
| Reclamo de pedido / entrega incompleta | Escala de inmediato como hoy. |
| Imagen o comprobante | Notifica al tendero; no verifica pago automáticamente. |
| Producto sin candidatos después de dos rondas | Escala con consulta, intentos y evidencia de búsqueda. |
| Selección de Coca-Cola Original/Zero y Chocorramo 65 g/mini | Conserva alternativas compatibles y continúa checkout sin regresión. |
| Cliente agrega otro producto durante aclaración | El LLM reevalúa la canasta y abre/cierra ámbitos sin duplicar líneas. |
| Aprobación pendiente de descuento | El cliente puede seguir conversando; la acción comercial sigue protegida. |
| Tarea humana resuelta | El siguiente mensaje vuelve a enrutarse de acuerdo con el estado resultante. |

## 7. Métricas y criterios de aceptación

### Métricas a observar

- porcentaje de `human_handoff` por ambigüedad comercial;
- distribución de rondas de aclaración: 0, 1, 2 y escalamiento;
- porcentaje de aclaraciones resueltas sin humano;
- reintentos/preguntas repetidas por `scopeKey`;
- tiempo desde mensaje entrante hasta respuesta; p50 y p95;
- errores o fallback de `catalog.reconciliation`;
- tasa de selección correcta y de canasta preservada en regresión.

### Criterios de aceptación

1. Una solicitud vaga no crea tarea humana en la primera interacción, salvo condiciones obligatorias o solicitud explícita.
2. DeepSeek recibe contexto de aclaración y candidatos reales, y produce la pregunta contextual o la resolución estructurada.
3. Tras dos rondas no resueltas, la tarea humana contiene la canasta y evidencia necesaria para continuar.
4. Un `approval.requested` no bloquea comprensión ni respuesta conversacional posterior.
5. Una toma humana real no genera respuestas simultáneas del agente.
6. Las pruebas de selección, alternativas y checkout de la línea base `00329e4` permanecen aprobadas.
7. La nueva ruta no aumenta el p95 end-to-end por encima de 8 segundos en el piloto de demo.

## 8. Riesgos y controles

| Riesgo | Control |
| --- | --- |
| El LLM formula preguntas vagas o repetidas. | Persistir pregunta/evidencia previas y validar en pruebas de conversación; fallback explícito y breve. |
| Una nueva necesidad reinicia aclaraciones indefinidamente. | `scopeKey` y transición estructurada `replace/resolve`; métricas de reinicio. |
| El modelo marca una petición ordinaria como humano. | Requerir señal `explicitHumanRequest` o causa permitida; auditar motivo. |
| Candidatos extensos elevan tokens/latencia. | Enviar un resumen acotado de candidatos relevantes, no el catálogo completo; medir p95. |
| Humano y agente responden al mismo tiempo. | Solo estado “humano tomó el caso” pausa el runtime; auditoría de transiciones. |
| Activar la selección contextual afecta otro tenant. | Bandera por tenant y lanzamiento Demo De Tienda primero. |

## 9. Decisión requerida antes de implementación

Este plan está listo para iniciar por la Fase 0. Antes de modificar comportamiento se debe aprobar:

1. usar dos rondas máximas por alcance ambiguo;
2. almacenar `clarificationState` en la conversación;
3. separar bloqueo humano de aprobaciones operativas; y
4. activar la ruta contextual inicialmente solo en Demo De Tienda.

Ninguna tarea de este plan autoriza despliegue general hasta completar la regresión y el piloto controlado.
