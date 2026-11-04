# Plan de implementación: orquestación contextual con LLM

**Fecha:** 3 de noviembre de 2026  
**Estado:** P1, P2, P3, P4, P5, P6 y P7 implementadas/validadas; integración selectiva sobre la rama operativa completada; P8/P9 cerradas con replay E2E local 40/40; P9 de producción/piloto controlado pendiente
**Checkpoint previo:** `7fd2c61` — `chore: checkpoint pilot docs and runtime tooling`  
**Referencia semántica:** worktree `codex/integracion-semantica-20261103`, commit `b09886e`
**Alcance:** backend conversacional de VIA, mensajes WhatsApp, catálogo, carrito, checkout, escalamiento humano y pruebas locales  

**Última ejecución:** `20261104152951_d4af6f21` — replay P9 sobre un clon PostgreSQL, con Meta simulada y DeepSeek real: 40/40 casos aprobados, 181 llamadas y 112.025 tokens. La fuente `ventas_ia_dev` quedó intacta. Release publicado en Render con `2be5bd8` después de alinear el script `start` del servicio.

Este documento aterriza la premisa aprobada: el LLM debe interpretar el contexto y proponer la siguiente acción conversacional. Las reglas de negocio, los hechos del catálogo, la seguridad, la idempotencia y las restricciones de Meta siguen siendo límites obligatorios y verificables.

## Seguimiento de integración — 4 de noviembre de 2026

La rama operativa `codex/backend-plan-payload-20261020` y el worktree `codex/integracion-semantica-20261103` no comparten ancestro Git (`git merge-base` no devuelve una base común) y difieren ampliamente. Por eso no se hizo una fusión masiva: habría riesgo de borrar archivos y cambios operativos que no pertenecen a este plan.

Se integró de forma selectiva y compatible:

- `server/services/semanticInterpreter.js` establece una frontera explícita: recibe el contexto lingüístico, ejecuta el proveedor o fallback y entrega únicamente un `semantic-frame.v2` saneado. SKU, precio, stock y `toolPlan` no cruzan esa frontera.
- `LLMPlanner` conserva la API `plan()` utilizada por el runtime, pero delega la interpretación al nuevo componente. El acceso al catálogo queda como dependencia interna del simulador/fallback local; el prompt del proveedor real no recibe el catálogo ni hechos comerciales.
- `greeting` y `general_query` son intenciones formales. Ya no se envía un saludo a búsqueda de catálogo; el runtime responde conversacionalmente y deja la siguiente necesidad para el cliente.
- `agentPolicy.assistantName` queda aislado por tenant, editable por el propietario dentro de la política permitida y disponible para el saludo y el compositor; el valor por defecto es `Rocío`.
- Se registran `llm.interpretation.created` y `llm.context.override`. El segundo hace visible cualquier guardia de compatibilidad que cambie la intención del LLM; no se oculta la sustitución.
- Se añadieron contratos automatizados para la frontera del intérprete y la clasificación de saludos. `npm run test:architecture` queda como verificación de regresión.
- Se añadió consolidación corta opt-in en el worker: `WHATSAPP_INBOUND_BATCHING_ENABLED=true`, ventana máxima configurable y límite de mensajes configurable. Agrupa únicamente texto del mismo tenant, número y cliente; botones, multimedia y coexistencia siguen su ruta inmediata. Los mensajes se conservan individualmente en `inbound_messages` y comparten el resultado de la ejecución.
- La coordinación de esa ventana usa un lock local y, cuando el almacenamiento PostgreSQL está activo, un lease distribuido en `inbound_batch_leases`; el worker libera el lease al terminar y reintenta mediante la outbox si otra instancia lo posee. En JSON la protección sigue siendo local al proceso.
- Las respuestas automáticas pasan por una revalidación de cursor antes del envío: si la conversación avanzó o existe un inbound posterior aún pendiente, se emite `llm.response.suppressed` y no se envía una respuesta obsoleta. Los mensajes humanos mantienen su ruta independiente.

La matriz E2E y la revalidación de cursor ya fueron validadas sobre esta base. El contrato `delta/snapshot`, el lease PostgreSQL, la revalidación de cursor y la selección contextual de candidatos quedan cubiertos localmente. El despliegue/piloto sigue separado: requiere revisión del diff, commit, push, build de release, configuración de secretos y activación gradual por tenant.

## 1. Resultado de la revisión actual

La separación semántica ya existe parcialmente: `llmPlanner.js` produce un `semantic-frame.v2`, `semanticContracts.js` resuelve candidatos del catálogo y `agentRuntime.js` conserva el carrito, el checkout y el handoff humano. El problema pendiente no es incorporar otro agente, sino evitar que el runtime fragmente mensajes consecutivos o reemplace silenciosamente la interpretación del LLM con correcciones heurísticas.

### Brechas verificadas

| ID | Brecha | Evidencia actual | Impacto |
|---|---|---|---|
| CTX-01 | Cada mensaje entrante se procesa individualmente | `processInbound()` y `processQueuedInbound()` operan sobre un mensaje por ejecución | El cliente puede recibir preguntas fragmentadas cuando envía nombre, dirección y productos en mensajes consecutivos |
| CTX-02 | No existe una ventana corta de consolidación antes de responder | La cola reclama el mensaje y enruta inmediatamente | Se pierde la oportunidad de interpretar una ráfaga completa |
| CTX-03 | El planner recibe una corrección determinística posterior | `coercePlanWithConversation()` puede cambiar intención, acto y pago después de la respuesta del LLM | Un arreglo de una palabra puede afectar otros escenarios y no queda suficientemente visible como override |
| CTX-04 | El contrato no distingue formalmente delta de carrito y snapshot completo | `mergeOrderItems()` y `restoreClarificationDraft()` dependen de la intención y de que el LLM conserve líneas previas | Puede duplicar líneas o perder productos al agregar o aclarar |
| CTX-05 | No hay revalidación antes del envío | Se genera la respuesta con el estado leído al inicio del procesamiento | Una respuesta puede quedar vieja si llega otro mensaje mientras el LLM está trabajando |
| CTX-06 | La coordinación distribuida no está cerrada | El lock existente protege partes del flujo, pero no todos los mensajes distintos de una misma conversación | Riesgo de carreras con varias instancias o reintentos |
| CTX-07 | El caso de leche genérica puede escalar demasiado pronto | La resolución actual clasifica dos marcas con igual evidencia como `human_review` cuando comparten presentación | Debe priorizar una pregunta de selección si la ambigüedad es resoluble por el cliente |
| CTX-08 | El simulador y el proveedor real no son equivalentes | El simulador puede interpretar “Hola, quiero hacer un pedido” como producto desconocido | Las pruebas del simulador no deben confundirse con evidencia de DeepSeek real |
| CTX-09 | El modo humano detiene el agente por diseño | `hasOpenHumanRequest()` registra mensajes posteriores sin reactivar IA | Es correcto como límite de seguridad, pero debe mostrarse y resolverse explícitamente en la operación humana |

## 2. Principio operativo aprobado

El orden de decisión será:

```text
mensaje(s) recibidos
  -> persistencia durable e idempotente
  -> consolidación corta de mensajes pendientes
  -> interpretación contextual LLM
  -> recuperación y resolución autoritativa del catálogo
  -> validación de reglas, seguridad, stock, precio y estado
  -> nueva comprobación de mensajes recientes
  -> redacción contextual y envío idempotente
```

La expresión “LLM primero” significa que la intención, el vínculo entre mensajes, la ambigüedad y la acción conversacional propuesta deben salir del análisis contextual. No significa que el LLM pueda inventar precios, escoger un SKU sin evidencia, saltarse una restricción de WhatsApp, confirmar stock ni cambiar una transición de pedido.

### Decisiones que deben proponer el LLM

- si el mensaje es saludo, solicitud nueva, continuación, respuesta a una pregunta, corrección, adición, modificación, confirmación, cancelación o petición de humano;
- cómo se relacionan los mensajes recientes con la pregunta pendiente;
- qué productos, cantidades, marcas, presentaciones y atributos intenta expresar el cliente;
- si la evidencia es suficiente o se requiere una pregunta concreta;
- si el cliente terminó de agregar productos o todavía está construyendo el pedido;
- cuál es la siguiente acción conversacional y qué información debe solicitarse.

### Límites que no puede sustituir el LLM

- tenant, conversación y número de WhatsApp de destino;
- existencia, SKU, precio, stock, subtotal y total calculados desde el catálogo del tenant;
- consentimiento, seguridad, política de canal y restricciones de Meta;
- idempotencia, deduplicación, orden de mensajes y control de concurrencia;
- estados válidos del pedido y permisos del operador;
- activación o permanencia del modo de atención humana.

Cada vez que un límite modifique la acción propuesta, el evento debe conservar `llmDecision`, `policyDecision`, `overrideReason` y `finalAction`. No se deben sobrescribir silenciosamente las decisiones.

## 3. Arquitectura objetivo

```text
Meta / simulador
       |
       v
Webhook: verificar -> persistir inbound -> 200 rápido
       |
       v
Coordinador por conversación
  - lease/advisory lock
  - cursor de mensajes
  - ventana corta de consolidación
       |
       v
Interprete LLM contextual
  -> SemanticFrame.v2
       |
       v
Recuperador + resolutor por tenant
  -> CandidateSet / ResolutionSet
       |
       v
Orquestador de estado
  -> DraftVersion / CheckoutOffer / HumanHandoff
       |
       v
Revisión de cursor reciente
  -> enviar solo si la respuesta sigue vigente
       |
       v
Outbox WhatsApp idempotente + telemetría
```

El diseño reutiliza el runtime, el planner, el resolutor de catálogo, el checkout, la outbox y los contratos existentes. No introduce RAG, ReAct, embeddings ni un segundo agente en este ciclo.

## 4. Contrato semántico que debe consolidarse

La siguiente versión debe añadir explícitamente la relación entre mensajes y el tipo de actualización del pedido:

```json
{
  "schemaVersion": "semantic-frame.v2",
  "intent": "delivery_order",
  "conversationAct": "add_item",
  "replyTo": ["in-104", "in-105"],
  "messageInterpretations": [
    {"messageId": "in-104", "role": "customer_name", "confidence": 0.99},
    {"messageId": "in-105", "role": "delivery_address", "confidence": 0.98}
  ],
  "cartMutation": {
    "mode": "delta",
    "items": []
  },
  "customerDelta": {
    "name": "...",
    "address": "...",
    "paymentMethod": null
  },
  "collectionComplete": false,
  "proposedAction": "ask_for_products",
  "confidence": 0.96,
  "ambiguities": [],
  "reasoningSummary": "..."
}
```

Reglas del contrato:

1. `mode=delta` agrega o modifica solo lo expresado en la ráfaga.
2. `mode=snapshot` reemplaza el borrador únicamente cuando el LLM confirma que reconstruyó el pedido completo.
3. El LLM nunca envía `sku`, precio, stock o subtotal como hechos; puede enviar pistas lingüísticas y evidencia textual.
4. `proposedAction` es una propuesta; el dominio la valida con los hechos del catálogo y el estado.
5. Una ambigüedad resoluble debe producir `ask_clarification` con opciones concretas; una ambigüedad no resoluble o una restricción debe producir `human_handoff` con motivo explícito.

## 5. Plan por fases y seguimiento

| Fase | Objetivo | Cambios principales | Estado | Criterio de salida |
|---|---|---|---|---|
| P0 | Punto de recuperación | Commit de documentación, evidencias y herramientas existentes | **Cerrada** | `7fd2c61`, build y arquitectura aprobados |
| P1 | Instrumentación sin cambiar conducta | Registrar contexto base, decisión LLM, override y consumo separado del compositor | **Cerrada en worktree semántico** (`85eec39`) | Prueba `server/tests/contextual-observability.mjs` y contratos de arquitectura aprobados |
| P2 | Contrato semántico | Formalizar `semantic-frame.v2`, delta/snapshot, `replyTo`, propuesta de acción y confianza | **Integrada selectivamente en la rama operativa** | Contrato saneado, compatibilidad v1 de lectura, proveedor y pruebas de arquitectura aprobadas |
| P3 | Consolidación de ráfagas | Ventana corta opt-in, agrupación por tenant/número/cliente, preservación de mensajes y bypass de interacciones | **Integrada y validada con smoke PostgreSQL aislado** | 2–5 mensajes consecutivos generan una sola interpretación; varias instancias no procesan simultáneamente la misma clave; botones/media no esperan; retry queda disponible |
| P4 | Memoria y estado | Separar contexto estable, borrador versionado, pregunta pendiente, ofertas activas y cursor de mensajes | **Cerrada localmente** (`546c04c`) | Contrato `conversation-context.v1`, borrador versionado, cursor y ofertas activas validados |
| P5 | Resolución de catálogo | Mantener búsqueda por tenant; diferenciar ambigüedad resoluble de no resoluble y conservar atributos/presentación | **Cerrada localmente** (`caaf7f0`) | Leche con calificativo ofrece opciones cuando procede; ambigüedad genérica escala; atributos y descripción quedan como evidencia |
| P6 | Revalidación y outbox | Revisar cursor antes de enviar; suprimir respuesta obsoleta; emitir respuesta idempotente | **Integrada selectivamente en la rama operativa** | Contrato local cubre cursor avanzado; falta validar replay E2E y completar deduplicación de respuesta en outbox |
| P7 | Humano y continuidad | Handoff explícito, bloqueo de IA mientras está activo y retorno controlado tras resolución | **Cerrada localmente** (commit `b5d62e6`, evidencia P7) | Handoff, pausa manual, confirmación en `preparing`, despacho/cierre, reanudación aprobada y nuevo caso validados |
| P8 | Validación E2E | Reejecutar SuperMarket y matriz semántica con DeepSeek real y Meta simulada | **Cerrada localmente** | 40/40 casos aprobados; fuente PostgreSQL inmutable; Meta simulada; DeepSeek real; acuse p95 16 ms y worker p95 5.132 ms |
| P9 | Piloto controlado | Activación gradual por tenant y métrica; rollback por feature flag | **Pendiente de release** | Revisión del diff, commit/push, despliegue controlado y validación del tenant demo |

### Orden recomendado de implementación

1. P1 antes de cambiar el comportamiento, para tener comparación antes/después.
2. P2 y P4, porque sin contrato de estado no es seguro consolidar mensajes.
3. P3, P6 y P7, que resuelven la fragmentación y la concurrencia.
4. P5, para corregir la frontera entre interpretación y evidencia de catálogo.
5. P8 con replay fiel del caso SuperMarket y casos nuevos.
6. P9 solo después de demostrar el comportamiento en local y en un tenant demo aislado.

## 6. Caso SuperMarket como prueba de referencia

La conversación observada debe reproducirse como una secuencia de mensajes, no como un solo prompt:

1. `Hola, quiero hacer un pedido` → saludo/intención de compra; pedir datos faltantes sin buscar “hacer pedido” como producto.
2. `jhon bernal` → actualizar nombre; no repetir el saludo ni pedir nuevamente el nombre.
3. dirección → actualizar dirección; preguntar por productos si todavía faltan.
4. `una leche entera` → resolver contexto; si hay dos marcas igualmente plausibles, ofrecer opciones o escalar con motivo, no mostrar pago todavía.
5. `un pan tajado` y `medio de queso tajado` → consolidar como adiciones mientras la conversación siga abierta; resolver cada producto y preguntar si desea agregar algo más.
6. `colanta` → interpretar como respuesta a la ambigüedad de leche; no iniciar un nuevo pedido ni usarlo como producto independiente.
7. Cuando estén productos, dirección y forma de pago completos → mostrar resumen final con total calculado y botones `Confirmar pedido`, `Ajustar pedido` y `Hablar con la tienda`.
8. Solo después de `Confirmar pedido` crear el pedido; si se marca `Ajustar pedido`, volver a interpretar el siguiente mensaje en el mismo borrador; si se elige humano, congelar IA.

## 7. Escenarios mínimos de validación

- saludo colombiano con y sin intención de compra;
- saludo seguido de productos en mensajes separados;
- nombre, dirección y pago en mensajes consecutivos;
- producto con error ortográfico, modismo, marca omitida y presentación omitida;
- producto adicional antes y después de la pregunta “¿algo más?”;
- corrección de cantidad, marca, presentación y dirección;
- respuesta tardía a una pregunta anterior;
- mensajes que llegan mientras el LLM está procesando;
- duplicados de Meta y reintentos del webhook;
- botón antiguo después de cambiar el borrador;
- stock insuficiente, precio cambiado y producto inexistente;
- dos variantes resolubles y dos candidatos no resolubles;
- alcohol/tabaco bloqueados por política de canal;
- handoff humano y continuación manual;
- confirmación, alistamiento, despacho, cierre y nuevo pedido posterior;
- dos tenants con nombres iguales, catálogos distintos y números distintos.

## 8. Observabilidad y métricas de aceptación

Por cada ráfaga se deben registrar, sin exponer secretos:

- `tenantId`, `conversationId`, `batchId`, cursor inicial/final y cantidad de mensajes;
- tiempo de espera de consolidación, lock, LLM, catálogo, composición y envío;
- tokens de entrada/salida, número de llamadas LLM y llamadas evitadas por consolidación;
- `semanticFrame`, propuesta de acción, confianza y ambigüedades saneadas;
- candidatos, resolución final, motivo de selección o escalamiento;
- versión del borrador, `collectionComplete`, pregunta pendiente y oferta interactiva;
- overrides de política, respuestas obsoletas suprimidas, reintentos e idempotencia;
- resultado final: respondido, pregunta de aclaración, pedido confirmado, humano o error.

Los objetivos iniciales de aceptación serán:

| Métrica | Objetivo inicial |
|---|---:|
| Mensajes consecutivos consolidados correctamente | ≥ 95 % en la matriz local |
| Respuestas enviadas que omiten un mensaje ya persistido | 0 |
| Subtotales inventados o calculados por el LLM | 0 |
| Respuestas que eligen SKU sin evidencia suficiente | 0 |
| Duplicados de pedido por reintento | 0 |
| Preguntas repetidas con el dato ya persistido | ≤ 5 % |
| Escalamientos por ambigüedad irresoluble | 100 % explicables |
| Mensajes enviados después de handoff humano activo | 0 automáticos |

La latencia se medirá separando acuse del webhook y respuesta completa. La consolidación no debe bloquear el acuse a Meta; el límite de espera debe ser corto y observable.

## 9. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Más llamadas o tokens por contexto | Ventana corta, resumen de memoria, límites de historial y una interpretación por ráfaga |
| Demora perceptible | Acuse inmediato, procesamiento asíncrono, timeout y respuesta segura de recuperación |
| LLM interpreta mal una respuesta corta | Incluir pregunta pendiente, mensajes recientes, borrador y opciones activas |
| Dos workers procesan el mismo pedido | Lease/advisory lock, cursor y clave idempotente en PostgreSQL |
| LLM devuelve carrito completo cuando debía enviar delta | Contrato explícito y validación de versión del borrador |
| Se oculta un override determinístico | Registrar propuesta y decisión final como eventos separados |
| El humano y la IA responden a la vez | Estado de handoff como límite duro y outbox con propietario de respuesta |
| Variantes de catálogo ambiguas | Resolver primero por evidencia; ofrecer selección cuando sea segura; escalar solo cuando no sea resoluble |
| Datos de tenants mezclados | Todas las lecturas y escrituras reciben tenant y phone binding verificados |

## 10. Reglas de ejecución y control de cambios

1. No implementar directamente sobre producción.
2. No modificar el catálogo fuente ni la base de desarrollo; usar fixtures, tenant sombra o transacciones de prueba.
3. Cada fase debe tener commit independiente y pruebas reproducibles.
4. No mezclar el commit de checkpoint `7fd2c61` con la implementación funcional.
5. El trabajo de integración semántica `20a258e` debe compararse antes de hacer merge; no se debe asumir que es la misma versión del directorio principal.
6. Cada cambio de contrato debe conservar compatibilidad o incluir migración explícita.
7. Antes de activar una fase, ejecutar build, contratos de arquitectura, replay SuperMarket y pruebas de aislamiento multi-tenant.
8. Activar con feature flag por tenant; desactivar el batcher o volver al flujo anterior si aumenta la latencia, los duplicados o los handoffs inexplicables.

## 11. Registro de seguimiento

| Fecha | Hito | Evidencia | Resultado |
|---|---|---|---|
| 2026-11-03 | Revisión del flujo conversacional y caso SuperMarket | `docs/Analisis-interacciones-whatsapp-supermarket.md`, capturas y código de `server/services/agentRuntime.js` | Brechas CTX-01 a CTX-09 identificadas |
| 2026-11-03 | Verificación de baseline | `npm run build`; `npm run test:architecture` | Aprobados |
| 2026-11-03 | Checkpoint antes de implementar | Commit `7fd2c61` | Cerrado; sin cambios funcionales del plan |
| 2026-11-03 | Plan y tablero documentados | Este documento | Cerrado; listo para revisión/ejecución por fases |
| 2026-11-03 | P1 instrumentación | Commit `85eec39` en `codex/integracion-semantica-20261103` | Cerrado en el worktree semántico; sin merge ni despliegue |
| 2026-11-04 | P6 revalidación y outbox idempotente | Commit `1c0da80`, `docs/Evidencia-P6-revalidacion-outbox-2026-11-04.md`, `server/tests/response-revalidation.mjs`, `npm test` | Cerrado localmente; carrera y duplicados controlados; sin merge ni despliegue |
| 2026-11-04 | P7 continuidad humana | Commit `b5d62e6`; `server/tests/human-continuity.mjs`, `docs/Evidencia-P7-continuidad-humana-2026-11-04.md`, `npm run test:architecture` | Validado localmente; la lógica ya existente cubre pausa, resolución, alistamiento, despacho y nuevo caso; sin merge ni despliegue |
| 2026-11-04 | P8 E2E local Meta + DeepSeek | Commit `b09886e`; `server/tests/e2e-local-meta-deepseek.mjs`, `docs/Evidencia-P8-e2e-local-2026-11-04.md`, `npm test` | Ejecutados 40 casos con 96 llamadas reales a DeepSeek y 353.075 tokens; 19 aprobados, 21 fallidos. Meta/Graph/Google simulados; `ventas_ia_dev` sin cambios; no apto aún para P9 |
| 2026-11-04 | Integración selectiva P2/P3 | `semantic-frame.v2`, `inbound_batch_leases`, `WHATSAPP_INBOUND_BATCH_LEASE_MS`, contratos de interpretación y batching | Código integrado; smoke PostgreSQL aprobado en `ventas_ia_contract_20261104`; `ventas_ia_dev` quedó intacta; E2E DeepSeek pendiente | Sin commit, push ni despliegue en esta etapa |
| 2026-11-04 | Integración selectiva P6 | `sendCustomerMessage`, evento `llm.response.suppressed`, `server/tests/response-revalidation-contract.mjs` | Respuesta obsoleta suprimida localmente; falta replay E2E con ráfaga/concurrencia | Sin commit, push ni despliegue en esta etapa |
| 2026-11-04 | Preflight P9 E2E | `docs/Evidencia-P9-preflight-e2e-2026-11-04.md`, `.env.e2e.local.example`, `server/tests/e2e-local-deepseek-40.mjs` | Bloqueado de forma segura: falta `.env.e2e.local` y `DEEPSEEK_API_KEY`; no se simuló DeepSeek ni se alteró la base local | Requiere configurar la clave local fuera del chat y ejecutar `npm run test:e2e:local` |
| 2026-11-04 | Replay P9 inicial con DeepSeek real | `test-results/e2e-local/20261104135036_4c2986fd/` | 40/40 casos ejecutados; 38 aprobados, 2 brechas identificadas; fuente intacta | Correcciones focalizadas requeridas |
| 2026-11-04 | Corrección focalizada P9 | `server/services/llmPlanner.js`, `server/services/agentRuntime.js`, `server/tests/e2e-local-deepseek-40.mjs` | Se corrigió la clasificación de listas de compra, la comparación semántica de campos faltantes y el ranking contextual de categorías amplias; la lógica no fija productos concretos | Replay completo ejecutado |
| 2026-11-04 | Replay P9 final | `docs/Evidencia-P9-e2e-deepseek-2026-11-04.md`, `test-results/e2e-local/20261104152951_d4af6f21/` | 40/40 aprobados; 181 llamadas DeepSeek, 112.025 tokens; p95 acuse 16 ms, p95 worker 5.132 ms; flujo de tendero y nuevo pedido posterior aprobados | P9 local cerrada |
| 2026-11-04 | Release backend | Commits `0932a09`, `2be5bd8`; Render `dep-dbllecgae00c73c8avhg` | `2be5bd8` quedó `live`; health directo Render y proxy `via.leanagentbuilder.com` respondieron HTTP 200. El primer intento falló por el script `start` ausente y no llegó a producción | Release validado; queda piloto funcional con tenant demo |
| 2026-11-03 | P2 contrato semántico | Commit `8611180` en `codex/integracion-semantica-20261103` | Cerrado en el worktree semántico; `semantic-frame.v2`, sin merge ni despliegue |
| 2026-11-03 | P3 consolidación contextual | Commit `d0711e3`, `server/tests/whatsapp-inbound-batching.mjs`, `docs/Evidencia-P3-orquestacion-contextual-LLM-2026-11-03.md` | Cerrado local para una instancia; feature flag apagada por defecto. El lock distribuido queda pendiente de P9; la revalidación antes de enviar se cerró en P6 |
| 2026-11-03 | P4 memoria y estado conversacional | Commit `546c04c`, `docs/Evidencia-P4-memoria-estado-conversacional-2026-11-03.md`, `server/tests/conversation-context.mjs` | Validado localmente: contrato v1, borrador versionado, cursor, pendientes y ofertas activas; sin merge ni despliegue |
| 2026-11-03 | P5 resolución contextual de catálogo | Commit `caaf7f0`, `docs/Evidencia-P5-resolucion-catalogo-2026-11-03.md`, `server/tests/semantic-resolution-contract.mjs` | Validado localmente: atributos, descripción, presentación y ambigüedad resoluble/no resoluble; sin merge ni despliegue |

### Próximo hito autorizado

El siguiente hito es **piloto controlado con el tenant demo**. El backend ya está publicado y saludable; queda validar tráfico real de prueba, credenciales/secretos del tenant, catálogo, webhook de Meta y métricas de conversación sobre el release `2be5bd8`. El rollback debe apuntar al deploy live anterior si aparecen errores.

