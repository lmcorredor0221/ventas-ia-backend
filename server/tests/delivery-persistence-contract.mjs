import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { JsonStore } from '../store/jsonStore.js';
import { PostgresStore } from '../store/postgresStore.js';
import { ToolRegistry } from '../services/toolRegistry.js';
import { IntegrationOutbox } from '../services/integrationOutbox.js';
import { evaluateDeliveryPolicy, deliveryBasketRevision, deliveryPolicyRevision } from '../domain/deliveryPolicy.js';

// Default: isolated JSON only. PostgreSQL is explicit, loopback-only, and uses
// a unique temporary schema populated with the repository's existing migrations.
// POSTGRES_TEST_DATABASE_URL=postgres://...@127.0.0.1/... node <this file> --postgres
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'delivery-persistence-'));
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Network providers are forbidden in this contract test'); };
let checks = 0;
try {
  await jsonContracts();
  await runtimeExceptionContract();
  if (process.argv.includes('--postgres')) await postgresContracts();
  else console.log('PostgreSQL race tests skipped (use --postgres and POSTGRES_TEST_DATABASE_URL).');
  console.log(`Delivery persistence contract passed: ${checks} checks.`);
} finally {
  globalThis.fetch = originalFetch;
  assert.equal(path.dirname(tempDir), path.resolve(os.tmpdir()));
  await fs.rm(tempDir, { recursive: true, force: true });
}

function fixtureState() {
  return {
    tenants: [{ id: 'delivery-test', name: 'Delivery fixture', status: 'active', config: {
      orderPolicy: { deliveryFee: 3000, deliveryMinimumSubtotal: 15000 },
    } }],
    conversations: [{ id: 'delivery-conversation', tenantId: 'delivery-test', status: 'active', orderDraft: { version: 4 } }],
    ordersByTenant: { 'delivery-test': [] }, pendingRequests: [], auditEvents: [], integrationOutbox: [],
  };
}

function registry(store) {
  const tools = new ToolRegistry({ store, events: { emit() {} }, config: { allowLocalCatalogFallback: true } });
  tools.setOutbox(new IntegrationOutbox({ store }));
  return tools;
}

function quote(state, overrides = {}) {
  const tenant = state.tenants[0];
  const items = overrides.items ?? [{ sku: 'fixture-rice', name: 'Arroz', unitPrice: 5000, quantity: 3, lineTotal: 15000 }];
  const delivery = overrides.delivery ?? true;
  return {
    wa_id: '573000000001', customer_name: 'Cliente fixture', delivery_address: 'Dirección fixture',
    paymentMethod: 'cash', items, delivery,
    pricing: evaluateDeliveryPolicy({ tenant, items, delivery, draftVersion: 4, resolution: overrides.resolution }),
  };
}

function write(tools, payload) { return tools.googleSheetsOrderWrite('delivery-test', 'delivery-conversation', payload); }
function counts(store) { return [store.getState().ordersByTenant['delivery-test'].length, store.getState().integrationOutbox.length]; }

async function rejectsWithoutWrite(store, tools, payload, code) {
  const before = counts(store);
  await assert.rejects(write(tools, payload), (error) => error.code === code);
  assert.deepEqual(counts(store), before);
  checks += 1;
}

async function jsonContracts() {
  const file = path.join(tempDir, 'orders.json');
  const store = new JsonStore(file);
  store.state = fixtureState();
  const tools = registry(store);
  const payload = quote(store.state);
  const expected = structuredClone(payload.pricing);
  const saved = await write(tools, payload);
  assert.equal(saved.order.subtotal, 15000);
  assert.equal(saved.order.pricing.total, 18000);
  assert.equal(saved.order.paymentMethod, 'cash');
  assert.equal(saved.order.delivery, true);
  payload.pricing.total = 999;
  payload.items[0].unitPrice = 1;
  assert.deepEqual(saved.order.pricing, expected);
  assert.equal(saved.order.items[0].unitPrice, 5000);
  let disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(disk.ordersByTenant['delivery-test'][0].pricing, expected);
  assert.equal(disk.integrationOutbox.length, 1);
  checks += 1;

  let sheet;
  tools.googleWorkspace = { appendValues: async (args) => { sheet = args; } };
  await tools.appendLiveOrder({ live: { accessToken: 'stub', spreadsheetId: 'stub' }, order: saved.order });
  assert.equal(sheet.range, 'Pedidos!A:M');
  const row = sheet.values[0];
  assert.equal(row.length, 13);
  assert.equal(row[0], saved.order.id);
  assert.equal(row[5], 15000);
  assert.equal(row[6], 'confirmado');
  assert.deepEqual(JSON.parse(row[12]), { conversationId: 'delivery-conversation', pricing: expected, paymentMethod: 'cash', delivery: true });
  checks += 1;

  for (const corrupt of [
    p => { p.pricing.total += 100; },
    p => { p.pricing.subtotal += 100; p.pricing.total += 100; },
    p => { p.items[0].lineTotal = 1; },
    p => { p.subtotal = 1; },
    p => { p.pricing.minimumSubtotal = 0; },
    p => { p.pricing.shortfall = 123; },
    p => { p.pricing.currency = 'USD'; },
    p => { p.delivery = false; },
    p => { p.pricing.draftVersion = 3; },
    p => { p.items[0].unitPrice = 6000; },
  ]) {
    const bad = quote(store.state);
    corrupt(bad);
    await rejectsWithoutWrite(store, tools, bad,
      bad.pricing.total !== bad.pricing.subtotal + bad.pricing.deliveryFee ? 'delivery_policy_not_satisfied' : 'invalid_order_pricing');
  }
  const otherTenant = quote(store.state);
  const omittedQuote = quote(store.state);
  delete omittedQuote.pricing;
  await rejectsWithoutWrite(store, tools, omittedQuote, 'invalid_order_pricing');
  store.state.conversations[0].orderDraft.pricing = expected;
  await rejectsWithoutWrite(store, tools, { items: omittedQuote.items, subtotal: 15000 }, 'invalid_order_pricing');
  delete store.state.conversations[0].orderDraft.pricing;
  otherTenant.pricing.tenantId = 'other-tenant';
  await rejectsWithoutWrite(store, tools, otherTenant, 'delivery_policy_revision_conflict');
  await rejectsWithoutWrite(store, tools, { ...quote(store.state), pricing: null }, 'delivery_policy_revision_conflict');
  const below = quote(store.state, { items: [{ sku: 'fixture-rice', unitPrice: 5000, quantity: 2, lineTotal: 10000 }] });
  await rejectsWithoutWrite(store, tools, below, 'delivery_policy_not_satisfied');
  const incomplete = quote(store.state, { items: [{ sku: 'fixture-rice', unitPrice: null, quantity: 3 }] });
  await rejectsWithoutWrite(store, tools, incomplete, 'delivery_policy_not_satisfied');

  const oldQuote = quote(store.state);
  store.state.tenants[0].config.orderPolicy.deliveryFee = 4000;
  await rejectsWithoutWrite(store, tools, oldQuote, 'delivery_policy_revision_conflict');
  assert.deepEqual(saved.order.pricing, expected, 'tenant edits do not reprice confirmed orders');
  store.state.tenants[0].config.orderPolicy.deliveryFee = null;
  await rejectsWithoutWrite(store, tools, quote(store.state), 'delivery_policy_not_satisfied');
  const pickup = await write(tools, quote(store.state, { delivery: false }));
  assert.equal(pickup.order.pricing.status, 'not_applicable');
  assert.equal(pickup.order.pricing.total, 15000);
  store.state.tenants[0].config.orderPolicy = { deliveryFee: 0, deliveryMinimumSubtotal: 0 };
  const zero = await write(tools, quote(store.state));
  assert.equal(zero.order.pricing.deliveryFee, 0);
  assert.equal(zero.order.pricing.minimumSubtotal, 0);
  checks += 2;

  store.state.tenants[0].config.orderPolicy = { deliveryFee: 3000, deliveryMinimumSubtotal: 15000 };
  const budget = quote(store.state, { items: [
    { sku: 'fixture-budget', unitPrice: 1000, quantity: null, budgetAmount: 18000, lineTotal: 18000 },
  ] });
  await rejectsWithoutWrite(store, tools, budget, 'delivery_policy_not_satisfied');

  const resolution = { authorized: true, requestId: 'delivery-review', actorId: 'owner-test',
    tenantId: 'delivery-test', policyRevision: deliveryPolicyRevision(store.state.tenants[0]),
    basketRevision: deliveryBasketRevision(below.items), minimumException: true };
  const exceptionQuote = quote(store.state, { items: below.items, resolution });
  await rejectsWithoutWrite(store, tools, exceptionQuote, 'delivery_policy_not_satisfied');
  store.state.conversations[0].deliveryResolution = structuredClone(resolution);
  await rejectsWithoutWrite(store, tools, exceptionQuote, 'delivery_policy_not_satisfied');
  const review = { id: resolution.requestId, type: 'human_handoff', action: 'delivery_policy_review', status: 'resolved',
    tenantId: 'delivery-test', conversationId: 'delivery-conversation', deliveryResolution: structuredClone(resolution) };
  store.state.pendingRequests.push(review);
  const exception = await write(tools, exceptionQuote);
  assert.equal(exception.order.pricing.status, 'exception_approved');
  assert.equal(exception.order.pricing.shortfall, 5000);
  assert.equal(exception.order.pricing.total, 13000, 'shortfall is not an extra charge');
  checks += 1;
  review.status = 'pending';
  await rejectsWithoutWrite(store, tools, exceptionQuote, 'delivery_policy_not_satisfied');
  review.status = 'resolved';
  review.tenantId = 'other-tenant';
  await rejectsWithoutWrite(store, tools, exceptionQuote, 'delivery_policy_not_satisfied');
  review.tenantId = 'delivery-test';
  review.deliveryResolution.actorId = 'forged-actor';
  await rejectsWithoutWrite(store, tools, exceptionQuote, 'delivery_policy_not_satisfied');
  delete store.state.conversations[0].deliveryResolution;

  const legacy = await write(tools, { items: [{ name: 'Legacy' }], subtotal: 1234 });
  assert.equal(legacy.order.subtotal, 1234);
  assert.equal(Object.hasOwn(legacy.order, 'pricing'), false);
  checks += 1;

  const persist = store.persistOrderWithOutbox;
  store.persistOrderWithOutbox = () => { throw Object.assign(new Error('policy changed while persisting'), { code: 'delivery_policy_revision_conflict' }); };
  await rejectsWithoutWrite(store, tools, quote(store.state), 'delivery_policy_revision_conflict');
  disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(disk.ordersByTenant, JSON.parse(JSON.stringify(store.state.ordersByTenant)));
  assert.deepEqual(disk.integrationOutbox, store.state.integrationOutbox);
  store.persistOrderWithOutbox = persist;
}

async function runtimeExceptionContract() {
  const { createAppAsync } = await import('../index.js');
  const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(tempDir, 'runtime.json'),
    whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true });
  try {
    const product = { sku: 'EXCEPTION-TEST', name: 'Pan de prueba', price: 10000, stock: 50, active: true, presentation: '1 paquete' };
    app.store.mutate(state => {
      state.productsByTenant.andina = [product];
      Object.assign(state.tenants.find(tenant => tenant.id === 'andina').config.orderPolicy,
        { deliveryFee: 3000, deliveryMinimumSubtotal: 15000 });
    });
    let intent = 'delivery_order';
    let nextAction = 'human_review';
    let items = [{ rawItemId: 'exception-line', rawText: 'un pan', productHypothesis: product.name, quantity: 1 }];
    let customerDelta = { name: 'Cliente prueba', address: 'Calle Prueba 1', paymentPreference: 'cash' };
    app.runtime.planner = {
      async plan() { return { intent, semanticFrame: { items, delivery: true, customerDelta,
        cartMutation: { mode: 'delta' }, collectionComplete: true }, order: { delivery: true, items }, missingFields: [] }; },
      async composeReply({ fallbackText }) { return { text: fallbackText }; },
    };
    app.runtime.grounding.agent = { async decide({ observations }) { return { nextAction,
      decisions: observations.map(({ item }) => ({ rawItemId: item.rawItemId, action: 'resolved', sku: product.sku })) }; } };
    const send = (text, messageId) => app.runtime.processInbound({ tenantId: 'andina', waId: '573000009999', messageId, messageType: 'text', text });
    const initial = await send('Un pan a domicilio, necesito una excepción al mínimo', 'exception-request');
    const request = app.store.getState().pendingRequests.find(item => item.conversationId === initial.conversation.id
      && item.action === 'delivery_policy_review');
    assert.equal(request.type, 'human_handoff');
    items = []; customerDelta = {}; nextAction = 'confirm_order';
    await app.runtime.resolveHumanRequest(request.id, { outcome: 'approved', approverId: 'owner-test',
      note: 'Excepción explícita para esta canasta', deliveryResolution: { minimumException: true, deliveryFee: null, minimumSubtotal: null } });
    const quoted = await app.runtime.getConversation(initial.conversation.id);
    assert.equal(quoted.orderDraft.pricing.status, 'exception_approved');
    assert.ok(!quoted.orderId, 'human approval still requires buyer consent');
    intent = 'order_confirmation';
    const confirmed = await send('Acepto el total de 13000 y confirmo', 'exception-confirm');
    assert.ok(confirmed.conversation.orderId, 'valid human exception must pass the actual runtime write guard');
    const order = app.orders.findOrder(confirmed.conversation.orderId, 'andina');
    assert.equal(order.pricing.status, 'exception_approved');
    assert.equal(order.pricing.total, 13000);
    assert.equal(order.pricing.resolution.requestId, request.id);
    assert.equal(order.paymentMethod, 'cash');
    checks += 1;
  } finally {
    app.runtime.stop();
    await app.store.close?.();
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

async function until(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function postgresContracts() {
  const databaseUrl = process.env.DELIVERY_PERSISTENCE_TEST_DATABASE_URL ?? process.env.POSTGRES_TEST_DATABASE_URL;
  assert.ok(databaseUrl, '--postgres requires an explicit test database URL; DATABASE_URL is never used');
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'PostgreSQL contract only permits a loopback host');
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const schema = `delivery_persistence_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: url.toString(), ssl: false, max: 3 });
  let store;
  let releaseLock = () => {};
  let writer;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    url.searchParams.set('options', `-c search_path=${schema} -c statement_timeout=10000 -c lock_timeout=8000`);
    url.searchParams.set('application_name', schema);
    store = new PostgresStore({ databaseUrl: url.toString(), ssl: 'disable', max: 4 });
    await store.migrate();
    store.state = fixtureState();
    await store.persistTenantCritical('delivery-test');
    await store.persistConversation('delivery-conversation');
    const tools = registry(store);
    const first = await write(tools, quote(store.state));
    let result = await store.pool.query('SELECT subtotal, payload FROM orders WHERE id = $1', [first.order.id]);
    assert.equal(Number(result.rows[0].subtotal), 15000);
    assert.deepEqual(result.rows[0].payload.pricing, first.order.pricing);
    assert.equal(result.rows[0].payload.paymentMethod, 'cash');
    assert.equal((await store.listOutbox()).length, 1);
    await store.flush();
    checks += 1;

    // Hold the tenant update uncommitted. The tool's preliminary read sees the
    // old quote; its transactional FOR UPDATE must wait, then reject the new policy.
    writer = await admin.connect();
    const changedTenant = structuredClone(store.state.tenants[0]);
    changedTenant.config.orderPolicy.deliveryFee = 4500;
    await writer.query('BEGIN');
    await writer.query(`UPDATE "${schema}".tenants SET payload = $1::jsonb, config = $2::jsonb WHERE id = $3`,
      [JSON.stringify(changedTenant), JSON.stringify(changedTenant.config), changedTenant.id]);
    const rejected = assert.rejects(write(tools, quote(store.state)), error => error.code === 'delivery_policy_revision_conflict');
    await until(async () => {
      const locks = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'", [schema]);
      return locks.rowCount > 0;
    }, 'order did not wait on the concurrent tenant policy write');
    assert.equal(store.state.ordersByTenant['delivery-test'].length, 1, 'uncommitted order must not enter app state');
    await writer.query('COMMIT');
    await rejected;
    store.queueSave();
    await store.flush();
    assert.equal((await store.pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, 1);
    assert.equal((await store.listOutbox()).length, 1);
    const snapshot = (await store.pool.query("SELECT document FROM app_state WHERE id = 'runtime'")).rows[0].document;
    assert.equal(snapshot.ordersByTenant['delivery-test'].length, 1, 'rejected order must not survive in app_state');
    assert.equal((await store.getTenant('delivery-test')).config.orderPolicy.deliveryFee, 4500);
    checks += 1;

    // Reverse race: pause the order after it acquired the real tenant row lock.
    // A concurrent policy update must stay blocked until order + outbox commit.
    const locked = deferred();
    const proceed = deferred();
    releaseLock = proceed.resolve;
    const connect = store.pool.connect.bind(store.pool);
    store.pool.connect = (callback) => {
      if (callback) return connect(callback);
      return connect().then(client => ({
        query: async (...args) => {
          const response = await client.query(...args);
          if (typeof args[0] === 'string' && args[0].includes('FROM tenants') && args[0].includes('FOR UPDATE')) {
            locked.resolve();
            await proceed.promise;
          }
          return response;
        },
        release: () => client.release(),
      }));
    };
    const secondWrite = write(tools, quote(store.state));
    await Promise.race([locked.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('order lock timeout')), 5000).unref())]);
    assert.equal(store.state.ordersByTenant['delivery-test'].length, 1);
    const nextTenant = structuredClone(changedTenant);
    nextTenant.config.orderPolicy.deliveryFee = 6000;
    const update = writer.query(`UPDATE "${schema}".tenants SET payload = $1::jsonb, config = $2::jsonb WHERE id = $3`,
      [JSON.stringify(nextTenant), JSON.stringify(nextTenant.config), nextTenant.id]);
    await until(async () => {
      const locks = await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [writer.processID]);
      return locks.rowCount > 0;
    }, 'policy update was not blocked by the order transaction');
    proceed.resolve();
    const second = await secondWrite;
    await update;
    store.pool.connect = connect;
    assert.equal(second.order.pricing.deliveryFee, 4500);
    assert.equal((await store.getTenant('delivery-test')).config.orderPolicy.deliveryFee, 6000);
    assert.equal((await store.listOutbox()).length, 2);
    checks += 1;

    // Status updates remain possible after policy changes, but cannot rewrite
    // the commercial terms of a confirmed order (including its payment choice).
    store.state.tenants[0] = nextTenant;
    const current = store.state.ordersByTenant['delivery-test'].find(order => order.id === second.order.id);
    current.version = 1;
    current.status = 'preparing';
    current.updatedAt = new Date().toISOString();
    await store.persistOrderWithOutbox('delivery-test', current.id);
    result = await store.pool.query('SELECT payload FROM orders WHERE id = $1', [current.id]);
    assert.deepEqual(result.rows[0].payload.pricing, second.order.pricing);
    const originalPayment = current.paymentMethod;
    current.paymentMethod = 'forged-payment';
    current.version += 1;
    await assert.rejects(store.persistOrder('delivery-test', current.id), error => error.code === 'order_version_conflict');
    current.paymentMethod = originalPayment;
    current.version -= 1;
    result = await store.pool.query('SELECT payload FROM orders WHERE id = $1', [current.id]);
    assert.equal(result.rows[0].payload.paymentMethod, originalPayment);
    await store.flush();
    checks += 1;
    console.log('Real local PostgreSQL: JSONB round-trip, both lock races, rollback/app_state cleanup, immutable history passed.');
    // New sale mode reuses JSONB; no new schema/production migration needed.
    const amountProduct = { sku: 'amount-local', name: 'Salchichón al corte', price: 5000, stock: 20,
      active: true, allowsSaleByAmount: true };
    await store.pool.query('INSERT INTO products (tenant_id, sku, name, price, stock, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      ['delivery-test', amountProduct.sku, amountProduct.name, amountProduct.price, amountProduct.stock, JSON.stringify(amountProduct)]);
    store.state.conversations[0].orderDraft.items = [{ product: amountProduct, saleMode: 'amount', requestedAmount: 20000, quantity: null }];
    store.state.conversations[0].orderDraft.dataAudit = { verdict: 'correct', revision: 'local-audit-receipt', corrections: [{ field: 'requestedAmount', value: 20000 }] };
    await store.persistConversation('delivery-conversation');
    const amountQuote = quote(store.state, { items: [{ sku: amountProduct.sku, name: amountProduct.name,
      unitPrice: 5000, quantity: null, saleMode: 'amount', requestedAmount: 20000, allowsSaleByAmount: true, lineTotal: 20000 }] });
    const amountOrder = await write(tools, amountQuote);
    const amountRow = (await store.pool.query('SELECT payload FROM orders WHERE id = $1', [amountOrder.order.id])).rows[0].payload;
    assert.equal(amountRow.items[0].quantity, null); assert.equal(amountRow.items[0].requestedAmount, 20000);
    assert.equal(amountRow.pricing.subtotal, 20000);
    assert.equal((await store.getConversation('delivery-conversation')).orderDraft.dataAudit.verdict, 'correct');
    assert.equal((await store.listProducts('delivery-test'))[0].allowsSaleByAmount, true);
    checks += 1;
    console.log('Real local PostgreSQL: amount sale, catalog flag and audit receipt round-trip passed.');
  } finally {
    releaseLock();
    if (writer) { await writer.query('ROLLBACK'); writer.release(); }
    if (store) {
      if (store.snapshotSaveTimer) clearTimeout(store.snapshotSaveTimer);
      await store.saveQueue.catch(() => {});
      await store.pool.end();
    }
    assert.match(schema, /^delivery_persistence_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
