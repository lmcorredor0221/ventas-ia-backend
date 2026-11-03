import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

// Replay the provider's sparse clarification output, with real runtime, tools,
// catalog, offers and persistence. No external LLM or WhatsApp calls are made.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-quote-continuity-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', whatsappMode: 'mock', dataFile: path.join(dir, 'store.json'),
});
const products = [
  { sku: 'QUOTE-COLA', name: 'Coca-Cola original', presentation: '1.5 L', price: 7200, stock: 24 },
  { sku: 'QUOTE-CAKE', name: 'Ponque Chocoramo', presentation: '65 g', price: 2800, stock: 55 },
];
const sparseItems = products.map((product) => ({ skuHint: product.sku, catalogQuery: product.name, quantity: 1 }));
runtime.planner = {}; // Use the exact provider result below, not a simulated interpretation.
let sequence = 0;
function setup() {
  const id = `quote-continuity-${++sequence}`;
  store.mutate((state) => {
    state.productsByTenant.andina = structuredClone(products);
    state.conversations.unshift({
      id, tenantId: 'andina', waId: `57300000000${sequence}`, messages: [], status: 'live',
      orderDraft: { delivery: true, subtotal: 10000, paymentMethod: 'breb',
        missingFields: ['customer_name', 'delivery_address'],
        items: products.map((product) => ({ skuHint: product.sku, catalogQuery: product.name,
          quantity: 1, product: structuredClone(product), lineTotal: product.price, available: true })),
      },
    });
  });
  return { tenantId: 'andina', conversationId: id,
    normalized: { waId: `57300000000${sequence}`, text: 'Luis Corredor, Dimonti 1' },
    customerProfile: null,
    plan: { intent: 'order_clarification', customerDetails: { name: 'Luis Corredor', deliveryAddress: 'Dimonti 1' },
      order: { delivery: true, paymentMethod: 'breb', subtotal: 10000, items: structuredClone(sparseItems) } },
  };
}
const conversation = (id) => store.getState().conversations.find((item) => item.id === id);
const lastReply = (id) => conversation(id).messages.filter((item) => item.role === 'agent').at(-1)?.text;

try {
  const args = setup();
  store.mutate(() => { delete conversation(args.conversationId).orderDraft; });
  await runtime.handleDeliveryOrder({ ...args,
    normalized: { ...args.normalized, text: 'Una Coca-Cola 1.5 L y un Chocoramo para domicilio' },
    plan: { intent: 'delivery_order', order: { delivery: true, items: structuredClone(sparseItems) },
      missingFields: ['customer_name', 'delivery_address', 'payment_method'] },
  });
  assert.equal(conversation(args.conversationId).orderDraft.subtotal, 10000);
  const paymentOffer = Object.values(store.getState().interactionOffersById).find((item) => item.conversationId === args.conversationId && item.purpose === 'payment_method');
  const breb = paymentOffer.options.find((item) => item.value === 'breb');
  await runtime.handleInteractiveReply({ ...args, normalized: { ...args.normalized, text: 'Bre-B', interactive: { optionId: breb.id } } });
  assert.equal(conversation(args.conversationId).orderDraft.subtotal, 10000);
  await runtime.handleOrderClarification(args);
  let draft = conversation(args.conversationId).orderDraft;
  assert.equal(draft.subtotal, 10000, 'Name/address clarification must preserve catalog amounts');
  assert.deepEqual(draft.items.map((item) => item.lineTotal), [7200, 2800]);
  assert.deepEqual(draft.missingFields, []);
  assert.match(lastReply(args.conversationId), /10\.000/);
  assert.match(lastReply(args.conversationId), /Coca-Cola original/);
  const offer = Object.values(store.getState().interactionOffersById).find((item) => item.conversationId === args.conversationId && item.purpose === 'order_confirmation');
  assert.ok(offer, 'The valid quote offers confirmation buttons');
  await runtime.handleInteractiveReply({ ...args, normalized: { ...args.normalized, text: 'Confirmar pedido', interactive: { optionId: offer.options[0].id } } });
  const order = store.getState().ordersByTenant.andina.find((item) => item.conversationId === args.conversationId);
  assert.equal(order.subtotal, 10000);
  assert.deepEqual(order.items.map((item) => item.unitPrice), [7200, 2800]);
  assert.match(lastReply(args.conversationId), /10\.000/);
  assert.equal(store.getState().pendingRequests.find((item) => item.conversationId === args.conversationId).contextSnapshot.subtotal, 10000);

  const omitted = setup();
  delete omitted.plan.order;
  await runtime.handleOrderClarification(omitted);
  assert.equal(conversation(omitted.conversationId).orderDraft.subtotal, 10000, 'Omitted cart is not an empty cart');

  const changed = setup();
  changed.plan.order.items[0].quantity = 2;
  changed.plan.order.items[0].product = { ...products[1], price: 1 };
  changed.plan.order.items[0].lineTotal = 2;
  await runtime.handleOrderClarification(changed);
  draft = conversation(changed.conversationId).orderDraft;
  assert.equal(draft.subtotal, 17200, 'Quantity changes use catalog price, never LLM price');

  const reordered = setup();
  reordered.plan.order.items.reverse();
  await runtime.handleOrderClarification(reordered);
  assert.deepEqual(conversation(reordered.conversationId).orderDraft.items.map((item) => item.lineTotal), [2800, 7200], 'Prices follow SKU, not array position');

  const removed = setup();
  removed.normalized.text = 'quita el Chocoramo';
  await runtime.handleOrderClarification(removed);
  assert.equal(conversation(removed.conversationId).orderDraft.subtotal, 7200);

  const missing = setup();
  missing.plan.order.items.push({ skuHint: 'UNKNOWN', catalogQuery: 'Producto inexistente', quantity: 1 });
  await runtime.handleOrderClarification(missing);
  assert.equal(conversation(missing.conversationId).status, 'blocked', 'Unknown product must go to human review');
  assert.ok(!Object.values(store.getState().interactionOffersById).some((item) => item.conversationId === missing.conversationId && item.purpose === 'order_confirmation'));

  const legacy = setup();
  store.mutate(() => { conversation(legacy.conversationId).orderDraft = { ...legacy.plan.order, subtotal: 0, missingFields: [] }; });
  await runtime.handleOrderConfirmation({ ...legacy, customerProfile: { name: 'Luis', defaultAddress: 'Dimonti 1' } });
  assert.ok(!(store.getState().ordersByTenant.andina ?? []).some((item) => item.conversationId === legacy.conversationId), 'Do not confirm a previously broken zero quote');
  assert.equal(conversation(legacy.conversationId).orderDraft.subtotal, 10000);
  assert.match(lastReply(legacy.conversationId), /10\.000/);

  const empty = setup();
  empty.normalized.text = 'quita el Chocoramo';
  empty.plan.order.items = [structuredClone(sparseItems[1])];
  await runtime.handleOrderClarification(empty);
  assert.ok(conversation(empty.conversationId).orderDraft.missingFields.includes('order_items'));
  assert.doesNotMatch(lastReply(empty.conversationId), /\$\s*0\b/);

  const noPrice = setup();
  store.mutate((state) => { state.productsByTenant.andina[0].price = null; });
  await runtime.handleDeliveryOrder(noPrice);
  assert.equal(conversation(noPrice.conversationId).status, 'blocked', 'Missing catalog price cannot be quoted as free');
  assert.ok(conversation(noPrice.conversationId).orderDraft.missingFields.includes('price:Coca-Cola original'));
  console.log('Quote continuity regression passed: sparse plan, omitted cart, quantities, removal, unknown product, legacy quote, interactive confirmation.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('via-quote-continuity-')) fs.rmSync(dir, { recursive: true, force: true });
}
