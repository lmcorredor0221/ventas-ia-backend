import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { ManualOrderService } from '../services/manualOrderService.js';
import { OrderService } from '../services/orderService.js';
import { UsageService } from '../services/usageService.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-manual-workspace-'));
try {
  const store = new JsonStore(path.join(dir, 'state.json'));
  store.state = {
    tenants: [{ id: 'shop', config: { orderPolicy: { deliveryFee: 2000, deliveryMinimumSubtotal: 10000 } } }],
    conversations: [{
      id: 'conversation-1', tenantId: 'shop', waId: 'buyer-1', status: 'manual_active',
      manualMode: 'whatsapp_external', aiPaused: true, messages: [
        { id: 'm1', role: 'customer', text: 'Una leche y pan, por favor.', createdAt: '2026-11-06T12:00:00.000Z' },
        { id: 'm2', role: 'assistant', text: 'Estoy revisando el pedido.', createdAt: '2026-11-06T12:00:01.000Z' },
      ],
    }],
    ordersByTenant: {}, pendingRequests: [], integrationOutbox: [],
    usageCountersByTenant: {}, subscriptionsByTenant: {}, billingUsageCyclesByTenant: {},
  };
  const events = { emit() {} };
  const usage = new UsageService({ store, events });
  const catalog = [
    { sku: 'milk', name: 'Leche', presentation: '1 L', description: '', price: 4800, stock: 10 },
    { sku: 'bread', name: 'Pan', presentation: '', description: '', price: 5200, stock: 10 },
  ];
  const tools = {
    googleSheetsReadTable: async () => ({ status: 'success', rows: catalog }),
    call: async () => ({ status: 'accepted' }),
  };
  const outbox = {
    enabled: true,
    createEntry: data => ({ ...data, id: data.idempotencyKey, status: 'pending', createdAt: new Date().toISOString() }),
  };
  const manualOrders = new ManualOrderService({ store, tools, usage, events, outbox });
  const context = await manualOrders.context('shop', 'conversation-1');
  assert.equal(context.conversation.messages.length, 2, 'manual context must expose the conversation for the human tab');
  assert.deepEqual(context.deliveryPolicy, { deliveryFee: 2000, deliveryMinimumSubtotal: 10000 });

  const result = await manualOrders.confirm('shop', 'conversation-1', {
    customerName: 'Cliente', deliveryAddress: 'Calle 1', paymentMethod: 'cash', customerConfirmed: true,
    items: [{ sku: 'milk', quantity: 1, unitPrice: 4800 }, { sku: 'bread', quantity: 1, unitPrice: 5200 }],
  }, 'owner');
  assert.equal(result.order.pricing.total, 12000);
  assert.equal(result.notification, 'queued');
  assert.equal(store.state.integrationOutbox.some(entry => entry.kind === 'order.summary_notification'), true,
    'manual confirmation must enqueue a WhatsApp summary');

  const orders = new OrderService({ store, tools, events, outbox });
  const workspace = await orders.workspace({ orderId: result.order.id, tenantId: 'shop', includeCatalog: false });
  assert.equal(workspace.conversation.messages.length, 2);
  assert.equal(workspace.summaryNotification.status, 'pending');
  assert.equal(workspace.order.pricing.total, 12000);

  const edited = await orders.edit({ orderId: result.order.id, tenantId: 'shop', input: {
    expectedVersion: 0, customerName: 'Cliente actualizado', deliveryAddress: 'Calle 2',
    paymentMethod: 'cash', delivery: true, deliveryFee: 2000, expectedTotal: 12000,
    customerConfirmed: true, reason: 'Dirección confirmada por el cliente',
    items: [{ sku: 'milk', quantity: 1, unitPrice: 4800 }, { sku: 'bread', quantity: 1, unitPrice: 5200 }],
  }, actorId: 'owner' });
  assert.equal(edited.order.version, 1);
  assert.equal(store.state.conversations[0].orderDraft.items.length, 2, 'editing must refresh the conversational draft');
  assert.equal(store.state.conversations[0].value, 12000, 'conversation value must include delivery pricing');
  assert.equal(store.state.integrationOutbox.some(entry => entry.kind === 'order.summary_notification' && entry.payload.version === 1), true,
    'editing must enqueue a versioned WhatsApp summary');
  await assert.rejects(() => orders.edit({ orderId: result.order.id, tenantId: 'shop', input: {
    expectedVersion: 0, customerName: 'Cliente', deliveryAddress: 'Calle 3', paymentMethod: 'cash',
    delivery: true, deliveryFee: 2000, expectedTotal: 12000, customerConfirmed: true,
    items: [{ sku: 'milk', quantity: 1, unitPrice: 4800 }],
  } }), error => error.code === 'order_version_conflict');
  console.log('Manual order workspace contract: conversation, delivery pricing, summary outbox and workspace passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
