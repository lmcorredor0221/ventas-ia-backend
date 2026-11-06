# Telemetría operativa y latencia de VIA

## Propósito

VIA tenía métricas de eventos y de uso, pero no una medición correlacionada del recorrido completo de un mensaje. Por eso se podía comprobar que Meta recibió el webhook, pero no distinguir si la demora posterior estaba en la cola, PostgreSQL, Google Sheets, DeepSeek, la construcción de la respuesta o el envío de vuelta a Meta.

La telemetría nueva es **in-memory por proceso** y se emite también como logs estructurados. No escribe en PostgreSQL, no crea otra cola y no incluye el texto de los mensajes, prompts, tokens de acceso ni contenido del catálogo. Al reiniciar el proceso se pierde la ventana in-memory, pero los logs de Render siguen siendo consultables.

## Recorrido medido

```text
Meta webhook ACK
       |
       v
cola inbound -> espera de cola -> agente
                              |
                              +-> herramienta catálogo / clientes / WhatsApp
                              +-> DeepSeek: plan e interpretación
                              +-> DeepSeek: redacción de respuesta
                              +-> PostgreSQL: lecturas y escrituras
                              v
                         traza completa
```

Se conserva el `traceId` de WhatsApp cuando existe. El ACK se mide por separado de `inbound.queue_wait` y de `trace.inbound`, porque el webhook puede responder rápido mientras el trabajador sigue procesando.

## Componentes instrumentados

| Operación | Qué mide | Dónde se observa |
|---|---|---|
| `webhook.http` | ACK HTTP de Meta, estado y duración | ruta `/webhooks/whatsapp` |
| `inbound.queue_wait` | Tiempo desde recepción durable hasta inicio del trabajador | `AgentRuntime.processQueuedInbound` |
| `trace.inbound` | Tiempo total de procesamiento del mensaje | traza del agente |
| `outbox.drain` / `outbox.entry` | Espera y ejecución de la cola de integración | `IntegrationOutbox` |
| `tool.call` | Catálogo, clientes, envío WhatsApp y demás herramientas | `ToolRegistry.call` |
| `llm.plan` | Solicitud DeepSeek/Gemini que interpreta intención y pedido | `LLMPlanner.plan` |
| `llm.reply` | Solicitud que redacta la respuesta final | `LLMPlanner.composeReply` |
| `postgres.snapshot` | Clonado, serialización, SQL, tamaño JSONB y `includeMirrors` | `PostgresStore.save` |
| `postgres.snapshot_queue` | Espera de la cola de snapshots | `PostgresStore.queueSnapshotWrite` |
| `postgres.critical_write` | Escrituras prioritarias, incluida configuración de tenant | `PostgresStore.queueCriticalWrite` |
| `postgres.queued_write` | Escrituras operativas serializadas | `PostgresStore.queueWrite` |

Para LLM se conservan proveedor, modelo, modo de ejecución, número de solicitudes y los contadores de tokens que devuelva el proveedor. No se guarda el prompt ni la respuesta completa.

## Consulta

La API protegida por autenticación es:

```text
GET /api/ops/telemetry?tenantId=<tenant>&sinceMs=3600000
```

`tenantId` limita los datos a una tienda. `sinceMs` permite analizar, por ejemplo, la última hora. La respuesta contiene:

- `operations`: conteo, errores, promedio, p50, p95 y máximo por operación.
- `recentTraces`: las últimas 100 trazas, con marcas y estados, sin contenido conversacional.
- `activeTraces`: mensajes que siguen en proceso.
- `gauges.postgres.pool`: conexiones totales, libres y esperando.

## Diagnóstico recomendado

1. Comparar `webhook.http` con `inbound.queue_wait`. Si el primero es bajo y el segundo alto, el problema es la cola o el trabajador.
2. Comparar `llm.plan`, `llm.reply` y `tool.call`. Una herramienta lenta suele aparecer con su nombre en `metadata.toolName`.
3. Revisar `postgres.snapshot` junto con `postgres.snapshot_queue`. Un `sqlMs` alto o `waitingCount` creciente apunta a PostgreSQL; un `cloneMs` o `serializedBytes` alto apunta al tamaño del snapshot.
4. Revisar `trace.inbound` para el tiempo percibido por el cliente y sus `marks`.
5. Tratar como incidente cualquier `status=error`, `activeTraces` que crezcan continuamente o `inbound.queue_wait` por encima del objetivo de experiencia.

## Límites y siguiente etapa

Esta primera versión evita persistir telemetría para no competir con las escrituras del negocio. Si se necesita histórico de largo plazo, se debe exportar de forma asíncrona a un sistema de observabilidad; no se debe volver a escribir cada span dentro de `app_state` ni de la misma transacción que guarda pedidos o configuración.
