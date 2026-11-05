import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';
import { evaluateDeliveryPolicy } from '../domain/deliveryPolicy.js';
import { quoteBreakdownWasCommunicated } from '../services/llmReplyComposer.js';
import { catalog } from './fixtures/order-edit.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-confirmation-offer-'));
const { runtime, store } = createApp({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
});
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('No external calls permitted'); };
try {
  const tenant = store.state.tenants.find(t => t.id === 'andina');
  Object.assign(tenant.config.orderPolicy, { deliveryFee: 3000, deliveryMinimumSubtotal: 0 });
  const items = catalog.slice(0, 2).map(product => ({ product, quantity: 1, lineTotal: product.price }));
  const draft = { version: 1, items, subtotal: 10000, customerName: 'Cliente prueba', deliveryAddress: 'Calle Prueba 1',
    paymentMethod: 'bre_b', missingFields: [], delivery: true,
    pricing: evaluateDeliveryPolicy({ tenant, items, draftVersion: 1 }) };
  const chat = { id: 'wa-confirmation-contract', tenantId: tenant.id, waId: '573000000001', messages: [], orderDraft: draft };
  store.mutate(state => state.conversations.push(chat));
  const args = { tenantId: tenant.id, conversationId: chat.id, draftVersion: 1, body: 'Subtotal: $ 0' };
  const confirmation = await runtime.createConfirmationOffer(args);
  assert.equal(confirmation.interactive.kind, 'button');
  assert.equal(confirmation.text, confirmation.interactive.body);
  assert.ok(confirmation.text.indexOf('*Nombre:*') < confirmation.text.indexOf('*Productos*'));
  assert.match(confirmation.text, /1 × \$ 7\.200 = \*\$ 7\.200\*/);
  assert.match(confirmation.text, /1 × \$ 2\.800 = \*\$ 2\.800\*/);
  assert.equal(quoteBreakdownWasCommunicated(confirmation.text, draft.pricing), true);
  assert.deepEqual(confirmation.offer.options.map(({ title, action }) => ({ title, action })), [
    { title: 'Confirmar pedido', action: 'confirm_order' },
    { title: 'Ajustar pedido', action: 'adjust_order' },
    { title: 'Hablar con la tienda', action: 'human_handoff' },
  ]);
  const payload = { action: 'send_session_message', wa_id: chat.waId, text: confirmation.text, interactive: confirmation.interactive };
  await runtime.sendCustomerMessage({ ...args, normalized: { waId: chat.waId }, payload });
  assert.equal(store.state.conversations.at(-1).messages.at(-1).text, confirmation.text);
  assert.equal(await runtime.createConfirmationOffer({ ...args, tenantId: 'norte' }), null);
  assert.equal(await runtime.createConfirmationOffer({ ...args, draftVersion: 0 }), null);
  draft.items.push({ rawName: 'Pan sin resolver', quantity: 1 });
  assert.equal(await runtime.createConfirmationOffer(args), null);
  draft.items.pop(); draft.customerName = '';
  assert.equal(await runtime.createConfirmationOffer(args), null);
  draft.customerName = 'Cliente prueba'; draft.pricing.total = 0;
  assert.equal(await runtime.createConfirmationOffer(args), null);
  draft.pricing.total = 13000;
  const large = Array.from({ length: 100 }, (_, i) => `• Producto ${i} (500 g)\n  2 × $ 5.000 = *$ 10.000*`).join('\n\n');
  const before = chat.messages.length;
  await runtime.sendCustomerMessage({ ...args, normalized: { waId: chat.waId }, payload: {
    ...payload, text: large, interactive: { ...confirmation.interactive, body: large },
  } });
  const sent = chat.messages.slice(before);
  assert.equal(sent.slice(0, -1).map(m => m.text).join(''), large);
  assert.ok(sent.every(m => m.text.length <= 4096));
  assert.match(sent.at(-1).text, /Puedes responder con estas opciones/);
  console.log('PASS confirmation offers: formatted quote, persisted text, three buttons, tenant/version guards, incomplete data and long orders.');
} finally {
  globalThis.fetch = originalFetch;
  assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
