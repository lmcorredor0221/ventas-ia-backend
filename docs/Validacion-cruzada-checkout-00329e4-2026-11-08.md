# Validación cruzada: continuidad de checkout posterior a selección

Fecha: 2026-11-08  
Línea base revisada: `00329e4`  
Alcance: únicamente la continuidad selección → revisión → pago → confirmación.

## Conclusión

El diagnóstico previo fue **confirmado parcialmente y precisado**. La causa no es que el cliente deba volver a escribir ni que falten las ofertas interactivas. La línea base ya implementa las tres ofertas:

1. `cart_review`: **Continuar pedido / Agregar productos / Hablar con la tienda**.
2. `payment_method`: **Efectivo / Tarjeta / Bre-B**.
3. `order_confirmation`: **Confirmar pedido / Ajustar pedido / Hablar con la tienda**.

El flujo no las alcanzaba cuando texto explicativo libre generado por la inferencia de productos se guardaba en `orderDraft.missingFields`. `checkoutProgress()` clasifica cualquier valor distinto de `payment_method` como pendiente operativo, por lo que deja el borrador en `collecting`. En esa fase solo puede existir una selección de catálogo; no se crea la revisión, el pago ni la confirmación.

No se modificó la búsqueda, las variantes, el grafo, el catálogo ni la lógica de selección que funcionaba en `00329e4`.

## Evidencia contrastada

| Hipótesis | Evidencia | Veredicto |
| --- | --- | --- |
| El checkout espera erróneamente otro mensaje para decidir el pago | `createCheckoutOffer()` ya crea el pago cuando `checkout.phase === 'payment'`; `handleInteractiveReply()` avanza `continue_checkout` y `set_payment_method` sin invocar al LLM. | Descartada. |
| El sistema no tiene implementadas las opciones posteriores | Existen `createCheckoutOffer`, `createPaymentOffer` y `createOrderConfirmationOffer` con las etiquetas requeridas. | Descartada. |
| Una explicación del LLM bloquea el estado | En `LLMPlanner.apiTwoStageParse()`, `products.missingInfo` se asignaba a `missingFields`. `missingInfo` permite prosa libre; `checkoutProgress()` no. | Confirmada. |
| El problema se reproduce a partir de una canasta ya resuelta | Antes de la corrección, la prueba aislada inyecta la narrativa «Confirmación de la dirección de entrega pendiente según el contexto», selecciona la última variante real y obtiene `checkout.phase = collecting`, cuando debía ser `review`. | Confirmada. |
| La evidencia de producción coincide con una interrupción de lógica, no con caída del webhook | Los trazos de Render para `demo-de-tienda` terminaron con `status: ok`; duraron entre 1.6 s y 12.6 s. La captura de producción muestra el subtotal sin CTA. Los trazos publicados no incluyen fase ni `missingFields`, por lo que no permiten recuperar el valor exacto. | Compatible; observabilidad insuficiente para probar el payload histórico. |
| Hay que corregir búsqueda o catálogo para resolver este incidente | La reproducción utiliza candidatos reales, los selecciona y conserva precios/subtotal antes de fallar exclusivamente al calcular la fase. | Descartada para este alcance. |

La consulta de solo lectura a Supabase para inspeccionar el registro exacto fue rechazada por permisos del conector. No se intentaron cambios ni consultas alternativas que expusieran datos personales.

## Corrección focalizada

1. **Límite de contrato en el planificador.** `missingInfo` se conserva como explicación de inferencia, pero deja de copiarse a `missingFields`.
2. **Límite de contrato en el runtime.** Solo se permiten claves operativas canónicas: `customer_name`, `delivery_address`, `payment_method`, `order_items` y claves con prefijo `product:`, `price:`, `stock:`, `quantity:`, `presentation:`, `selection:`, `commercial_review:` o `budget:`.
3. **Compatibilidad con conversaciones existentes.** Al restaurar un borrador, se descarta la prosa histórica antes de calcular la siguiente fase; no exige reiniciar ni borrar la conversación.
4. **Prueba de regresión.** Simula una ambigüedad real, inyecta la narrativa problemática y verifica el recorrido completo: selección → revisión → pago → confirmación.

Esto no sustituye la interpretación contextual del LLM: el modelo sigue produciendo `missingInfo`, entiende el pedido y decide las ambigüedades. La corrección impide únicamente que una explicación humana se use como un identificador de estado de máquina.

## Validación local ejecutada

Todos se ejecutaron contra una copia aislada en `00329e4`, sin WhatsApp, Render ni datos productivos:

- `node server/tests/catalog-selection-reconciliation.mjs` — pasa. Incluye la regresión reproducida y las tres ofertas consecutivas.
- `node server/tests/checkout-sequence.mjs` — pasa. Revisión, pago, botones vencidos y confirmación.
- `node server/tests/checkout-interpretation.mjs` — pasa (5 contratos de interpretación).
- `node server/tests/tenant-checkout-flow.mjs` — pasa.
- `node server/tests/catalog-ambiguity-regression.mjs` — pasa.
- `node server/tests/whatsapp-live-contract.mjs` — pasa.

El script agregado a `package.json` para `test:checkout` referencia `server/tests/checkout-continuation-intent.mjs`, pero ese archivo no existe en el árbol del commit `00329e4`; por ello se ejecutaron individualmente los contratos disponibles y pertinentes.

## Pendiente antes de producción

El cambio queda únicamente en la rama aislada `codex/checkout-continuity-00329e4`. No se hizo commit, push ni despliegue. Antes de promoverlo, conviene ampliar telemetría con campos no sensibles: `checkoutPhase`, lista de claves operativas de `missingFields`, propósito de la oferta creada y si se incluyó `interactive`. Eso permitirá verificar incidencias futuras sin consultar contenido conversacional.
