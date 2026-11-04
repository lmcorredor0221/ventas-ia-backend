# Plan de implementación: orquestación contextual con LLM

**Fecha:** 3 de noviembre de 2026  
**Estado:** plan documentado; implementación funcional aún no iniciada  
**Checkpoint previo:** `7fd2c61` — `chore: checkpoint pilot docs and runtime tooling`  
**Referencia semántica:** worktree `codex/integracion-semantica-20261103`, commit `20a258e`  
**Alcance:** backend conversacional de VIA, mensajes WhatsApp, catálogo, carrito, checkout, escalamiento humano y pruebas locales  

Este documento aterriza la premisa aprobada: el LLM debe interpretar el contexto y proponer la siguiente acción conversacional. Las reglas de negocio, los hechos del catálogo, la seguridad, la idempotencia y las restricciones de Meta siguen siendo límites obligatorios y verificables.

## 1. Resultado de la revisión actual

La separación semántica ya existe parcialmente: `llmPlanner.js` produce un `semantic-frame.v1`, `semanticContracts.js` resuelve candidatos del catálogo y `agentRuntime.js` conserva el carrito, el checkout y el handoff humano. El problema pendiente no es incorporar otro agente, sino evitar que el runtime fragmente mensajes consecutivos o reemplace silenciosamente la interpretación del LLM con correcciones heurísticas.

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
| P1 | Instrumentación sin cambiar conducta | Registrar batch, cursor, latencia, tokens, decisión LLM, override, resolución y respuesta suprimida | Pendiente | Telemetría comparable en pruebas locales |
| P2 | Contrato semántico | Formalizar `semantic-frame.v2`, delta/snapshot, `replyTo`, propuesta de acción y confianza | Pendiente | Validación de esquema y compatibilidad con `semantic-frame.v1` |
| P3 | Consolidación de ráfagas | Implementar lease por conversación y ventana corta/adaptativa; no esperar indefinidamente | Pendiente | 2–5 mensajes consecutivos generan una sola interpretación sin perder orden |
| P4 | Memoria y estado | Separar contexto estable, borrador versionado, pregunta pendiente, ofertas activas y cursor de mensajes | Pendiente | Corrección de nombre/dirección/productos/pago en mensajes separados |
| P5 | Resolución de catálogo | Mantener búsqueda por tenant; diferenciar ambigüedad resoluble de no resoluble y conservar atributos/presentación | Pendiente | Leche genérica ofrece opciones cuando procede; no inventa producto |
| P6 | Revalidación y outbox | Revisar cursor antes de enviar; suprimir respuesta obsoleta; emitir respuesta idempotente | Pendiente | Ninguna respuesta contradice una ráfaga posterior |
| P7 | Humano y continuidad | Handoff explícito, bloqueo de IA mientras está activo y retorno controlado tras resolución | Pendiente | El humano puede confirmar/ajustar/alistar sin reactivar carreras |
| P8 | Validación E2E | Reejecutar SuperMarket y matriz semántica con DeepSeek real y Meta simulada | Pendiente | Criterios de aceptación completos, sin tocar datos fuente |
| P9 | Piloto controlado | Activación gradual por tenant y métrica; rollback por feature flag | Pendiente | Sin regresión de latencia, costo ni integridad |

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

### Próximo hito autorizado

Implementar **P1 — instrumentación sin cambio de conducta**. La salida esperada es una telemetría comparable del flujo actual, sin consolidar todavía mensajes ni cambiar la respuesta del agente. Si P1 no permite observar cursor, batch, decisión LLM y override, no se debe avanzar a P3.

