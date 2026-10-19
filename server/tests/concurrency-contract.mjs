import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { OrderService } from '../services/orderService.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-concurrency-'));
const store = new JsonStore(path.join(tempDir, 'store.json'));
store.load();
const state = store.getState();
state.ordersByTenant = {
  andina: [{
    id: 'ord-concurrency',
    tenantId: 'andina',
    conversationId: 'conv-andina-1',
    status: 'pending_human_preparation',
    statusHistory: [],
  }],
};
const tools = {
  async syncLiveOrderStatus() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { provider: 'google_sheets', status: 'synced' };
  },
};
const service = new OrderService({ store, tools, events: { emit: () => ({ id: 'event' }) } });
const results = await Promise.allSettled([
  service.transition({ orderId: 'ord-concurrency', tenantId: 'andina', nextStatus: 'preparing' }),
  service.transition({ orderId: 'ord-concurrency', tenantId: 'andina', nextStatus: 'preparing' }),
]);
assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(results.filter((result) => result.reason?.code === 'order_transition_conflict').length, 1);
assert.equal(state.ordersByTenant.andina[0].version, 1);
console.log('Concurrency contract tests passed');
await fs.rm(tempDir, { recursive: true, force: true });
