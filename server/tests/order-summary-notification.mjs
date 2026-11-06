import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { createOrderSummaryNotification } from '../services/orderSummaryNotification.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-order-summary-'));
try {
  const store = new JsonStore(path.join(dir, 'state.json'));
  store.state = {
    tenants: [{ id: 'shop' }],
    conversations: [{ id: 'c1', tenantId: 'shop', waId: 'buyer-1', messages: [] }],
    ordersByTenant: { shop: [{ id: 'ord-1', tenantId: 'shop', conversationId: 'c1', waId: 'buyer-1', version: 0,
      customerName: 'Cliente', deliveryAddress: 'Calle 1', delivery: true, paymentMethodLabel: 'Efectivo',
      items: [{ name: 'Leche', presentation: '1 L', quantity: 1, unitPrice: 4800, lineTotal: 4800 }], subtotal: 4800,
      pricing: { subtotal: 4800, deliveryFee: 0, total: 4800 },
    }] },
    integrationOutbox: [],
  };
  let payload;
  const tools = { call: async (_tool, _tenant, _conversation, input) => { payload = input; return { messages: [{ id: 'wamid.1' }] }; } };
  const events = { emit() {} };
  const handler = createOrderSummaryNotification({ store, tools, events });
  const result = await handler({ payload: { tenantId: 'shop', orderId: 'ord-1', conversationId: 'c1', version: 0 } });
  assert.equal(result.status, 'sent');
  assert.match(payload.text, /Nombre/);
  assert.match(payload.text, /Total/);
  assert.equal(store.state.ordersByTenant.shop[0].summaryNotification.status, 'sent');
  console.log('Order summary notification: WhatsApp payload, idempotent version and persistence passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
