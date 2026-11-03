import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../store/postgresStore.js';
import { SecretVault } from '../services/secretVault.js';
import { createAppAsync } from '../index.js';

const configured = process.env.POSTGRES_TEST_DATABASE_URL
  ?? fs.readFileSync('.env.example', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1].trim();
const url = new URL(configured);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ventas_ia_dev') {
  throw new Error('This test only accepts the local ventas_ia_dev database');
}
const schema = `via_ops_restart_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: url.href, ssl: false });
const stores = [];
const servers = [];
const encryptionKey = crypto.randomBytes(32).toString('hex');
const originalFetch = global.fetch;
global.fetch = (input, options) => {
  if (new URL(input).hostname !== '127.0.0.1') throw new Error('External HTTP is disabled in this contract');
  return originalFetch(input, options);
};
let publicBefore;

async function digest(namespace) {
  const { rows } = await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [namespace]);
  const quote = name => `"${name.replaceAll('"', '""')}"`;
  const result = [];
  for (const { tablename } of rows) {
    const data = await admin.query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(hash, '' ORDER BY hash), '')) AS digest
      FROM (SELECT md5(to_jsonb(t)::text) AS hash FROM ${quote(namespace)}.${quote(tablename)} t) records`);
    result.push({ table: tablename, ...data.rows[0] });
  }
  return result;
}

function pauseSnapshots(store) {
  clearTimeout(store.snapshotSaveTimer);
  store.snapshotSaveTimer = null;
}

async function open() {
  const store = new PostgresStore({ databaseUrl: url.href, ssl: 'disable' });
  stores.push(store);
  await store.load();
  return store;
}

async function runtimeDocument(store) {
  return (await store.pool.query("SELECT document FROM app_state WHERE id='runtime'")).rows[0].document;
}

async function launch() {
  const app = await createAppAsync({ storageDriver: 'postgres', databaseUrl: url.href, databaseSsl: 'disable',
    backgroundWorkersEnabled: false, integrationOutboxEnabled: false, authRequired: true,
    csrfRequired: false, allowDevGoogleLogin: true });
  stores.push(app.store);
  const server = app.app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  const request = async (method, path, body, expectedStatus = 200) => {
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    pauseSnapshots(app.store);
    assert.equal(response.status, expectedStatus, `${method} ${path}: ${data.error ?? 'unexpected status'}`);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return data;
  };
  return { ...app, request };
}

const at = '2026-11-03T20:00:00.000Z';
const conversation = (id, tenantId = 'andina') => ({ id, tenantId, waId: '573000000001', customer: 'Restart contract',
  status: 'blocked', caseStatus: 'active', zone: 'approval', messages: [], createdAt: at, updatedAt: at });
const task = (id, conversationId, tenantId = 'andina') => ({ id, tenantId, conversationId, type: 'human_handoff',
  status: 'pending', title: 'Consulta humana', assignedTeam: 'soporte', createdAt: at });
const order = (id, conversationId, tenantId = 'andina') => ({ id, tenantId, conversationId, waId: '573000000001',
  status: 'pending_human_preparation', version: 7, items: [], subtotal: 1000, createdAt: at, updatedAt: at });
const login = app => app.request('POST', '/api/auth/google', { idToken: 'dev-google-id-token',
  profile: { sub: 'ops-restart-owner', email: 'andina@example.local', name: 'Restart owner' } });
const approve = { outcome: 'approved', note: 'Respuesta local de contrato', responseMode: 'platform' };

try {
  publicBefore = await digest('public');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=10000`);
  const writer = await open();
  const vault = new SecretVault({ store: writer, encryptionKey });
  const googleToken = crypto.randomBytes(32).toString('hex');
  const whatsappToken = crypto.randomBytes(32).toString('hex');
  const googleRef = vault.saveSecret({ tenantId: 'andina', name: 'RESTART_GOOGLE', value: googleToken });
  const whatsappRef = vault.saveSecret({ tenantId: 'andina', name: 'RESTART_WHATSAPP', value: whatsappToken });
  writer.mutate(state => {
    state.googleConnectionsByTenant.andina = { tenantId: 'andina', status: 'connected', mode: 'live',
      connectedAt: at, refreshTokenRef: googleRef };
    state.whatsappOnboardingByTenant.andina = { tenantId: 'andina', status: 'connected', attempt: { tokenRef: whatsappRef } };
    state.tenants.find(t => t.id === 'andina').config.whatsapp.accessTokenRef = whatsappRef;
    state.conversations.push(conversation('gone-conv'), conversation('resolved-conv'), conversation('denied-conv'));
    state.pendingRequests.push(task('gone-task', 'gone-conv'), task('resolved-task', 'resolved-conv'), task('denied-task', 'denied-conv'));
    (state.ordersByTenant.andina ??= []).push(order('gone-order', 'gone-conv'));
  });
  await writer.persistTenantCritical('andina');
  await writer.persistWhatsAppOnboarding('andina');
  await writer.save();
  pauseSnapshots(writer);
  const staleSnapshot = await runtimeDocument(writer);

  writer.mutate(state => {
    for (const [id, status] of [['resolved-task', 'resolved'], ['denied-task', 'denied']]) {
      Object.assign(state.pendingRequests.find(t => t.id === id), { status, resolvedAt: at, resolutionNote: 'Durable decision' });
    }
    Object.assign(state.conversations.find(c => c.id === 'resolved-conv'), { status: 'completed', caseStatus: 'completed' });
    state.conversations.push(conversation('durable-conv'), conversation('delivery-conv'), conversation('north-conv', 'norte'));
    state.pendingRequests.push(task('durable-task', 'durable-conv'), task('durable-twin', 'durable-conv'),
      { ...task('delivery-task', 'delivery-conv'), action: 'prepare_delivery_order', contextSnapshot: { orderId: 'durable-order' } },
      task('north-task', 'north-conv', 'norte'));
    state.ordersByTenant.andina.push(order('durable-order', 'delivery-conv'));
    (state.ordersByTenant.norte ??= []).push(order('north-order', 'north-conv', 'norte'));
  });
  pauseSnapshots(writer);
  for (const id of ['resolved-task', 'denied-task', 'durable-task', 'durable-twin', 'delivery-task', 'north-task']) await writer.persistPendingRequest(id);
  for (const id of ['resolved-conv', 'durable-conv', 'delivery-conv', 'north-conv']) await writer.persistConversation(id);
  await writer.persistOrder('andina', 'durable-order');
  await writer.persistOrder('norte', 'north-order');
  await writer.deleteConversation('gone-conv');
  await writer.pool.query('DELETE FROM orders WHERE id=$1', ['gone-order']);
  assert.deepEqual(await runtimeDocument(writer), staleSnapshot, 'only critical rows may change before restart');

  const beforeLoad = await digest(schema);
  const restarted = await launch();
  assert.deepEqual(await digest(schema), beforeLoad, 'loading existing rows must not write snapshots or mutate operational tables');
  await login(restarted);
  const listed = await restarted.request('GET', '/api/pending-requests?tenantId=andina');
  assert.ok(listed.some(t => t.id === 'durable-task' && t.status === 'pending'));
  const listedConversation = await restarted.request('GET', '/api/conversations/durable-conv');
  assert.equal(listedConversation.status, 'blocked');
  // This is the production failure before the fix: SQL-backed GETs succeed,
  // but POST returns 404 because load() restored only the old app_state document.
  const resolved = await restarted.request('POST', '/api/pending-requests/durable-task/resolve', approve);
  assert.equal(resolved.status, 'resolved');
  const hydratedConversation = restarted.store.getState().conversations.find(c => c.id === 'durable-conv');
  assert.ok(hydratedConversation.messages.some(m => m.requestId === 'durable-task' && m.text === approve.note));
  assert.equal(restarted.store.getState().pendingRequests.find(t => t.id === 'durable-twin').status, 'pending',
    'load must respect durable pending rows rather than superseding them only in memory');
  console.log('PASS real HTTP resolver after restart: durable task/conversation absent from snapshot, platform reply persisted');

  await restarted.request('POST', '/api/pending-requests/resolved-task/resolve', approve, 409);
  await restarted.request('POST', '/api/pending-requests/denied-task/resolve', approve, 409);
  assert.equal(restarted.store.getState().conversations.find(c => c.id === 'resolved-conv').status, 'completed');
  await restarted.request('POST', '/api/pending-requests/gone-task/resolve', approve, 404);
  assert.equal(restarted.store.getState().conversations.some(c => c.id === 'gone-conv'), false);
  assert.equal(Object.values(restarted.store.getState().ordersByTenant).flat().some(o => o.id === 'gone-order'), false);
  console.log('PASS durable resolved/denied/closed states prevail; deleted task, conversation and order stay absent');

  const northBefore = (await writer.pool.query("SELECT payload FROM pending_requests WHERE id='north-task'")).rows[0].payload;
  await restarted.request('POST', '/api/pending-requests/north-task/resolve', approve, 403);
  await restarted.request('GET', '/api/conversations/north-conv', undefined, 403);
  assert.deepEqual((await writer.pool.query("SELECT payload FROM pending_requests WHERE id='north-task'")).rows[0].payload, northBefore);
  assert.equal(listed.some(t => t.tenantId === 'norte'), false);
  assert.equal(restarted.store.getState().ordersByTenant.norte.find(o => o.id === 'north-order').tenantId, 'norte');
  console.log('PASS tenant isolation: same customer number across tenants, SQL lists scoped and cross-tenant resolution denied');

  await restarted.request('POST', '/api/pending-requests/delivery-task/resolve', { outcome: 'approved' });
  const prepared = (await writer.pool.query("SELECT status, version FROM orders WHERE id='durable-order'")).rows[0];
  assert.equal(prepared.status, 'preparing');
  assert.equal(Number(prepared.version), 8);
  assert.equal((await writer.pool.query("SELECT status FROM orders WHERE id='north-order'")).rows[0].status, 'pending_human_preparation');
  assert.deepEqual(await runtimeDocument(writer), staleSnapshot, 'resolving tasks must not depend on a new full snapshot');

  const reloaded = await open();
  assert.equal(reloaded.getState().pendingRequests.find(t => t.id === 'durable-task').status, 'resolved');
  assert.ok(reloaded.getState().conversations.find(c => c.id === 'durable-conv').messages.some(m => m.requestId === 'durable-task'));
  assert.equal(reloaded.getState().ordersByTenant.andina.find(o => o.id === 'durable-order').version, 8);
  const recoveredVault = new SecretVault({ store: reloaded, encryptionKey });
  assert.ok(recoveredVault.readSecret(googleRef) === googleToken);
  assert.ok(recoveredVault.readSecret(whatsappRef) === whatsappToken);
  for (const key of ['googleConnectionsByTenant', 'whatsappOnboardingByTenant', 'whatsappCheckpointVersionsByTenant', 'secretsByRef']) {
    assert.deepEqual(reloaded.getState()[key], staleSnapshot[key], `${key} must not be overwritten by operational recovery`);
  }
  await reloaded.save();
  assert.equal((await reloaded.pool.query("SELECT count(*)::int AS n FROM pending_requests WHERE id='gone-task'")).rows[0].n, 0);
  assert.equal((await reloaded.pool.query("SELECT count(*)::int AS n FROM conversations WHERE id='gone-conv'")).rows[0].n, 0);
  assert.equal((await reloaded.pool.query("SELECT count(*)::int AS n FROM orders WHERE id='gone-order'")).rows[0].n, 0);
  const finalStore = await open();
  assert.equal(finalStore.getState().pendingRequests.find(t => t.id === 'durable-task').status, 'resolved');
  console.log('PASS delivery order recovered/versioned; second restart and subsequent save retain decisions/deletions and encrypted Google/WhatsApp');

  // An empty authoritative table is not permission to fall back to old JSON.
  await finalStore.pool.query('DELETE FROM pending_requests');
  await finalStore.pool.query('DELETE FROM orders');
  await finalStore.pool.query('DELETE FROM conversations');
  const empty = await open();
  assert.deepEqual(empty.getState().pendingRequests, []);
  assert.deepEqual(empty.getState().conversations, []);
  assert.ok(Object.values(empty.getState().ordersByTenant).every(records => records.length === 0));
  await empty.save();
  for (const table of ['pending_requests', 'orders', 'conversations']) {
    assert.equal((await empty.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
  }
  console.log('PASS empty durable tables stay empty across load/save; old snapshot cannot resurrect their rows');
} finally {
  global.fetch = originalFetch;
  try {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    for (const store of stores) {
      pauseSnapshots(store);
      await Promise.allSettled([store.saveQueue, store.snapshotQueue]);
      await store.pool.end(); // Simulate restart without a flush that could hide lost critical writes.
    }
    if (!/^via_ops_restart_[a-f0-9]{16}$/.test(schema)) throw new Error('Invalid disposable test schema');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (publicBefore) assert.deepEqual(await digest('public'), publicBefore, 'all existing public table contents must remain unchanged');
    console.log('PASS disposable schema removed; public tables unchanged; no external HTTP');
  } finally { await admin.end(); }
}
