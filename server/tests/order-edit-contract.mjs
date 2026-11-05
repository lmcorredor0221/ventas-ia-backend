import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createAppAsync } from '../index.js';
import { PostgresStore } from '../store/postgresStore.js';
import { OrderService } from '../services/orderService.js';
import { IntegrationOutbox } from '../services/integrationOutbox.js';
import { orderDraftBlockingFields } from '../domain/groundingContracts.js';
import { catalog, seedOrderEdit, editInput } from './fixtures/order-edit.mjs';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'via-order-edit-'));
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, options) => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'No external providers permitted');
  return originalFetch(url, options);
};
let checks = 0;
const kit = await createAppAsync({ dataFile: path.join(directory, 'store.json'), storageDriver: 'json',
  authRequired: true, csrfRequired: true, allowDevGoogleLogin: true,
  integrationOutboxEnabled: true, backgroundWorkersEnabled: false, whatsappMode: 'mock' });
const { store, orders, tools, integrationOutbox, app } = kit;
const products = async tenantId => { assert.equal(tenantId, 'andina'); return { status: 'success', rows: structuredClone(catalog) }; };
tools.googleSheetsReadTable = products;
const edit = input => orders.edit({ tenantId: 'andina', orderId: 'ord-edit-local', actorId: 'fixture-owner', input });
let server;
try {
  seedOrderEdit(store, { pending: true });
  store.state.conversations[0].orderDraft.items[0].rawItemId = 'original-cola';
  store.state.conversations[0].orderDraft.version = 8;
  const beforeMessages = structuredClone(store.state.conversations[0].messages);
  const result = await edit(editInput());
  assert.equal(result.order.status, 'pending_human_preparation');
  assert.equal(result.order.subtotal, 19200);
  assert.equal(result.order.pricing.total, 22200);
  assert.equal(result.order.paymentMethod, 'bre_b');
  assert.equal(result.order.version, 2);
  assert.equal(result.order.editHistory[0].before.pricing.total, 13000);
  assert.equal(result.order.editHistory[0].after.pricing.total, 22200);
  assert.equal(result.notification, 'not_sent');
  assert.equal(store.state.integrationOutbox.length, 1);
  assert.equal(store.state.integrationOutbox[0].kind, 'order.sheet_edit');
  assert.deepEqual(store.state.conversations[0].messages, beforeMessages);
  assert.equal(store.state.conversations[0].manualWhatsApp.active, true);
  assert.equal(store.state.conversations[0].orderDraft.pricing.total, 22200);
  assert.equal(store.state.conversations[0].orderDraft.version, 9);
  assert.equal(store.state.conversations[0].orderDraft.pricing.draftVersion, 9);
  assert.equal(store.state.conversations[0].orderDraft.items[0].rawItemId, 'original-cola');
  assert.deepEqual(orderDraftBlockingFields(store.state.conversations[0].orderDraft), []);
  assert.equal(store.state.conversations[0].orderDraft.items[1].product.sku, 'MILK');
  assert.equal(store.state.pendingRequests[0].contextSnapshot.pricing.total, 22200);
  const disk = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
  assert.equal(disk.ordersByTenant.andina[0].pricing.total, 22200);
  checks++;

  for (const [label, patch, code] of [
    ['missing agreement', { customerConfirmed: false }, 'invalid_order_edit'],
    ['invalid total', { expectedTotal: 1 }, 'order_total_changed'],
    ['price tampering', { items: [{ sku: 'COLA', quantity: 2, unitPrice: 1 }] }, 'order_price_changed'],
    ['foreign SKU', { items: [{ sku: 'OTHER-TENANT-SKU', quantity: 1, unitPrice: 100 }] }, 'invalid_order_edit'],
    ['no stock', { items: [{ sku: 'EMPTY', quantity: 1, unitPrice: 6000 }] }, 'invalid_order_edit'],
    ['excess stock', { items: [{ sku: 'COLA', quantity: 41, unitPrice: 7200 }] }, 'invalid_order_edit'],
    ['negative quantity', { items: [{ sku: 'COLA', quantity: -1, unitPrice: 7200 }] }, 'invalid_order_edit'],
    ['empty order', { items: [] }, 'invalid_order_edit'],
    ['duplicate line', { items: [editInput().items[0], editInput().items[0]] }, 'invalid_order_edit'],
    ['amount not allowed', { items: [{ sku: 'COLA', quantity: null, unitPrice: 7200, saleMode: 'amount', requestedAmount: 7200 }] }, 'invalid_order_edit'],
    ['invalid sale mode', { items: [{ sku: 'COLA', quantity: 1, unitPrice: 7200, saleMode: 'other' }] }, 'invalid_order_edit'],
    ['no address', { deliveryAddress: '' }, 'invalid_order_edit'],
    ['invalid fee', { deliveryFee: -1 }, 'invalid_order_edit'],
    ['disabled payment', { paymentMethod: 'invented' }, 'invalid_order_edit'],
    ['restricted catalog', { items: [{ sku: 'RESTRICTED', quantity: 1, unitPrice: 4000 }] }, 'invalid_order_edit'],
    ['below minimum', { items: [{ sku: 'CHOCO', quantity: 1, unitPrice: 2800 }], expectedTotal: 5800 }, 'delivery_minimum_exception_required'],
  ]) {
    seedOrderEdit(store);
    const before = structuredClone(store.state.ordersByTenant);
    await assert.rejects(edit(editInput(patch)), error => error.code === code, label);
    assert.deepEqual(store.state.ordersByTenant, before, label);
    assert.equal(store.state.integrationOutbox.length, 0);
    checks++;
  }
  for (const status of ['dispatched', 'delivered', 'cancelled']) {
    seedOrderEdit(store).status = status;
    await assert.rejects(edit(editInput()), error => error.code === 'order_edit_closed');
    checks++;
  }
  seedOrderEdit(store);
  await assert.rejects(edit(editInput({ expectedVersion: 0 })), error => error.code === 'order_version_conflict');
  checks++;

  seedOrderEdit(store);
  const exception = await edit(editInput({ items: [{ sku: 'CHOCO', quantity: 1, unitPrice: 2800 }], expectedTotal: 5800, minimumException: true }));
  assert.equal(exception.order.pricing.status, 'exception_approved');
  assert.equal(exception.order.pricing.resolution.actorId, 'fixture-owner');
  checks++;
  seedOrderEdit(store);
  const pickup = await edit(editInput({ delivery: false, deliveryFee: 0, expectedTotal: 19200, deliveryAddress: '' }));
  assert.equal(pickup.order.pricing.status, 'not_applicable');
  assert.equal(pickup.order.deliveryAddress, '');
  checks++;
  seedOrderEdit(store);
  const amount = await edit(editInput({ items: [{ sku: 'CHEESE', quantity: null, unitPrice: 15000, saleMode: 'amount', requestedAmount: 6000 }], expectedTotal: 9000 }));
  assert.equal(amount.order.items[0].quantity, null);
  assert.equal(amount.order.subtotal, 6000);
  checks++;
  seedOrderEdit(store);
  tools.googleSheetsReadTable = async () => ({ status: 'error', rows: [] });
  assert.equal((await orders.workspace({ tenantId: 'andina', orderId: 'ord-edit-local', includeCatalog: false })).conversation.messages.length, 5);
  await assert.rejects(edit(editInput()), error => error.code === 'order_catalog_unavailable');
  tools.googleSheetsReadTable = products;
  checks++;

  seedOrderEdit(store);
  const races = await Promise.allSettled([edit(editInput()), edit(editInput({ customerName: 'Otro operador' }))]);
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(races.find(r => r.status === 'rejected').reason.code, 'order_version_conflict');
  checks++;
  // A rejected edit must not poison the shared transition lock.
  await orders.transition({ tenantId: 'andina', orderId: 'ord-edit-local', nextStatus: 'dispatched' });
  await assert.rejects(edit(editInput({ expectedVersion: 3 })), error => error.code === 'order_edit_closed');
  checks++;

  seedOrderEdit(store);
  tools.googleSheetsReadTable = async () => {
    store.state.tenants.find(t => t.id === 'andina').config.orderPolicy.deliveryMinimumSubtotal = 30000;
    return { status: 'success', rows: catalog };
  };
  await assert.rejects(edit(editInput()), error => error.code === 'delivery_policy_revision_conflict');
  tools.googleSheetsReadTable = products;
  checks++;

  // Retried Sheets edits project the latest order, and a provider outage does
  // not roll back the operational write or trigger a WhatsApp send.
  seedOrderEdit(store);
  await edit(editInput());
  await edit(editInput({ expectedVersion: 2, customerName: 'Última revisión' }));
  let projection;
  tools.syncLiveOrderStatus = async () => { throw new Error('Simulated Sheets outage'); };
  await integrationOutbox.drain();
  assert.equal(orders.findOrder('ord-edit-local').customerName, 'Última revisión');
  tools.syncLiveOrderStatus = async args => { projection = args; return { status: 'synced' }; };
  for (const entry of store.state.integrationOutbox) { entry.nextAttemptAt = new Date(0).toISOString(); }
  await integrationOutbox.drain();
  assert.equal(projection.order.version, 3);
  assert.equal(projection.order.customerName, 'Última revisión');
  assert.equal(projection.fullOrder, true);
  checks++;

  // A delayed status projection must not move Sheets back to an older stage.
  await integrationOutbox.handlers['order.sheet_projection']({ payload: { tenantId: 'andina', orderId: 'ord-edit-local', status: 'pending_human_preparation', updatedAt: '2020-01-01T00:00:00.000Z' } });
  assert.equal(projection.status, 'preparing');
  assert.equal(projection.updatedAt, orders.findOrder('ord-edit-local').updatedAt);
  checks++;

  // Exercise the real Sheets row serializer, with an in-memory provider only.
  const { ToolRegistry } = await import('../services/toolRegistry.js');
  const sheetTools = new ToolRegistry({ store, events: { emit() {} }, config: {} });
  let sheet;
  sheetTools.liveGoogleContext = async () => ({ accessToken: 'fixture', spreadsheetId: 'fixture' });
  sheetTools.googleWorkspace = { readValues: async () => [['id'], ['ord-edit-local']], updateValues: async args => { sheet = args; } };
  await sheetTools.syncLiveOrderStatus({ tenantId: 'andina', order: projection.order, status: 'preparing', updatedAt: projection.order.updatedAt, fullOrder: true });
  assert.equal(sheet.range, 'Pedidos!A2:M2');
  assert.equal(sheet.values[0][2], 'Última revisión');
  assert.equal(sheet.values[0][5], 19200);
  assert.equal(JSON.parse(sheet.values[0][12]).pricing.total, 22200);
  checks++;

  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { body, method = 'GET', cookie, csrf, status = 200 } = {}) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json)); checks++;
    return { json, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  seedOrderEdit(store);
  const route = '/api/orders/ord-edit-local';
  await request(route + '/workspace', { status: 401 });
  const login = await request('/api/auth/google', { method: 'POST', body: { idToken: 'dev-google-id-token', profile: { sub: 'order-edit-owner', email: 'andina@example.local', name: 'Owner' } } });
  const access = { cookie: login.cookie, csrf: login.json.session.csrfToken };
  await request(route + '/workspace', access);
  await request('/api/orders/ord-foreign/workspace', { ...access, status: 403 });
  await request('/api/orders/ord-foreign', { ...access, method: 'PATCH', body: editInput(), status: 403 });
  await request(route, { cookie: access.cookie, method: 'PATCH', body: editInput(), status: 403 });
  await request(route, { ...access, method: 'PATCH', body: editInput() });
  await request(route, { ...access, method: 'PATCH', body: editInput(), status: 409 });
  const viewer = await request('/api/auth/google', { method: 'POST', body: { idToken: 'dev-google-id-token', profile: { sub: 'order-edit-viewer', email: 'viewer@example.local', name: 'Viewer' } } });
  store.state.tenantMembers.push({ tenantId: 'andina', userId: viewer.json.user.id, role: 'viewer', status: 'active' });
  await request(route, { cookie: viewer.cookie, csrf: viewer.json.session.csrfToken, method: 'PATCH', body: editInput({ expectedVersion: 2 }), status: 403 });

  if (process.argv.includes('--postgres')) await postgresContracts();
  console.log(`PASS order edit: ${checks} contracts (API, isolation, pricing, history, concurrency, projections${process.argv.includes('--postgres') ? ', PostgreSQL' : ''}).`);
} finally {
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  globalThis.fetch = originalFetch;
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  await fs.rm(directory, { recursive: true, force: true });
}

async function postgresContracts() {
  assert.ok(process.env.POSTGRES_TEST_DATABASE_URL, 'Explicit test database required');
  const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Loopback only');
  const schema = `order_edit_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: url.toString(), ssl: false, max: 2 });
  const stores = [];
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000`);
    const db = new PostgresStore({ databaseUrl: url.toString(), ssl: 'disable', max: 3 }); stores.push(db);
    await db.migrate();
    db.state = structuredClone(store.state);
    seedOrderEdit(db, { pending: true });
    const before = structuredClone(db.state);
    await db.save();
    const makeService = database => new OrderService({ store: database, tools: { googleSheetsReadTable: products }, outbox: new IntegrationOutbox({ store: database }) });
    const service = makeService(db);
    const save = (engine, input) => engine.edit({ tenantId: 'andina', orderId: 'ord-edit-local', actorId: 'pg-owner', input });
    await save(service, editInput());
    const row = (await db.pool.query('SELECT subtotal, version, payload FROM orders WHERE id=$1', ['ord-edit-local'])).rows[0];
    assert.equal(Number(row.subtotal), 19200);
    assert.equal(Number(row.version), 2);
    assert.equal(row.payload.editHistory.length, 1);
    assert.equal((await db.getConversation('chat-edit-local')).orderDraft.pricing.total, 22200);
    assert.equal((await db.listPendingRequests({ tenantId: 'andina' }))[0].contextSnapshot.pricing.total, 22200);
    assert.equal((await db.listOutbox()).length, 1);
    checks++;

    const db2 = new PostgresStore({ databaseUrl: url.toString(), ssl: 'disable', max: 3 }); stores.push(db2);
    db2.state = structuredClone(db.state);
    const service2 = makeService(db2);
    const raced = await Promise.allSettled([save(service, editInput({ expectedVersion: 2, customerName: 'Uno' })), save(service2, editInput({ expectedVersion: 2, customerName: 'Dos' }))]);
    assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(raced.find(r => r.status === 'rejected').reason.code, 'order_version_conflict');
    const committed = await db.getOrder('andina', 'ord-edit-local');
    assert.equal(committed.version, 3);
    assert.equal((await db.listOutbox()).length, 2);
    checks++;

    // An old snapshot cannot replace a commercially edited order.
    db2.state = structuredClone(before);
    await db2.save();
    assert.deepEqual(await db.getOrder('andina', 'ord-edit-local'), committed);
    checks++;

    // Force a DB constraint failure after the UPDATE to prove rollback of all
    // order changes and zero pollution of the service's in-memory state.
    db.state.ordersByTenant.andina[0] = structuredClone(committed);
    const localBefore = structuredClone(db.state.ordersByTenant.andina[0]);
    const createEntry = service.outbox.createEntry.bind(service.outbox);
    service.outbox.createEntry = args => ({ ...createEntry(args), id: null });
    await assert.rejects(save(service, editInput({ expectedVersion: 3 })), error => error.code === '23502');
    assert.deepEqual(await db.getOrder('andina', 'ord-edit-local'), committed);
    assert.deepEqual(db.state.ordersByTenant.andina[0], localBefore);
    assert.equal((await db.listOutbox()).length, 2);
    checks++;
  } finally {
    for (const database of stores) await database.close();
    assert.match(schema, /^order_edit_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
