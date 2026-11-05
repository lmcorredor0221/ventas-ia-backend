import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { catalog } from './fixtures/order-edit.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'via-manual-order-'));
const kit = await createAppAsync({
  dataFile: path.join(directory, 'store.json'),
  storageDriver: 'json',
  authRequired: true,
  csrfRequired: true,
  allowDevGoogleLogin: true,
  allowLocalCatalogFallback: true,
  integrationOutboxEnabled: true,
  backgroundWorkersEnabled: false,
  whatsappMode: 'mock',
});
const { app, store, tools } = kit;
tools.googleSheetsReadTable = async (tenantId) => {
  assert.equal(tenantId, 'andina');
  return { status: 'success', rows: structuredClone(catalog) };
};

const conversation = {
  id: 'manual-order-contract-chat',
  tenantId: 'andina',
  waId: '573000000099',
  customer: 'Cliente demo',
  status: 'blocked',
  zone: 'approval',
  stage: 'handoff',
  orderId: null,
  orderDraft: { items: [{ skuHint: 'COLA', quantity: 1 }], customerName: 'Cliente demo' },
  messages: [
    { id: 'manual-message-1', role: 'customer', label: 'Cliente', text: 'Quiero una gaseosa y un chocorramo.', createdAt: new Date().toISOString() },
    { id: 'manual-message-2', role: 'assistant', label: 'Asistente', text: 'Te paso con la tienda para confirmar disponibilidad.', createdAt: new Date().toISOString() },
  ],
};
store.mutate((state) => {
  state.conversations = (state.conversations ?? []).filter((item) => item.id !== conversation.id);
  state.conversations.push(conversation);
});

let server;
try {
  server = app.listen(0, '127.0.0.1');
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const request = async (route, { body, method = 'GET', cookie, csrf, status = 200 } = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    return { json, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };

  const login = await request('/api/auth/google', { method: 'POST', body: {
    idToken: 'dev-google-id-token',
    profile: { sub: 'manual-order-owner', email: 'andina@example.local', name: 'Owner' },
  } });
  const access = { cookie: login.cookie, csrf: login.json.session.csrfToken };

  const context = await request(`/api/conversations/${conversation.id}/manual-order`, access);
  assert.equal(context.json.conversation.messages.length, 2);
  assert.equal(context.json.draft.items[0].sku, 'COLA');
  assert.ok(context.json.products.some((product) => product.sku === 'CHOCO'));

  const created = await request(`/api/conversations/${conversation.id}/manual-order`, {
    ...access,
    method: 'POST',
    body: {
      customerName: 'Cliente demo',
      deliveryAddress: 'Calle 10 # 5-20',
      paymentMethod: 'bre_b',
      delivery: true,
      customerConfirmed: true,
      items: [
        { sku: 'COLA', quantity: 1, unitPrice: 7200 },
        { sku: 'CHOCO', quantity: 1, unitPrice: 2800 },
      ],
    },
    status: 201,
  });
  assert.equal(created.json.order.status, 'pending_human_preparation');
  assert.equal(created.json.order.subtotal, 10000);
  assert.equal(created.json.order.pricing.total, 10000);
  assert.equal(created.json.order.manualSource, 'human_handoff');
  assert.equal(store.getState().conversations.find((item) => item.id === conversation.id).orderId, created.json.order.id);
  assert.ok(store.getState().integrationOutbox.some((entry) => entry.kind === 'order.sheet_create'));

  const duplicate = await request(`/api/conversations/${conversation.id}/manual-order`, {
    ...access,
    method: 'POST',
    body: { customerConfirmed: true, customerName: 'Cliente demo', deliveryAddress: 'Calle 10', paymentMethod: 'bre_b', items: [{ sku: 'COLA', quantity: 1, unitPrice: 7200 }] },
    status: 409,
  });
  assert.equal(duplicate.json.code, 'manual_order_already_exists');
  console.log('manual-order-contract: ok');
} finally {
  await new Promise((resolve) => server ? server.close(resolve) : resolve());
  await fs.rm(directory, { recursive: true, force: true });
}
