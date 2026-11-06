import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { ManualOrderService } from '../services/manualOrderService.js';
import { UsageService } from '../services/usageService.js';
import { OrderService } from '../services/orderService.js';
import { AgentRuntime } from '../services/agentRuntime.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-manual-order-'));
try {
  const store = new JsonStore(path.join(dir, 'state.json'));
  store.state = { tenants: [{ id: 'shop' }, { id: 'other' }], conversations: [], ordersByTenant: {}, pendingRequests: [] };
  const events = { emit() {} };
  const usage = new UsageService({ store, events });
  const catalog = [
    { sku: 'milk', name: 'Leche Colanta', presentation: 'Bolsa 1 L', description: 'Entera', price: 4800, stock: 10 },
    { sku: 'bread', name: 'Pan tajado', price: 5200, stock: 5 },
    { sku: 'empty', name: 'Queso', price: 7000, stock: 0 },
    { sku: 'restricted', name: 'Cigarrillos', category: 'tabaco', price: 9000, stock: 5 },
  ];
  let sends = 0;
  const tools = { googleSheetsReadTable: async tenant => {
    assert.equal(tenant, 'shop'); return { status: 'success', rows: catalog };
  }, call: async () => { sends++; } };
  const outbox = { createEntry: data => ({ ...data, id: data.idempotencyKey, createdAt: new Date().toISOString(), nextAttemptAt: new Date().toISOString() }) };
  const service = new ManualOrderService({ store, tools, usage, events, outbox });
  const addConversation = id => store.state.conversations.push({ id, tenantId: 'shop', waId: 'CO.test-buyer', status: 'manual_active', manualMode: 'whatsapp_external', aiPaused: true, manualLastActivityAt: '2020-01-01T00:00:00Z', messages: [] });
  const input = { customerName: 'Cliente de prueba', deliveryAddress: 'Calle de prueba 123', paymentMethod: 'cash', customerConfirmed: true,
    items: [{ sku: 'milk', quantity: 1, unitPrice: 4800 }, { sku: 'bread', quantity: 1, unitPrice: 5200 }], subtotal: 1 };
  addConversation('manual');
  store.state.pendingRequests.push({ id: 'handoff', tenantId: 'shop', conversationId: 'manual', status: 'pending' });
  const context = await service.context('shop', 'manual');
  assert.equal(context.products.some(p => p.sku === 'restricted'), false);
  assert.equal(context.products[0].presentation, 'Bolsa 1 L');
  await assert.rejects(service.confirm('other', 'manual', input, 'owner'), { statusCode: 404 });
  await assert.rejects(service.confirm('shop', 'manual', { ...input, customerConfirmed: false }, 'owner'), { statusCode: 422 });
  await assert.rejects(service.confirm('shop', 'manual', { ...input, items: [{ sku: 'milk', quantity: 1, unitPrice: 1 }] }, 'owner'), { code: 'manual_order_price_changed' });
  await assert.rejects(service.confirm('shop', 'manual', { ...input, items: [{ sku: 'empty', quantity: 1, unitPrice: 7000 }] }, 'owner'), { statusCode: 422 });
  await assert.rejects(service.confirm('shop', 'manual', { ...input, items: [{ sku: 'restricted', quantity: 1, unitPrice: 9000 }] }, 'owner'), { statusCode: 422 });
  const results = await Promise.all([service.confirm('shop', 'manual', input, 'owner'), service.confirm('shop', 'manual', input, 'owner')]);
  assert.equal(results[0].order.id, results[1].order.id);
  assert.equal(results[0].order.subtotal, 10000);
  assert.equal(results[0].order.status, 'preparing');
  assert.equal(results[0].order.items[0].name, 'Leche Colanta');
  assert.equal(store.state.ordersByTenant.shop.length, 1);
  assert.equal((await usage.summary('shop')).metrics.deliveries_confirmed, 1);
  assert.equal(store.state.pendingRequests[0].status, 'resolved');
  assert.equal(store.state.integrationOutbox.length, 2);
  assert.equal(store.state.integrationOutbox.some(entry => entry.kind === 'order.summary_notification'), true);
  assert.equal(store.state.conversations[0].aiPaused, true);
  assert.equal(sends, 0, 'Saving an agreed manual order must not send a WhatsApp message');
  const runtime = Object.create(AgentRuntime.prototype);
  Object.assign(runtime, { store, events, config: { manualConversationInactivityMinutes: 5 } });
  await runtime.closeExpiredManualCases();
  assert.equal(store.state.conversations[0].status, 'manual_active');
  const orders = new OrderService({ store, tools, events, outbox });
  await orders.transition({ tenantId: 'shop', orderId: results[0].order.id, nextStatus: 'dispatched', actorId: 'owner' });
  assert.equal(sends, 1);
  assert.equal(store.state.conversations[0].status, 'closed_dispatched');
  const retried = await service.confirm('shop', 'manual', input, 'owner');
  assert.equal(retried.order.status, 'dispatched', 'A retry must never reopen the dispatched order');
  addConversation('new-case');
  const next = await service.confirm('shop', 'new-case', input, 'owner');
  assert.notEqual(next.order.id, results[0].order.id);
  assert.equal((await usage.summary('shop')).metrics.deliveries_confirmed, 2);
  console.log('Manual order: validation, tenant isolation, subtotal, idempotency, quota, outbox, inactivity and dispatch passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
