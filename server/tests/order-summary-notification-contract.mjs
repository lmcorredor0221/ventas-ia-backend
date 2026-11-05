import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { evaluateDeliveryPolicy } from '../domain/deliveryPolicy.js';
import { catalog, seedOrderEdit, editInput } from './fixtures/order-edit.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-summary-notification-'));
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('No external providers permitted'); };
const kit = await createAppAsync({ dataFile: path.join(dir, 'state.json'), storageDriver: 'json',
  integrationOutboxEnabled: true, backgroundWorkersEnabled: false, whatsappMode: 'mock' });
const { store, orders, tools, integrationOutbox } = kit;
tools.googleSheetsReadTable = async () => ({ status: 'success', rows: catalog });
tools.syncLiveOrderStatus = async () => ({ status: 'synced' });
const edit = patch => orders.edit({ tenantId: 'andina', orderId: 'ord-edit-local', actorId: 'test-owner', input: editInput(patch) });
const entries = () => store.state.integrationOutbox.filter(e => e.kind === 'order.summary_notification');
const notify = integrationOutbox.handlers['order.summary_notification'];
const messages = () => store.state.conversations[0].messages.filter(m => m.deliveryKey);
const workspace = () => orders.workspace({ tenantId: 'andina', orderId: 'ord-edit-local', includeCatalog: false });
let checks = 0;
try {
  seedOrderEdit(store);
  const saved = await edit();
  assert.equal(saved.notification, 'queued');
  assert.equal(messages().length, 0, 'Saving does not wait for Meta');
  assert.equal((await workspace()).summaryNotification.status, 'pending');
  await integrationOutbox.drain();
  assert.equal(messages().length, 1);
  const receipt = messages()[0];
  assert.equal(receipt.role, 'human');
  assert.match(receipt.text, /\*Pedido actualizado\*/);
  assert.match(receipt.text, /\*Total: \$ 22\.200\*/);
  assert.doesNotMatch(receipt.text, /¿Confirmamos|Confirmar pedido|pago recibido/i);
  assert.equal((await workspace()).summaryNotification.status, 'accepted');
  assert.equal(orders.findOrder('ord-edit-local').status, 'preparing');
  assert.equal(store.state.conversations[0].manualWhatsApp.active, true);
  await notify(entries()[0]);
  assert.equal(messages().length, 1, 'Retry after persisted acceptance does not duplicate a receipt'); checks++;

  seedOrderEdit(store);
  await edit(); await edit({ expectedVersion: 2, customerName: 'Última revisión' });
  await integrationOutbox.drain();
  assert.equal(entries()[0].result.status, 'superseded');
  assert.equal(messages().length, 1);
  assert.match(messages()[0].text, /Última revisión/); checks++;

  for (const mutate of [
    () => { store.state.conversations[0].tenantId = 'norte'; },
    () => { store.state.conversations[0].waId = '573000009999'; },
    () => { store.state.conversations[0].orderId = 'otro-pedido'; },
  ]) {
    seedOrderEdit(store); await edit(); mutate();
    await integrationOutbox.drain();
    assert.equal(messages().length, 0);
    assert.equal(entries()[0].result.status, 'recipient_unavailable'); checks++;
  }

  seedOrderEdit(store); await edit();
  store.state.conversations[0].messages.forEach(m => { m.createdAt = new Date(Date.now() - 25 * 3600000).toISOString(); });
  await integrationOutbox.drain();
  assert.equal(messages().length, 0);
  assert.equal((await workspace()).summaryNotification.status, 'window_closed');
  assert.equal(orders.findOrder('ord-edit-local').pricing.total, 22200); checks++;

  seedOrderEdit(store); await edit();
  orders.findOrder('ord-edit-local').status = 'dispatched';
  await integrationOutbox.drain();
  assert.equal(entries()[0].result.status, 'superseded'); assert.equal(messages().length, 0); checks++;

  seedOrderEdit(store); await edit();
  const realMessaging = tools.whatsappBusinessMessaging.bind(tools);
  tools.whatsappBusinessMessaging = async () => { throw new Error('Simulated provider outage'); };
  await integrationOutbox.drain();
  assert.equal(entries()[0].status, 'retrying');
  assert.equal(orders.findOrder('ord-edit-local').pricing.total, 22200);
  tools.whatsappBusinessMessaging = realMessaging;
  entries()[0].nextAttemptAt = new Date(0).toISOString();
  await integrationOutbox.drain();
  assert.equal(messages().length, 1); assert.equal(entries()[0].result.status, 'accepted'); checks++;

  seedOrderEdit(store); await edit();
  const long = orders.findOrder('ord-edit-local');
  long.items = Array.from({ length: 100 }, (_, i) => ({ sku: `sku-${i}`, name: `Producto de prueba ${i}`,
    presentation: '500 g', unitPrice: 1000, quantity: 2, lineTotal: 2000 }));
  long.subtotal = 200000;
  long.pricing = evaluateDeliveryPolicy({ tenant: store.state.tenants.find(t => t.id === 'andina'), items: long.items, draftVersion: 2 });
  let calls = 0;
  tools.whatsappBusinessMessaging = async (...args) => {
    if (++calls === 2) throw new Error('Second part unavailable');
    return realMessaging(...args);
  };
  await integrationOutbox.drain();
  assert.equal(messages().length, 1); assert.equal(entries()[0].status, 'retrying');
  tools.whatsappBusinessMessaging = realMessaging;
  entries()[0].nextAttemptAt = new Date(0).toISOString();
  await integrationOutbox.drain();
  assert.equal(entries()[0].result.status, 'accepted');
  const full = messages().map(m => m.text).join('');
  assert.equal(full.match(/• Producto de prueba /g).length, 100);
  assert.ok(messages().every(m => m.text.length <= 4096));
  assert.equal(new Set(messages().map(m => m.deliveryKey)).size, messages().length); checks++;

  seedOrderEdit(store); integrationOutbox.enabled = false;
  assert.equal((await edit()).notification, 'not_queued'); assert.equal(entries().length, 0); checks++;
  console.log(`PASS order summary notifications: ${checks} scenarios (durable queue, current revision, tenant/recipient isolation, service window, partial retries and unchanged order stage).`);
} finally {
  globalThis.fetch = originalFetch;
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
  await fs.rm(dir, { recursive: true, force: true });
}
