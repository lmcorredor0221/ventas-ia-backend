# Plan de edición de pedidos y reconfirmación del cliente

**Fecha:** 2026-11-14
**Estado:** Implementación local ejecutada; pruebas focalizadas aprobadas; regresión regional bloqueada por un fixture/planner duplicado ajeno al alcance
**Alcance:** Backend, frontend, WhatsApp y pruebas relacionadas exclusivamente con la edición de pedidos por parte del tendero. La funcionalidad debe operar correctamente en Desktop y dispositivos móviles.

## 1. Objetivo

Permitir que el tendero modifique un pedido desde VIA y que ninguna modificación comercial se considere aceptada hasta que el cliente confirme explícitamente la nueva versión por WhatsApp.

El flujo esperado es:

```text
Tendero edita
      ↓
VIA registra versión + diferencias
      ↓
Pedido pendiente de confirmación del cliente
      ↓
WhatsApp envía resumen actualizado y acciones
      ↓
Cliente confirma / ajusta / habla con la tienda / cancela
      ↓
VIA habilita o bloquea la siguiente operación
```

## 2. Diagnóstico confirmado

La arquitectura actual ya contiene la mayor parte de las capacidades necesarias:

- `PATCH /api/orders/:id` para editar pedidos.
- Control optimista mediante `orders.version`.
- Bloqueo por pedido mediante `transitionLocks`.
- Historial `editHistory`.
- Diferencias en `customerChangeSummary`.
- Persistencia transaccional con `integration_outbox`.
- Envío de `order.summary_notification`.
- Pestañas de pedido y conversación en el workspace del tendero.
- Bloqueo parcial del alistamiento mediante `customerReconfirmation`.

La incidencia está en la integración entre esas piezas.

### 2.1 Edición normal no activa la reconfirmación

En [`server/services/orderService.js`](../server/services/orderService.js), el flujo `editUnlocked` guarda la versión y las diferencias, pero el objeto generado para una edición normal no establece de forma explícita:

```js
customerReconfirmation.status = 'required'
```

Esto provoca que el pedido pueda tener una nueva versión y una notificación pendiente, pero no quede siempre bloqueado hasta recibir la confirmación del cliente.

### 2.2 La notificación `updated` no genera acciones

En [`server/services/orderSummaryNotification.js`](../server/services/orderSummaryNotification.js), las acciones interactivas solo se crean para `manual_review_found` y `manual_review_unavailable`.

La edición normal utiliza `stage: 'updated'`, por lo que se envía el resumen, pero no necesariamente las acciones para continuar.

### 2.3 La confirmación existente es específica

En [`server/services/agentRuntime.js`](../server/services/agentRuntime.js), `confirmOrderChangeFromInteraction` llama a `confirmVariablePricing`. Esa operación sirve para revisión de precios variables, pero no representa de forma general cualquier edición realizada por el tendero.

### 2.4 Falta cancelación del pedido como acción independiente

Existe cancelación de conversación, pero no se debe reutilizar automáticamente como cancelación de pedido. La cancelación del pedido debe cambiar su estado operativo y dejar trazabilidad.

### 2.5 El frontend ya tiene una base reutilizable

[`OrderWorkspace.jsx`](../.worktrees/frontend-manual-product-review/src/features/orders/OrderWorkspace.jsx) ya contiene:

- Edición de líneas.
- Cambio de cantidades.
- Actualización de cliente, dirección, domicilio y pago.
- Pestañas `Pedido` y `Conversación`.
- Historial de cambios.
- Bloqueo visual cuando `customerReconfirmation.status === 'required'`.

Faltan la presentación clara del diff, el estado derivado de reconfirmación y el bloqueo visual consistente en todas las tarjetas.

### 2.6 Incidencia confirmada: deriva de `basketKey` después del consolidado

Antes de implementar la edición y la reconfirmación, debe corregirse una incidencia de continuidad que afecta directamente al mismo contrato: en producción el cliente selecciona `Confirmar pedido`, la interacción llega a la ruta correcta, pero el checkout vuelve a fase `review` y reenvía la cotización en lugar de persistir el pedido y habilitar el siguiente estado.

La evidencia disponible descarta que el problema sea una interpretación incorrecta de DeepSeek, un catálogo vacío o un total inválido:

| Evidencia | Resultado observado |
|---|---|
| Servicio correcto de Render | `ventas-ia-backend-free`; el despliegue activo y el entorno local apuntan al mismo commit `9ddd9b3`; no es una discrepancia entre versiones desplegadas |
| Conversación | `conversationId=wa-25d8508a`, tenant `demo-de-tienda`, cliente `573144035060` |
| Interacción | `confirm_order` se recibe y `handleInteractiveReply` la enruta a `confirmOrderFromInteraction` |
| Validación de la canasta | Productos y totales válidos; ejemplo de subtotal persistido: COP 34.500 |
| Clave persistida | `orderDraft.checkout.basketKey` y `reviewedKey` contienen la misma clave persistida |
| Clave reconstruida | `checkoutProgress` reconstruye otra clave para el mismo borrador; `equal=false` |
| Resultado | La fase calculada vuelve a `review`; no se ejecuta la persistencia final ni aparece `google_sheets_order_write` |
| DeepSeek | No participa en la ruta de `list_reply` de confirmación; la repetición es el fallback de checkout, no una nueva decisión del LLM |

La causa técnica es que [`server/domain/orderCheckout.js`](../server/domain/orderCheckout.js) recalcula `basketKey(draft)` a partir de muchos campos hidratados —SKU, nombre, presentación, cantidad, presupuesto, peso, atributos, precios, subtotales y domicilio— y la forma reconstruida no coincide con la clave guardada. `persistedBasketKey` ya existe para validar algunas ofertas interactivas, pero no es la autoridad común utilizada por `checkoutProgress` ni por `checkoutBasketAccepted` en [`server/services/agentRuntime.js`](../server/services/agentRuntime.js).

Por tanto, toda implementación de edición/reconfirmación que dependa de la identidad de la canasta debe esperar a que se estabilice este contrato. Si no se corrige primero, una reconfirmación válida puede volver a cotizar el pedido, duplicar mensajes o impedir `Marcar tomado` aunque el cliente haya confirmado la última versión.

La solución deberá distinguir entre:

- **Identidad de la canasta:** versión de negocio que el cliente revisó o confirmó.
- **Validez de la operación:** versión del pedido, tenant, estado, líneas y totales actuales.

No se debe aceptar una clave antigua de forma ciega. La clave persistida puede ser la autoridad para continuar una misma versión, pero siempre debe validarse junto con `orderId`, `tenantId`, `orders.version`, estado operativo, líneas y totales. Una edición real debe invalidar la confirmación anterior y generar una nueva identidad de canasta.

## 3. Restricción de WhatsApp

No se deben enviar cuatro botones de respuesta rápida. Meta limita los botones de respuesta rápida a tres por mensaje.

Se utilizará el mecanismo de lista interactiva ya soportado por VIA. La implementación existente de [`server/services/toolRegistry.js`](../server/services/toolRegistry.js) admite filas de lista y limita su cantidad a diez.

La lista de reconfirmación tendrá estas opciones:

1. `Confirmar pedido`
2. `Ajustar pedido`
3. `Hablar con la tienda`
4. `Cancelar pedido`

Referencias oficiales:

- [Meta: Interactive Message Templates](https://developers.facebook.com/docs/whatsapp/api/messages/message-templates/interactive-message-templates/)
- [Meta: Interactive Messages](https://developers.facebook.com/docs/whatsapp/changelog/archive/)

## 4. Decisión sobre el estado del pedido

Actualmente los estados operativos son:

- `pending_human_preparation`
- `preparing`
- `dispatched`
- `delivered`
- `cancelled`

No existe un estado canónico `pending_customer_confirmation`.

### Decisión propuesta

No agregar inicialmente un nuevo estado operativo. Se mantendrá el estado actual del pedido y se usará:

```js
customerReconfirmation.status = 'required'
```

La interfaz mostrará el estado derivado:

> Pendiente de confirmación del cliente

Este enfoque evita modificar la máquina de transiciones, hojas de cálculo, reportes y filtros existentes. Mientras la reconfirmación esté pendiente:

- No se permite `Marcar tomado`.
- No se permite `Marcar en camino`.
- El pedido no puede avanzar a preparación o despacho.

Si posteriormente se exige que el nuevo estado sea persistido como estado canónico, deberá abrirse una migración separada, porque implicaría modificar todas las transiciones y proyecciones existentes.

## 5. Plan de implementación

### Fase 0 — Congelamiento y contratos

**Objetivo:** evitar regresiones antes de tocar código.

Actividades:

- Registrar la versión actual del backend y del frontend.
- Ejecutar las pruebas existentes de edición, outbox, checkout y transiciones.
- Documentar el contrato actual de `PATCH /api/orders/:id`.
- Documentar el payload de `order.summary_notification`.
- Confirmar que el cambio no afecta identificación de productos, catálogo ni checkout inicial.

**Salida:** evidencia de línea base y lista de pruebas que deben seguir pasando.

### Fase 0.1 — Corrección mínima de identidad canónica de canasta

**Objetivo:** resolver la interrupción de confirmación antes de introducir el flujo de edición y reconfirmación.

**Archivos a revisar/modificar únicamente para esta corrección:**

- [`server/domain/orderCheckout.js`](../server/domain/orderCheckout.js)
- [`server/services/agentRuntime.js`](../server/services/agentRuntime.js)
- Pruebas de checkout y de respuestas interactivas existentes.

**Ajuste propuesto:**

1. Centralizar la lectura y validación de la identidad de canasta en un único contrato de checkout.
2. Para un borrador ya revisado, usar la clave persistida de esa misma versión como referencia de continuidad, sin confiar solo en una nueva hidratación parcial del objeto.
3. Generar una nueva clave únicamente cuando cambien productos, cantidades, modalidad de venta, precios, domicilio, total u otro dato comercial relevante.
4. Mantener la validación independiente de `orders.version`, `orderId`, `tenantId`, estado y totales para impedir confirmar versiones obsoletas o alteradas.
5. Hacer que `checkoutProgress` y `checkoutBasketAccepted` utilicen la misma función/contrato de identidad; no conservar comparaciones paralelas con reglas distintas.
6. En una edición del tendero, invalidar explícitamente la clave confirmada anterior, crear la nueva versión y exigir reconfirmación sobre la nueva clave.
7. Conservar el flujo de productos, alternativas, cantidades y consolidación que ya funciona; este ajuste no modifica la interpretación del catálogo ni el prompt de DeepSeek.

**Instrumentación mínima:** registrar, sin incluir datos sensibles completos:

- `checkout.confirmation_validation_failed`
- `checkout.basket_key_mismatch`
- `checkout.checkout_phase_not_confirmation`
- `checkout.confirmation_persisted`

Cada evento debe incluir `tenantId`, `orderId`, `conversationId`, `orders.version`, fase anterior/nueva, motivo y un hash truncado de las claves comparadas. Esto permitirá distinguir una deriva de clave de un total inválido, una versión antigua o una canasta incompleta.

**Criterio de no regresión:** con el fixture de producción reproducido localmente, la confirmación debe persistir el pedido exactamente una vez, no reenviar la cotización y generar el evento/outbox de la siguiente etapa. Una clave realmente obsoleta debe rechazarse de forma explícita.

### Fase 1 — Reconfirmación en la edición normal

**Archivo principal:** [`server/services/orderService.js`](../server/services/orderService.js)

Cambios previstos:

- Después de calcular `customerChangeSummary`, detectar si hubo cambio real.
- Para cualquier cambio comercial, crear `customerReconfirmation` con:

```js
{
  status: 'required',
  reason: 'manual_order_edit',
  previousTotal,
  total,
  difference,
  requestedAt,
  requestedBy,
  version
}
```

- No crear una nueva reconfirmación si la edición no produjo cambios.
- Mantener `editHistory` con valores antes/después.
- Persistir pedido y outbox en la misma operación existente.
- Invalidar por versión las acciones generadas para versiones anteriores.

No se modificará la lógica de selección de productos ni de cálculo de catálogo.

### Fase 2 — Resumen actualizado y acciones

**Archivos principales:**

- [`server/services/orderSummaryNotification.js`](../server/services/orderSummaryNotification.js)
- [`server/domain/whatsappOrderSummary.js`](../server/domain/whatsappOrderSummary.js)
- [`server/services/agentRuntime.js`](../server/services/agentRuntime.js)

Cambios previstos:

- Crear acciones también cuando `stage === 'updated'` y la reconfirmación sea requerida.
- Generar una oferta persistida con `purpose: 'order_change_confirmation'`.
- Enviar una lista interactiva con las cuatro opciones.
- Mostrar en el texto:
  - Productos agregados.
  - Productos retirados.
  - Productos sustituidos o cantidades modificadas.
  - Total anterior.
  - Total nuevo.
  - Diferencia.
  - Motivo registrado por el tendero.

Se conservará la idempotencia existente:

```text
order-summary:{orderId}:{version}
```

### Fase 3 — Acciones del cliente

**Archivo principal:** [`server/services/agentRuntime.js`](../server/services/agentRuntime.js)

Implementar o adaptar las acciones siguientes:

#### Confirmar pedido

- Validar `orderId`, `tenantId`, conversación y versión.
- Validar la identidad canónica de la canasta y confirmar solo la última versión revisada; no reconstruir una clave incompatible con la persistida.
- Cambiar `customerReconfirmation.status` a `confirmed`.
- Registrar actor, fecha y versión confirmada.
- Notificar al tendero.
- Habilitar el avance operativo.

#### Ajustar pedido

- Reutilizar `requestOrderAdjustment`.
- Mantener la versión actual como pendiente.
- No borrar la canasta ni las diferencias existentes.

#### Hablar con la tienda

- Reutilizar `requestStoreHandoff`.
- Incluir en el contexto el pedido y la versión pendiente.
- No confirmar ni cancelar el pedido.

#### Cancelar pedido

- Crear una operación específica para cancelar el pedido.
- No utilizar solamente `cancelConversation`.
- Validar versión y estado.
- Registrar la cancelación en el historial.
- Notificar al tendero.
- Evitar cualquier avance posterior a preparación o despacho.

### Fase 4 — Frontend

**Archivos principales:**

- [`OrderWorkspace.jsx`](../.worktrees/frontend-manual-product-review/src/features/orders/OrderWorkspace.jsx)
- [`OrderProgressCard.jsx`](../.worktrees/frontend-manual-product-review/src/features/orders/OrderProgressCard.jsx)
- CSS existente del workspace.

Cambios previstos:

- Mostrar `Pendiente de confirmación del cliente` como estado destacado.
- Mostrar diferencias de la última edición.
- Mostrar total anterior, total nuevo y motivo.
- Deshabilitar visualmente las acciones operativas mientras la reconfirmación sea requerida.
- Mantener las pestañas `Pedido` y `Conversación`.
- Permitir revisar el historial sin perder la edición actual.
- Mantener el checkbox del tendero como constancia de acuerdo, aclarando que no reemplaza la confirmación del cliente.

#### Requisito multiplataforma

La edición y reconfirmación deben ser utilizables tanto desde Desktop como desde móvil, sin depender de una resolución específica ni de acciones disponibles únicamente con mouse.

En ambas experiencias se debe poder:

- Abrir el pedido y alternar entre las pestañas `Pedido` y `Conversación`.
- Ver el resumen, el estado de reconfirmación y las diferencias.
- Editar productos, cantidades, domicilio y medio de pago cuando el estado lo permita.
- Guardar o cancelar la edición con confirmación visual del resultado.
- Consultar el historial de cambios.
- Identificar por qué una acción está bloqueada.
- Abrir la conversación de WhatsApp o continuar la atención manual.
- Verificar si el cliente confirmó, ajustó o canceló el pedido.

En móvil, adicionalmente:

- Las pestañas deben conservar un área táctil suficiente.
- Los botones principales deben apilarse sin quedar fuera del viewport.
- El formulario debe permitir desplazamiento vertical sin perder los controles de guardado.
- Los mensajes de error, estado y confirmación deben permanecer visibles después de guardar.
- La lista de productos y el historial deben poder revisarse sin desbordamiento horizontal.

En Desktop, adicionalmente:

- El pedido y la conversación deben poder revisarse con claridad en el workspace.
- Las acciones principales deben permanecer visibles y diferenciadas de las acciones secundarias.
- El diff de cambios no debe ocultarse por el ancho disponible.

La API y el backend seguirán siendo la autoridad para permisos, versión, estado y bloqueo; la adaptación responsive no debe duplicar reglas de negocio en el frontend.

Sobre `Editar pedido`:

- El backend seguirá siendo la autoridad.
- Los pedidos abiertos podrán editarse.
- Los pedidos en despacho, entregados o cancelados mostrarán la acción deshabilitada con la razón correspondiente.
- No se permitirá modificar silenciosamente pedidos finalizados.

### Fase 5 — Observabilidad

Agregar o verificar eventos para:

- `order.edited`
- `order.customer_reconfirmation_required`
- `order.summary_notification_queued`
- `order.summary_notification_sent`
- `order.customer_reconfirmation_confirmed`
- `order.customer_reconfirmation_adjustment_requested`
- `order.customer_reconfirmation_cancelled`
- `order.edit_version_conflict`
- `order.edit_rejected_terminal_status`

Cada evento debe incluir como mínimo:

- `tenantId`
- `orderId`
- `conversationId`
- versión anterior y nueva
- actor
- resultado
- motivo de error, si aplica

## 6. Pruebas de aceptación

## 6.1 Implementación ejecutada localmente

La implementación se realizó sin commit, push, despliegue, cambios de base de datos ni cambios de configuración de producción. Se conservaron los cambios preexistentes del árbol de trabajo.

### Backend

- [`server/domain/orderCheckout.js`](../server/domain/orderCheckout.js): se consolidó el cálculo de `basketKey`, normalizando valores opcionales, ordenando las líneas y usando la identidad persistida mientras no exista un cambio real de canasta. Una edición o una nueva revisión genera una nueva clave.
- [`server/services/agentRuntime.js`](../server/services/agentRuntime.js): la fase de checkout y la aceptación usan el mismo contrato de identidad; las acciones de reconfirmación validan pedido, tenant, conversación, versión y estado; se incorporó la cancelación específica del pedido y la auditoría de ajuste/cancelación/confirmación.
- [`server/services/orderService.js`](../server/services/orderService.js): toda edición comercial normal crea `customerReconfirmation.status = 'required'`, conserva historial y diferencia de totales, encola el resumen versionado y emite eventos de auditoría. La confirmación general reutiliza la operación previa de precios variables mediante compatibilidad hacia atrás.
- [`server/services/orderSummaryNotification.js`](../server/services/orderSummaryNotification.js): la etapa `updated` genera una oferta persistida con cuatro acciones mediante lista interactiva de WhatsApp: confirmar, ajustar, hablar con la tienda y cancelar.

### Frontend

En el worktree de frontend [`../.worktrees/frontend-manual-product-review/src/features/orders/OrderWorkspace.jsx`](../.worktrees/frontend-manual-product-review/src/features/orders/OrderWorkspace.jsx) y [`../.worktrees/frontend-manual-product-review/src/features/orders/OrderProgressCard.jsx`](../.worktrees/frontend-manual-product-review/src/features/orders/OrderProgressCard.jsx):

- se muestra el diff de la edición y el total anterior/nuevo;
- se informa que la reconfirmación del cliente está pendiente;
- se bloquean `Marcar tomado` y `Marcar en camino` mientras el estado sea `required`;
- se conserva la revisión del pedido y la conversación mediante las pestañas existentes;
- el comportamiento responsive existente no se reemplazó ni se duplicaron reglas de negocio en el frontend.

## 6.2 Evidencia de pruebas ejecutadas

Pruebas focalizadas aprobadas:

- `node server/tests/checkout-basket-identity.mjs`
- `node server/tests/order-summary-notification.mjs`
- `node server/tests/interactive-offer-persistence.mjs`
- `node server/tests/manual-product-review-order.mjs`
- `npm run test:checkout` (secuencia, continuidad, interpretación, escalamiento contextual y venta variable)
- `npm run build` en el worktree de frontend; build Vite completado correctamente.

La suite regional `node server/tests/colombia-scenarios.mjs` llegó hasta el escenario `real_supermarket_valor_calchichon_coca` y falló por un contrato de fixture/planner anterior a esta intervención: la entrada genera dos candidatos de salchichón, uno sin resolver (`calchichon 350`) y otro resuelto (`calchichon`). El runtime conserva correctamente la canasta en `collecting`, pero el fixture espera pago y resumen final. El fallo no se originó en la edición/reconfirmación y no se modificó la lógica de producción para ocultarlo. Debe resolverse como tarea independiente de deduplicación/reconciliación del planner o del escenario regional.

La traza temporal usada para diagnosticar ese caso fue retirada del runner antes de cerrar las pruebas.

### Backend

1. Editar cantidad y verificar reconfirmación requerida.
2. Agregar producto y verificar diff y notificación.
3. Retirar producto y verificar diff y total nuevo.
4. Cambiar dirección, domicilio o medio de pago.
5. Guardar sin cambios y comprobar que no se solicite reconfirmación.
6. Intentar guardar con `expectedVersion` antiguo.
7. Confirmar la versión vigente.
8. Repetir la confirmación y comprobar idempotencia.
9. Solicitar ajuste y conservar la canasta.
10. Transferir a tienda.
11. Cancelar pedido.
12. Intentar marcar tomado con reconfirmación pendiente.
13. Editar después de una confirmación y exigir una nueva confirmación.
14. Rechazar edición de pedidos entregados o cancelados.
15. Reproducir el fixture real con productos de peso y comprobar que la clave persistida y la clave usada por el checkout sean compatibles.
16. Confirmar desde `list_reply` y comprobar que se escribe el pedido una sola vez, sin reenviar la cotización.
17. Repetir la misma interacción y comprobar idempotencia sin duplicar outbox ni transición.
18. Alterar deliberadamente la versión o clave y comprobar rechazo seguro, sin confirmar la versión equivocada.

### WhatsApp

- El resumen actualizado contiene los cambios.
- La lista contiene las cuatro opciones.
- Las respuestas `list_reply` y texto libre equivalente funcionan.
- Una oferta anterior no puede confirmar una versión nueva.
- Los reintentos del outbox no duplican mensajes.

### Frontend

- El estado pendiente es visible en escritorio y móvil.
- La conversación y el pedido se pueden revisar desde sus pestañas.
- Los cambios y totales son comprensibles.
- Las acciones operativas permanecen bloqueadas hasta la confirmación.
- La interfaz no pierde el historial ni el contexto después de actualizar.
- El mismo flujo funcional se puede completar desde Desktop y móvil.
- En móvil no hay controles inaccesibles, desbordamiento horizontal ni botones fuera del viewport.
- En Desktop el resumen, el diff y la conversación son visibles sin ocultar las acciones principales.
- La edición guardada desde una plataforma se refleja correctamente al abrir el pedido desde la otra.

### Regresión

Deben continuar pasando, como mínimo:

- `manual-order-workspace-contract`
- `manual-product-review-order`
- `variable-pricing-contract`
- `checkout-sequence`
- `catalog-selection-reconciliation`
- `whatsapp-live-contract`
- pruebas de concurrencia
- pruebas de outbox

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Confirmar una versión antigua | Validar versión en cada acción y rechazar con mensaje claro |
| Duplicar mensajes por reintento | Mantener idempotencia de outbox y `deliveryKey` |
| Permitir alistamiento sin confirmación | Bloqueo en backend y frontend |
| Confundir cancelación de conversación con cancelación de pedido | Implementar acción específica de pedido |
| Romper checkout inicial | Mantener separado `order_confirmation` de `order_change_confirmation` |
| Superar el límite de botones de WhatsApp | Usar mensaje de lista con cuatro filas |
| Editar pedidos finalizados | Rechazo autoritativo en backend |
| Perder cambios al solicitar ajuste | Mantener `orderDraft`, versión e historial |
| Deriva entre la clave persistida y la reconstruida | Usar un contrato canónico común y validar la clave junto con versión, líneas y totales |
| Resolver la deriva confiando ciegamente en la clave guardada | Mantener validaciones de versión, estado, tenant, pedido y totales antes de confirmar |

## 8. Criterios de salida

El plan se considerará completado cuando:

- Toda edición comercial genere reconfirmación obligatoria.
- El cliente reciba un resumen claro y versionado.
- Las cuatro acciones funcionen desde WhatsApp.
- La confirmación de una versión válida no vuelva a fase `review`, no reenvíe la cotización y persista el pedido una sola vez.
- El tendero no pueda avanzar un pedido sin confirmación.
- Las modificaciones queden auditadas.
- Los pedidos finalizados sigan protegidos.
- Las pruebas nuevas y de regresión pasen.
- La matriz responsive pase en Desktop y móvil para los flujos de edición, reconfirmación, ajuste, transferencia y cancelación.
- No se hayan alterado los flujos de catálogo, interpretación, checkout inicial o alistamiento que ya funcionaban.

**Estado actual:** la implementación local del plan está aplicada en backend y en el worktree de frontend. Las pruebas focalizadas del plan están aprobadas. La suite regional completa sigue bloqueada por el escenario duplicado de salchichón descrito en la sección 6.2; no se considera un fallo introducido por este plan. No se han realizado commit, push ni despliegue.
