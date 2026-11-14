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

  store.state.ordersByTenant.shop.push({
    ...structuredClone(store.state.ordersByTenant.shop[0]),
    id: 'ord-2',
    version: 2,
    customerReconfirmation: {
      status: 'required',
      reason: 'manual_order_edit',
      previousTotal: 4800,
      total: 5200,
      difference: 400,
    },
    customerChangeSummary: {
      hasChanges: true,
      reason: 'El cliente solicitó agregar un producto.',
      previousTotal: 4800,
      total: 5200,
      difference: 400,
      itemChanges: [{ type: 'added', name: 'Pan', quantity: 1, after: { lineTotal: 400 } }],
    },
    pricing: { subtotal: 5200, deliveryFee: 0, total: 5200 },
  });
  const updateResult = await handler({ payload: { tenantId: 'shop', orderId: 'ord-2', conversationId: 'c1', version: 2, stage: 'updated' } });
  assert.equal(updateResult.status, 'sent');
  assert.equal(payload.interactive?.kind, 'list');
  assert.deepEqual(payload.interactive?.rows?.map(row => row.title), [
    'Confirmar pedido', 'Ajustar pedido', 'Hablar con la tienda', 'Cancelar pedido',
  ]);
  const updateOffer = Object.values(store.state.interactionOffersById ?? {}).find((item) => item.purpose === 'order_change_confirmation' && item.conversationId === 'c1');
  assert.deepEqual(updateOffer.options.map(option => option.action), [
    'confirm_order_change', 'adjust_order', 'human_handoff', 'cancel_order',
  ]);
  console.log('Order summary notification: WhatsApp payload, idempotent version and persistence passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
