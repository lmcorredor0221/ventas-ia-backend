import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { createAppAsync } from '../index.js';
import { PostgresStore } from '../store/postgresStore.js';
import { UsageService } from '../services/usageService.js';

const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL ?? fs.readFileSync('.env.example', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim());
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ventas_ia_dev') throw new Error('Only the local development database is allowed');
const schema = `via_manual_order_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: url.href, ssl: false });
const originalFetch = global.fetch;
global.fetch = (input, options) => {
  if (new URL(input).hostname !== '127.0.0.1') throw new Error('External requests disabled');
  return originalFetch(input, options);
};
let store, reader, server;
const pauseSnapshots = value => { clearTimeout(value.snapshotSaveTimer); value.snapshotSaveTimer = null; };
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=10000`);
  const runtime = await createAppAsync({ storageDriver: 'postgres', databaseUrl: url.href, databaseSsl: 'disable',
    backgroundWorkersEnabled: false, integrationOutboxEnabled: true, allowLocalCatalogFallback: true,
    authRequired: true, csrfRequired: true, allowDevGoogleLogin: true });
  store = runtime.store;
  const now = new Date().toISOString();
  store.mutate(state => {
    for (const [id, tenantId] of [['manual-pg', 'andina'], ['manual-fail', 'andina'], ['manual-other', 'norte']]) {
      state.conversations.push({ id, tenantId, waId: '573000000001', status: 'manual_active', manualMode: 'whatsapp_external', aiPaused: true, messages: [], createdAt: now, updatedAt: now });
    }
    state.pendingRequests.push({ id: 'manual-task', tenantId: 'andina', conversationId: 'manual-pg', status: 'pending', type: 'human_handoff', title: 'Resolver productos', createdAt: now });
  });
  await store.save(); pauseSnapshots(store);
  server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie, csrf;
  const request = async (method, path, body, status = 200, includeCsrf = true) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrf && includeCsrf ? { 'x-csrf-token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); pauseSnapshots(store);
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return data;
  };
  await request('GET', '/api/conversations/manual-pg/manual-order', null, 401);
  const login = await request('POST', '/api/auth/google', { idToken: 'dev-google-id-token', profile: { sub: 'manual-owner', email: 'andina@example.local', name: 'Owner' } });
  csrf = login.session.csrfToken;
  await request('GET', '/api/conversations/manual-other/manual-order', null, 403);
  const context = await request('GET', '/api/conversations/manual-pg/manual-order');
  const product = context.products.find(p => p.stock > 1 && p.price > 0);
  assert.ok(product);
  const input = { customerConfirmed: true, customerName: 'Cliente prueba local', deliveryAddress: 'Dirección de prueba', paymentMethod: 'cash', items: [{ sku: product.sku, quantity: 1, unitPrice: product.price }] };
  await request('POST', '/api/conversations/manual-pg/manual-order', input, 403, false);
  await request('POST', '/api/conversations/manual-other/manual-order', { ...input, tenantId: 'andina' }, 403);
  const before = (await runtime.usage.summary('andina')).metrics.deliveries_confirmed;
  const saved = await request('POST', '/api/conversations/manual-pg/manual-order', input, 201);
  assert.equal(saved.order.status, 'preparing');
  assert.equal(saved.order.subtotal, product.price);
  const retries = await Promise.all(Array.from({ length: 3 }, () => request('POST', '/api/conversations/manual-pg/manual-order', input)));
  assert.ok(retries.every(result => !result.created && result.order.id === saved.order.id));
  const count = await store.pool.query("SELECT count(*)::int AS n FROM orders WHERE conversation_id='manual-pg'");
  assert.equal(count.rows[0].n, 1);
  assert.equal((await runtime.usage.summary('andina')).metrics.deliveries_confirmed, before + 1);
  assert.equal((await store.pool.query("SELECT status FROM pending_requests WHERE id='manual-task'")).rows[0].status, 'resolved');
  assert.equal((await store.pool.query('SELECT count(*)::int AS n FROM integration_outbox WHERE aggregate_id=$1', [saved.order.id])).rows[0].n, 1);

  await store.pool.query("CREATE FUNCTION reject_manual_order_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced local rollback'; END $$");
  await store.pool.query('CREATE TRIGGER reject_manual_order_outbox BEFORE INSERT ON integration_outbox FOR EACH ROW EXECUTE FUNCTION reject_manual_order_outbox()');
  const failed = await request('POST', '/api/conversations/manual-fail/manual-order', input, 500);
  assert.match(failed.error, /forced local rollback/);
  assert.equal((await store.pool.query("SELECT count(*)::int AS n FROM orders WHERE conversation_id='manual-fail'")).rows[0].n, 0);
  assert.equal(store.state.conversations.find(c => c.id === 'manual-fail').orderId, undefined);
  assert.equal((await runtime.usage.summary('andina')).metrics.deliveries_confirmed, before + 1);
  await store.pool.query('DROP TRIGGER reject_manual_order_outbox ON integration_outbox');
  pauseSnapshots(store);
  reader = new PostgresStore({ databaseUrl: url.href, ssl: 'disable' });
  await reader.load(); pauseSnapshots(reader);
  assert.equal((await reader.getConversation('manual-pg')).orderId, saved.order.id);
  assert.equal(reader.state.ordersByTenant.andina.find(order => order.id === saved.order.id).status, 'preparing');
  assert.equal((await reader.getUsageCounters('andina', (await runtime.usage.summary('andina')).period)).deliveries_confirmed, before + 1);
  assert.equal((await new UsageService({ store: reader }).summary('andina')).metrics.deliveries_confirmed, before + 1);
  console.log('PASS real PostgreSQL: authenticated API, CSRF, tenant isolation, idempotency, atomic rollback, outbox and restart recovery');
} finally {
  global.fetch = originalFetch;
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  for (const value of [store, reader].filter(Boolean)) { pauseSnapshots(value); await Promise.allSettled([value.saveQueue, value.snapshotQueue]); await value.pool.end(); }
  if (!/^via_manual_order_[a-f0-9]{16}$/.test(schema)) throw new Error('Invalid test schema');
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
