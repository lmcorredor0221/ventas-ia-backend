import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { OrderService } from '../services/orderService.js';
import { DEFAULT_PAYMENT_METHODS, normalizePaymentMethods, resolvePaymentMethod } from '../services/paymentMethods.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-tenant-checkout-'));
const store = new JsonStore(path.join(tempDir, 'store.json'));
store.load();

try {
  const paymentMethods = normalizePaymentMethods([
    ...DEFAULT_PAYMENT_METHODS,
    { id: 'transferencia_local', label: 'Transferencia local', aliases: ['transfer local'] },
  ]);
  assert.deepEqual(paymentMethods.slice(0, 3).map((method) => method.id), ['cash', 'card_terminal', 'breb']);
  assert.equal(resolvePaymentMethod('Pago por Bre-B', paymentMethods)?.id, 'breb');
  assert.equal(resolvePaymentMethod('Prefiero transferencia local', paymentMethods)?.id, 'transferencia_local');

  const now = new Date().toISOString();
  store.mutate((state) => {
    state.conversations.unshift({
      id: 'conv-dispatch-notice',
      tenantId: 'andina',
      waId: '573219450893',
      customer: 'Cliente de prueba',
      status: 'live',
      caseStatus: 'active',
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
    state.ordersByTenant.andina ??= [];
    state.ordersByTenant.andina.unshift({
      id: 'ord-dispatch-notice',
      tenantId: 'andina',
      conversationId: 'conv-dispatch-notice',
      waId: '573219450893',
      customerName: 'Cliente de prueba',
      status: 'preparing',
      statusHistory: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  const sentMessages = [];
  const service = new OrderService({
    store,
    events: { emit: () => ({ id: 'evt-dispatch' }) },
    tools: {
      async syncLiveOrderStatus() {
        return { provider: 'google_sheets', status: 'synced' };
      },
      async call(name, tenantId, conversationId, payload) {
        sentMessages.push({ name, tenantId, conversationId, payload });
        return { accepted: true };
      },
    },
  });

  const result = await service.transition({
    orderId: 'ord-dispatch-notice',
    tenantId: 'andina',
    nextStatus: 'dispatched',
    actorId: 'owner-test',
  });

  assert.equal(result.status, 'dispatched');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].name, 'whatsapp_business_messaging');
  assert.match(sentMessages[0].payload.text, /va en camino/i);
  const conversation = store.getState().conversations.find((item) => item.id === 'conv-dispatch-notice');
  assert.equal(conversation.status, 'closed_dispatched');
  assert.equal(conversation.caseStatus, 'completed');

  console.log('Tenant checkout flow contract tests passed');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
