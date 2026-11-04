# Consolidar la canasta antes de pedir el pago

## Incidente y causa

El comprador pidió «una leche entera» y VIA ofreció Alquería/Colanta junto con
los botones Efectivo/Tarjeta/Bre-B. El comprador todavía estaba agregando pan y
queso. Se reproducía localmente: `handleDeliveryOrder` y
`handleOrderClarification` ofrecían pago con solo detectar `payment_method`
pendiente. No exigían resolver la presentación ni terminar de armar la canasta.
La respuesta textual tenía la misma condición incompleta.

Esto es distinto del incidente anterior de identidad BSUID/JSON incompleto.
No requiere cambiar credenciales, catálogo, esquema PostgreSQL ni frontend.

## Comportamiento corregido

1. Resolver productos, cantidades, presentaciones y datos pendientes. Con
   ambigüedad no se ofrecen pago ni confirmación final; se conservan las reglas
   existentes de aclaración y escalamiento al tendero.
2. Mostrar productos y subtotal, preguntar si desea agregar o continuar.
   Botones: **Continuar pedido / Agregar productos / Hablar con la tienda**.
3. Cuando el comprador termina la canasta, solicitar el medio de pago de la
   tienda si aún falta. Si lo mencionó antes, conservarlo como preferencia.
4. Mostrar el resumen y ofrecer **Confirmar pedido / Ajustar pedido / Hablar
   con la tienda**. Solo esta aceptación registra el pedido.
5. Si cambia productos, presentación, cantidades o importes, volver a revisar
   la canasta. Un botón de un resumen anterior no puede confirmar la nueva.

DeepSeek interpreta el cierre de la canasta con `order.collectionComplete`:
`true` al terminar expresamente, `false` al pedir seguir agregando/esperar, y
`null`/ausente en respuestas que solo completan datos. No hay una lista de
productos o modismos codificada para decidir el cierre. La señal dura un turno;
el backend conserva la revisión asociada a la canasta exacta en
`orderDraft.checkout`, dentro del JSON existente.

Elegir pago desde un botón antiguo no cierra la canasta. Un «confirmo» prematuro
no resuelve por sí solo una presentación pendiente. Agregar productos también
invalida la revisión cuando se solicita mediante el botón de ajustes.

## Validación reproducible

- `npm run test:checkout`: conversación con marca pendiente, adición de pan,
  selección de marca, cambio de cantidades, resumen, pago, botones antiguos,
  confirmación final y elección anticipada de pago. Usa runtime, herramientas,
  catálogo y persistencia reales con transporte WhatsApp local simulado.
- `server/tests/checkout-interpretation.mjs`: contrato del intérprete. Para
  consultar DeepSeek real, establecer `VIA_CHECKOUT_REAL_LLM=1` y proporcionar
  `DEEPSEEK_API_KEY` por entorno. No crea conexión de base de datos ni envía
  mensajes. Verifica cinco expresiones: solicitud inicial, marca, pago con
  producto adicional, pago aislado y finalización contextual de la canasta.
- `npm run test:backend`: regresiones de cotización/precios, saludos, identidad,
  concurrencia, fallos de proveedor, autenticación, Google, WhatsApp/BSUID,
  onboarding y restricciones del canal. Los 50 escenarios colombianos incluyen
  ahora tres pasos explícitos de revisión de canasta (63 pasos en total).

La primera ejecución de la regresión falló porque se creaba `payment_method`
con `presentation` pendiente. Después de la corrección pasó. DeepSeek real
diferenció las respuestas de marca/pago del cierre de canasta; no se enviaron
mensajes reales a los compradores durante estas verificaciones. No equivale a
una nueva prueba E2E de 40 pedidos reales: la regresión completa usa proveedores
simulados y la comprobación de interpretación consulta DeepSeek.

Resultado final local del 3 de noviembre de 2026: `test:backend` completo
aprobado, incluidos los 50 escenarios/63 pasos y las nuevas regresiones;
5/5 comprobaciones de interpretación con DeepSeek real aprobadas.

## Operación

El cambio se publica únicamente en el backend del demo. Se conservan pedidos,
conversaciones y sesiones manuales. Una conversación que ya atiende el tendero
no se reabre automáticamente para probar el arreglo. Los borradores anteriores
sin estado de revisión pasan por el resumen antes de continuar.
