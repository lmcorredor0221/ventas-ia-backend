import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { assessCommerceItems } from '../domain/whatsappCommercePolicy.js';

// Compliance regression: provider decisions are replayed; all messages, catalog
// reads and writes stay local. Restricted fixtures must never become orders.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-channel-policy-'));
const { store, runtime, tools, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', whatsappMode: 'mock', allowLocalCatalogFallback: true,
  backgroundWorkersEnabled: false, dataFile: path.join(dir, 'store.json'),
});
const products = [
  { sku: 'SAFE', name: 'Coca-Cola', category: 'Bebidas', presentation: '1.5 L', price: 7200, stock: 20 },
  { sku: 'BLOCKED', name: 'Producto de tabaco de prueba', category: 'Tabaco', price: 9000, stock: 10 },
  { sku: 'BEER', name: 'Cerveza de prueba', category: 'Cervezas', price: 5000, stock: 10 },
  { sku: 'GEL', name: 'Gel de limpieza sin alcohol', category: 'Aseo', price: 4000, stock: 10 },
];
let sequence = 0;
let providerPlan;
const calls = [];
const originalCall = tools.call.bind(tools);
tools.call = async (...args) => { calls.push(args); return originalCall(...args); };
runtime.planner = {
  plan: async () => structuredClone(providerPlan),
  composeReply: async ({ fallbackText }) => ({ text: fallbackText }),
};
const item = (sku) => ({ rawName: products.find(p => p.sku === sku).name, catalogQuery: products.find(p => p.sku === sku).name, skuHint: sku, quantity: 1 });
const conv = (id) => store.getState().conversations.find(c => c.id === id);
const reply = (id) => conv(id).messages.filter(m => m.role === 'agent').at(-1)?.text ?? '';
function setup(items, commercePolicy = {}) {
  const conversationId = `policy-${++sequence}`;
  store.mutate(state => {
    state.productsByTenant.andina = structuredClone(products);
    state.conversations.unshift({ id: conversationId, tenantId: 'andina', waId: `5731000000${sequence}`, messages: [], status: 'live' });
  });
  providerPlan = { intent: 'delivery_order', order: { delivery: true, items, paymentMethod: 'cash' }, missingFields: [], commercePolicy };
  calls.length = 0;
  return { tenantId: 'andina', conversationId, normalized: { text: items.map(i => i.rawName).join(' y '), waId: `5731000000${sequence}`, messageType: 'text' } };
}
const noSaleOrSalesHandoff = id => {
  assert.ok(!(store.getState().ordersByTenant.andina ?? []).some(o => o.conversationId === id));
  assert.ok(!store.getState().pendingRequests.some(r => r.conversationId === id), 'Restriction must not create a sales handoff');
};
try {
  assert.equal(assessCommerceItems({ items: [{ rawName: 'Producto por clasificar', commerceCategory: 'uncertain' }] }).blocked, true);
  let args = setup([item('BLOCKED')]);
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  assert.match(reply(args.conversationId), /políticas de WhatsApp/);
  assert.match(reply(args.conversationId), /por este canal/);
  assert.match(reply(args.conversationId), /contactar directamente con la tienda/);
  assert.doesNotMatch(reply(args.conversationId), /automáticamente|9\.000|cotiz|asesor.*venta/i);
  noSaleOrSalesHandoff(args.conversationId);

  args = setup([{ rawName: 'marca escrita con error', quantity: 1 }], {
    restrictedItems: [{ rawName: 'marca escrita con error', category: 'tobacco' }],
  });
  providerPlan.intent = 'human_handoff';
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  assert.match(reply(args.conversationId), /políticas de WhatsApp/);
  noSaleOrSalesHandoff(args.conversationId);

  args = setup([{ rawName: 'marca escrita con error', quantity: 1 }], {
    restrictedItems: [{ rawName: 'marca escrita con error', category: 'tobacco' }],
  });
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  assert.match(reply(args.conversationId), /políticas de WhatsApp/);
  assert.ok(!calls.some(c => c[0] === 'google_sheets_read_table'), 'Semantic restriction is applied before catalog lookup');
  noSaleOrSalesHandoff(args.conversationId);

  args = setup([{ rawName: 'alcohol', quantity: 1 }], { uncertainItems: [{ rawName: 'alcohol' }] });
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  assert.match(reply(args.conversationId), /aclarar|uso/i);
  assert.doesNotMatch(reply(args.conversationId), /políticas de WhatsApp/);
  noSaleOrSalesHandoff(args.conversationId);

  args = setup([item('SAFE'), { rawName: 'alcohol', quantity: 1 }], { uncertainItems: [{ rawName: 'alcohol' }] });
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  await runtime.handleOrderConfirmation({ ...args, plan: { intent: 'order_confirmation' }, customerProfile: { name: 'Prueba', defaultAddress: 'Prueba' } });
  assert.match(reply(args.conversationId), /aclarar|uso/i, 'A confirmation cannot silently drop an unresolved product');
  assert.ok(conv(args.conversationId).orderDraft.items.some(i => i.rawName === 'alcohol'));
  noSaleOrSalesHandoff(args.conversationId);
  await runtime.handleOrderClarification({ ...args, normalized: { ...args.normalized, text: 'Es gel de limpieza sin alcohol' },
    plan: { intent: 'order_clarification', order: { delivery: true, items: [item('SAFE'), item('GEL')], paymentMethod: 'cash' } },
    customerProfile: { name: 'Prueba', defaultAddress: 'Prueba' } });
  assert.equal(conv(args.conversationId).orderDraft.subtotal, 11200, 'An explicitly clarified non-beverage product can return to normal quoting');

  args = setup([item('SAFE'), item('BEER')]);
  providerPlan.customerDetails = { name: 'Cliente de prueba', deliveryAddress: 'Dirección de prueba 1' };
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  assert.match(reply(args.conversationId), /únicamente|demás productos/);
  assert.equal(conv(args.conversationId).commercePolicy.awaitingContinuation, true);
  assert.deepEqual(conv(args.conversationId).orderDraft.items.map(i => i.skuHint), ['SAFE']);
  assert.doesNotMatch(reply(args.conversationId), /5\.000|12\.200/);
  noSaleOrSalesHandoff(args.conversationId);
  const continuation = Object.values(store.getState().interactionOffersById).find(o => o.conversationId === args.conversationId && o.purpose === 'commerce_policy');
  assert.ok(continuation);
  const staleConfirmation = await runtime.createOrderConfirmationOffer(args);
  await runtime.handleInteractiveReply({ ...args, normalized: { ...args.normalized, text: 'Confirmar pedido', interactive: { optionId: staleConfirmation.offer.options[0].id } } });
  assert.match(reply(args.conversationId), /pedido cambió/);
  noSaleOrSalesHandoff(args.conversationId);
  await runtime.handleInteractiveReply({ ...args, normalized: { ...args.normalized, text: 'Continuar sin ellos', interactive: { optionId: continuation.options[0].id } } });
  assert.equal(conv(args.conversationId).commercePolicy.awaitingContinuation, false);
  assert.equal(conv(args.conversationId).orderDraft.subtotal, 7200);
  assert.ok(!conv(args.conversationId).orderDraft.items.some(i => i.product?.sku === 'BEER'));
  assert.deepEqual(conv(args.conversationId).orderDraft.missingFields, [], 'Mixed-order continuation must preserve explicitly supplied customer details');
  const freshConfirmation = Object.values(store.getState().interactionOffersById).find(o => o.conversationId === args.conversationId && o.purpose === 'order_confirmation' && o.id !== staleConfirmation.offer.id);
  assert.ok(freshConfirmation);
  await runtime.handleInteractiveReply({ ...args, normalized: { ...args.normalized, text: 'Confirmar pedido', interactive: { optionId: freshConfirmation.options[0].id } } });
  const allowedOrder = store.getState().ordersByTenant.andina.find(o => o.conversationId === args.conversationId);
  assert.equal(allowedOrder.subtotal, 7200);
  assert.deepEqual(allowedOrder.items.map(i => i.sku), ['SAFE']);

  args = setup([item('GEL')]);
  await runtime.routeConversation(args.tenantId, args.conversationId, args.normalized);
  assert.doesNotMatch(reply(args.conversationId), /políticas de WhatsApp/);
  assert.equal(conv(args.conversationId).orderDraft.subtotal, 4000, 'Non-beverage use must not be blocked by a substring');

  args = setup([item('BEER')]);
  store.mutate(() => {
    conv(args.conversationId).orderDraft = { delivery: true, paymentMethod: 'cash', missingFields: [], subtotal: 5000,
      items: [{ ...item('BEER'), product: products[2], lineTotal: 5000, available: true }] };
  });
  await runtime.handleOrderConfirmation({ ...args, plan: providerPlan, customerProfile: { name: 'Test', defaultAddress: 'Test' } });
  assert.match(reply(args.conversationId), /políticas de WhatsApp/);
  noSaleOrSalesHandoff(args.conversationId);

  await assert.rejects(tools.googleSheetsOrderWrite('andina', args.conversationId, {
    items: [{ sku: 'BLOCKED', name: 'Nombre oculto', quantity: 1 }], subtotal: 9000,
  }), error => error.code === 'whatsapp_commerce_restricted');
  noSaleOrSalesHandoff(args.conversationId);

  const catalog = await tools.googleSheetsReadTable('andina', { filters: {} });
  assert.ok(!catalog.rows.some(p => ['BLOCKED', 'BEER'].includes(p.sku)), 'Restricted catalog rows cannot be quoted as alternatives');
  assert.equal(catalog.restrictedItems.length, 2);
  assert.ok(catalog.rows.some(p => p.sku === 'GEL'));

  args = setup([]);
  providerPlan.intent = 'catalog_query';
  providerPlan.toolPlan = [{ tool: 'google_sheets_read_table', filters: { sku: 'BEER' } }];
  await runtime.handleCatalogQuery({ ...args, normalized: { ...args.normalized, text: 'Producto por código' }, plan: providerPlan });
  assert.match(reply(args.conversationId), /políticas de WhatsApp/);
  noSaleOrSalesHandoff(args.conversationId);

  store.mutate(state => { state.productsByTenant['other-tenant'] = [{ sku: 'BLOCKED', name: 'Galletas', category: 'Alimentos', price: 2000 }]; });
  assert.deepEqual(assessCommerceItems({ items: [{ sku: 'BLOCKED' }], products: store.getState().productsByTenant['other-tenant'] }).restrictedItems, []);
  const otherCatalog = await tools.googleSheetsReadTable('other-tenant', { filters: { sku: 'BLOCKED' } });
  assert.equal(otherCatalog.rows[0].name, 'Galletas', 'Catalog restriction must use this tenant’s product, not another tenant’s matching SKU');
  console.log('WhatsApp channel policy: restricted request, semantic decision, ambiguity, mixed order, safe continuation, non-beverage context, legacy confirmation and write guard passed.');
} finally {
  runtime.stop(); integrationOutbox.stop(); await store.close?.();
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('via-channel-policy-')) fs.rmSync(dir, { recursive: true, force: true });
}
