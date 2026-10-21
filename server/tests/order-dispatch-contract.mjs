import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-order-dispatch-'));
const { store, orders, integrationOutbox } = createApp({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  integrationOutboxEnabled: true,
  backgroundWorkersEnabled: false,
  whatsappMode: 'mock',
});

const tenantId = 'andina';
const conversationId = 'wa-dispatch-contract';
const orderId = 'ord-dispatch-contract';
store.mutate((state) => {
  state.conversations.unshift({
    id: conversationId,
    tenantId,
    waId: '573009998877',
    status: 'live',
    caseStatus: 'live',
    stage: 'handoff',
    zone: 'approval',
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  state.ordersByTenant ??= {};
  state.ordersByTenant[tenantId] ??= [];
  state.ordersByTenant[tenantId].unshift({
    id: orderId,
    tenantId,
    conversationId,
    waId: '573009998877',
    customerName: 'Cliente de prueba',
    status: 'preparing',
    items: [{ name: 'Chocoramo', quantity: 1, unitPrice: 2800 }],
    subtotal: 2800,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

const transition = await orders.transition({
  tenantId,
  orderId,
  nextStatus: 'dispatched',
  actorId: 'test-tendero',
  source: 'test',
});
assert.equal(transition.status, 'dispatched');
assert.equal(store.getState().conversations.find((item) => item.id === conversationId)?.caseStatus, 'completed');
assert.ok(store.getState().integrationOutbox.some((entry) => entry.kind === 'order.dispatch_notification' && entry.aggregateId === orderId));

const drained = await integrationOutbox.drain();
assert.ok(drained.processed >= 1);
const order = orders.findOrder(orderId, tenantId);
assert.ok(order.dispatchNotification?.sentAt);

console.log('Order dispatch contract checks passed');
