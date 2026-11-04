# Corrección: Marcar tomado no cambia el estado

## Evidencia de producción

Tenant `demo-de-tienda`, pedido `ord-20a1c0ca-6`, conversación `wa-241381eb`.

El 3 de noviembre de 2026 se reprodujo desde VIA la acción de la tarea `handoff-9e22576d`: `POST /api/pending-requests/handoff-9e22576d/resolve`, con resultado HTTP 409 y código `order_transition_conflict`. La lectura posterior seguía mostrando el pedido y su tarea de preparación pendientes.

En esa conversación existía también `handoff-4afc91dd`, creada a las 19:29 UTC y resuelta a las 20:10 UTC para recuperar una consulta de catálogo. El pedido fue creado después, a las 20:13 UTC. Esa decisión anterior no representa la aceptación del pedido nuevo.

## Causa

`OrderService.effectiveStatus` permitía asociar una tarea sin identificador de pedido por compartir `conversationId`. Los títulos que contenían «pedido» o «domicilio» se consideraban tareas de preparación. Así, una recuperación anterior resuelta hacía inferir `preparing`; intentar tomar el pedido solicitaba una transición inválida de `preparing` a `preparing`.

La vista operativa calculaba el estado con las tareas pendientes, mientras la transición consultaba todo el historial. Esto explicaba la contradicción entre «Por preparar» y el conflicto. Además, el enriquecimiento de tareas para la API asignaba retroactivamente el pedido nuevo a la tarea histórica.

## Corrección

- El estado y las transiciones solo consideran tareas vinculadas explícitamente mediante `contextSnapshot.orderId` o su variante `context_snapshot.order_id`.
- Resolver una tarea genérica de consulta/recuperación no cambia ningún pedido por compartir conversación.
- La API conserva el significado de las tareas históricas; no las convierte en preparación de un pedido posterior.
- Se conserva la selección por tenant. No se cambian esquemas, permisos, frontend, precios ni mensajes anteriores.

## Pruebas

La regresión en `server/tests/backend-smoke.mjs` inserta una tarea histórica de recuperación resuelta y reproduce el HTTP 409 antes del cambio. Con el cambio, la tarea de preparación correcta pasa a resuelta y el pedido a `preparing`. También verifica que una decisión genérica denegada no cancele un pedido posterior y que la API no añada una asociación ficticia al historial.

`npm run test:architecture`: siete contratos aprobados, incluidos concurrencia, outbox, persistencia y flujo de preparación/despacho. `npm run test:backend`: suite completa aprobada; incluye smoke, continuidad de cotización, concurrencia, errores, 50 escenarios colombianos (60 pasos), contratos LLM, autenticación, Google, WhatsApp y Embedded Signup. Son pruebas locales con límites externos controlados, no una nueva ejecución E2E contra DeepSeek real.

## Despliegue y comprobación real

- Código publicado en `backend/main`: `2276c4742ec88efbe237f6778ae626a45f40fb19`.
- Render: servicio `srv-db7sqqmq1p3s73elv1eg`, despliegue `dep-dbl4ikbncjis73b73fmg`, Live a las 15:52:24 de Colombia. Se conservó Auto-Deploy desactivado.
- `/health/ready`: `ok: true`, PostgreSQL, WhatsApp live, sin errores ni advertencias, a las 20:52:30 UTC.
- Desde la sesión real del navegador interno, «Marcar tomado» devolvió HTTP 200. El pedido quedó `preparing`, versión 1, con transición registrada a las 20:52:51.541 UTC y origen `human_request`.
- La vista operativa pasó de la tarea «Pedido por preparar» a una sola tarjeta «Alistando pedido», por $10.000, con Coca-Cola 1.5L y Chocorramo. Quedaron cero tareas pendientes y el botón «Marcar en camino».
- Se recargó la página y se volvió a «Pedidos y pendientes»: el estado Alistando se conservó. No se ejecutó el despacho ni se envió un mensaje de prueba adicional.
- Evidencia local: `docs/evidencias/auditoria-preparacion-20261103/demo-pedido-tomado.png` en el workspace principal. Se mantiene fuera del repositorio remoto porque contiene datos del pedido.

El incidente de subtotal cero del mismo pedido está documentado por separado. Esta corrección no reescribe sus importes ni los mensajes históricos.
