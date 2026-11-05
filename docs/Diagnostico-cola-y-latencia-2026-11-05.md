# Diagnóstico y corrección de cola WhatsApp — 2026-11-05

## Resultado

La hipótesis de bloqueo por cola quedó confirmada parcialmente. El acuse inicial de inbound ya tenía una ruta durable independiente, pero el ciclo posterior seguía usando `saveQueue`: marcar el mensaje, reclamar/completar outbox, actualizar ofertas y persistir la conversación. Un snapshot completo de `app_state` podía retrasar esas operaciones.

La prueba de PostgreSQL local reprodujo el problema con una barrera artificial: el ciclo inbound/outbox no terminaba mientras estaba bloqueada la cola general. Después de separar las colas, el mismo escenario terminó dentro del límite de prueba.

## Cambios realizados

- Se añadió `operationalQueue` en `server/store/postgresStore.js`.
- Las operaciones de inbound, outbox, leases, ofertas interactivas, idempotencia y persistencia de conversación ya no esperan a `saveQueue`.
- Se mantuvo la serialización dentro de la cola operativa para evitar carreras dentro del proceso.
- La escritura de conversaciones aplica una protección por `updated_at` para que un snapshot atrasado no sobrescriba una versión más nueva.
- El worker reduce el polling de recuperación de 5 s a 1 s por defecto.
- El worker intenta drenar inmediatamente cuando él mismo encola un trabajo.
- Se añadieron logs estructurados para medir:
  - acuse del webhook;
  - edad de la outbox y duración del handler;
  - espera antes del agente;
  - duración del agente;
  - envío HTTP a Meta y persistencia de la conversación.

## Validación local

- `server/tests/inbound-persistence-priority.mjs`: 5 pruebas aprobadas, incluida la reproducción del bloqueo de la cola.
- `npm run test:architecture`: aprobado.
- `npm run test:delivery`: aprobado.
- `npm run test:delivery:postgres`: 37 comprobaciones aprobadas contra PostgreSQL local real.
- `npm run test:postgres:local`: aprobado.
- `npm run build`: aprobado.
- `git diff --check`: aprobado; solo se muestran advertencias normales de conversión LF/CRLF de Git.

## Límites de esta entrega

Esta corrección es local y todavía no está desplegada. No confirma por sí sola la configuración efectiva de Render, la separación web/worker ni la latencia actual de Meta. Antes del despliegue se debe verificar que exista un worker persistente y que el servicio web tenga activada la recepción asíncrona únicamente cuando ese worker esté operativo.

## Evidencia productiva de referencia

La última prueba documentada mostró 3,368 s antes de iniciar el agente, 6,769 s de ejecución y 10,136 s desde recepción hasta finalización. El incidente anterior de aproximadamente 4 min 12 s incluyó un deadlock PostgreSQL y espera de `flush()` sobre el snapshot global.
