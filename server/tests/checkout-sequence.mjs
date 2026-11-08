import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

// Replay provider decisions with the real catalog, runtime, offers and store.
// No external messages, production data or provider credentials are used.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-checkout-sequence-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', whatsappMode: 'mock', backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});
runtime.planner = {};
const products = [
  { sku: 'MILK-A', name: 'Leche entera Alqueria', presentation: '1 L', price: 4700, stock: 20 },
  { sku: 'MILK-C', name: 'Leche entera Colanta', presentation: '1 L', price: 4800, stock: 20 },
  { sku: 'BREAD', name: 'Pan tajado', presentation: '500 g', price: 6000, stock: 20 },
];
const profile = { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' };
const item = index => ({ skuHint: products[index].sku, catalogQuery: products[index].name, quantity: 1 });
const args = { tenantId: 'andina', conversationId: 'checkout-sequence',
  normalized: { waId: '573000000123', text: 'una leche entera' }, customerProfile: profile };
store.mutate(state => {
  state.productsByTenant.andina = structuredClone(products);
  state.conversations.unshift({ id: args.conversationId, tenantId: 'andina', waId: args.normalized.waId, messages: [], status: 'live' });
});
const conv = () => store.getState().conversations.find(c => c.id === args.conversationId);
const reply = () => conv().messages.filter(m => m.role === 'agent').at(-1)?.text ?? '';
const interactiveButtons = () => conv().messages.filter(m => m.role === 'agent').at(-1)?.interactive?.buttons?.map(button => button.title) ?? [];
const offer = purpose => Object.values(store.getState().interactionOffersById ?? {}).filter(o => o.conversationId === args.conversationId && o.purpose === purpose && o.status === 'active').at(-1);
const clarify = (text, order = {}) => runtime.handleOrderClarification({ ...args, normalized: { ...args.normalized, text }, plan: { intent: 'order_clarification', order } });
const click = async option => runtime.handleInteractiveReply({ ...args, normalized: { ...args.normalized, text: option.title, interactive: { optionId: option.id } } });
try {
  await runtime.handleDeliveryOrder({ ...args, plan: { intent: 'delivery_order',
    customerDetails: { name: profile.name, deliveryAddress: profile.defaultAddress },
    order: { delivery: true, items: [item(0)] }, missingFields: ['presentation:Leche entera Alqueria', 'payment_method'] } });
  assert.equal(offer('payment_method'), undefined, 'Do not offer payment while the brand/presentation is unresolved');
  assert.doesNotMatch(reply(), /prefieres pagar|Efectivo|Tarjeta|Bre-B/i);
  // Buyer adds bread before resolving the milk. Neither addition completes the basket.
  await clarify('y un pan tajado', { items: [item(0), item(2)] });
  assert.equal(offer('payment_method'), undefined);
  // Explicit catalog selection resolves the ambiguity, but is not a checkout confirmation.
  await runtime.handleDeliveryOrder({ ...args, replaceDraft: true,
    normalized: { ...args.normalized, text: 'Colanta' },
    plan: { intent: 'order_clarification', order: { delivery: true, items: [item(1), item(2)] }, missingFields: [] } });
  assert.equal(conv().orderDraft.subtotal, 10800);
  assert.equal(offer('payment_method'), undefined, 'Resolved items still require the buyer to finish adding');
  assert.ok(offer('cart_review'));
  assert.deepEqual(interactiveButtons(), ['Continuar pedido', 'Agregar productos', 'Hablar con la tienda'], 'The review actions must be preserved with the outgoing message');
  assert.match(reply(), /10\.800/);
  const oldReview = offer('cart_review');
  await clarify('mejor dos panes', { items: [item(1), { ...item(2), quantity: 2 }] });
  await click(oldReview.options[0]);
  assert.match(reply(), /cambió/i, 'Old review buttons must not accept a changed basket');
  assert.equal(offer('payment_method'), undefined);
  await click(offer('cart_review').options[0]);
  assert.ok(offer('payment_method'), 'Payment follows the current basket review');
  assert.deepEqual(interactiveButtons(), ['Efectivo', 'Tarjeta', 'Bre-B'], 'The payment choices must be preserved with the outgoing message');
  assert.match(reply(), /16\.800/);
  // Payment interaction must retain the profile and quote and issue final buttons.
  await click(offer('payment_method').options.find(o => o.value === 'cash'));
  assert.ok(offer('order_confirmation'));
  assert.deepEqual(interactiveButtons(), ['Confirmar pedido', 'Ajustar pedido', 'Hablar con la tienda'], 'The final actions must be preserved with the outgoing message');
  assert.equal(conv().orderDraft.paymentMethod, 'cash');
  const oldConfirmation = offer('order_confirmation');
  await clarify('agrega otra leche', { items: [{ ...item(1), quantity: 2 }, { ...item(2), quantity: 2 }] });
  assert.equal(conv().orderDraft.checkout.phase, 'review');
  await click(oldConfirmation.options[0]);
  assert.match(reply(), /cambió/i);
  assert.ok(!(store.getState().ordersByTenant.andina ?? []).some(o => o.conversationId === args.conversationId));
  // Semantic completion comes from the interpreter, not a list of product/phrase regexes.
  await clarify('con eso quedamos, veci', { collectionComplete: true });
  assert.equal(conv().orderDraft.checkout.phase, 'confirmation');
  await click(offer('order_confirmation').options[0]);
  const order = store.getState().ordersByTenant.andina.find(o => o.conversationId === args.conversationId);
  assert.equal(order.subtotal, 21600);
  assert.equal(order.paymentMethod, 'cash');
  args.conversationId = 'early-payment';
  store.mutate(state => state.conversations.unshift({ id: args.conversationId, tenantId: 'andina', waId: args.normalized.waId, messages: [], status: 'live' }));
  await runtime.handleDeliveryOrder({ ...args, plan: { intent: 'delivery_order', order: { delivery: true, items: [item(0)] }, missingFields: ['presentation:Leche entera Alqueria'] } });
  const legacyPayment = await runtime.createPaymentOffer({ ...args, paymentMethods: [{ id: 'cash', label: 'Efectivo' }] });
  await click(legacyPayment.offer.options[0]);
  assert.equal(conv().orderDraft.paymentMethod, 'cash', 'Preserve payment volunteered through an old button');
  // The fixture uses an explicit SKU (MILK-A), so the product is resolved.
  // Payment alone must still leave checkout in review until the buyer says
  // to continue; it must not jump directly to confirmation.
  assert.equal(conv().orderDraft.checkout.phase, 'review');
  assert.equal(offer('order_confirmation'), undefined);
  await runtime.handleOrderConfirmation({ ...args, normalized: { ...args.normalized, text: 'Confirmo' }, plan: { intent: 'order_confirmation' } });
  assert.ok(!(store.getState().ordersByTenant.andina ?? []).some(o => o.conversationId === args.conversationId), 'Text confirmation cannot bypass the review step');
  // A semantic confirmation can advance the draft to the final confirmation
  // checkpoint, but the order is still not written until its confirmation
  // interaction is consumed.
  assert.equal(conv().orderDraft.checkout.phase, 'confirmation');
  assert.ok(offer('order_confirmation'));

  // Sanitized replay of the production checkpoint: the basket and delivery
  // were already settled, but a contextual acceptance arrives with the
  // interpreter's default `delivery: false` and obsolete prose in
  // `missingFields`. It must advance to payment, not repeat the quote.
  args.conversationId = 'production-checkout-continuation';
  store.mutate(state => state.conversations.unshift({
    id: args.conversationId,
    tenantId: 'andina',
    waId: args.normalized.waId,
    messages: [{ role: 'agent', text: 'Resumen del pedido. ¿Quieres agregar algo más o continuar con este pedido?' }],
    status: 'live',
    stage: 'clarification',
    orderDraft: {
      delivery: true,
      subtotal: 10800,
      paymentMethod: null,
      missingFields: [
        "Confirmación de la dirección de entrega (perfil sugiere 'Dirección de prueba', sin verificar)",
        'Método de pago',
        'payment_method',
      ],
      checkout: { phase: 'review', reviewedKey: null },
      items: [
        { ...item(1), product: products[1], lineTotal: 4800, available: true },
        { ...item(2), product: products[2], lineTotal: 6000, available: true },
      ],
    },
  }));
  await clarify('Confirmado', { delivery: false, collectionComplete: true });
  assert.equal(conv().orderDraft.checkout.phase, 'payment', 'A semantic acceptance must retain the settled delivery and advance to payment');
  assert.deepEqual(conv().orderDraft.missingFields, ['payment_method'], 'Obsolete prose from an earlier turn cannot block checkout');
  assert.ok(offer('payment_method'), 'Payment options must follow the accepted review');
  assert.deepEqual(interactiveButtons(), ['Efectivo', 'Tarjeta', 'Bre-B']);
  console.log('Checkout sequence passed: ambiguity, additions, review, payment, stale buttons and final confirmation.');
} finally {
  runtime.stop(); integrationOutbox.stop(); await store.close?.();
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('via-checkout-sequence-')) fs.rmSync(dir, { recursive: true, force: true });
}
