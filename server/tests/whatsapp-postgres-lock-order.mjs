import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PostgresStore } from '../store/postgresStore.js';
import { SecretVault } from '../services/secretVault.js';

// Run from backend with Node 24; never use a cloud database or the public schema.
const configured = process.env.POSTGRES_TEST_DATABASE_URL
  ?? fs.readFileSync('.env.example', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1].trim();
const url = new URL(configured);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/ventas_ia_dev') {
  throw new Error('This test only accepts the local ventas_ia_dev database');
}
const schema = `via_wa_locks_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({ connectionString: url.href, ssl: false });
const stores = [];
const tenantId = 'andina';
const encryptionKey = crypto.randomBytes(32).toString('hex');
let before;

async function publicDigest() {
  const tables = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const digests = [];
  for (const { tablename } of tables.rows) {
    const quoted = `"${tablename.replaceAll('"', '""')}"`;
    const { rows } = await admin.query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')) AS digest
      FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM public.${quoted} t) rows`);
    digests.push({ table: tablename, ...rows[0] });
  }
  return digests;
}

async function open() {
  const store = new PostgresStore({ databaseUrl: url.href, ssl: 'disable' });
  stores.push(store);
  await store.load();
  return store;
}

function checkpoint(store, name) {
  const token = crypto.randomBytes(32).toString('hex');
  const attemptToken = crypto.randomBytes(32).toString('hex');
  const vault = new SecretVault({ store, encryptionKey });
  const ref = vault.saveSecret({ tenantId, name: 'LOCK_ACCESS_TOKEN', value: token });
  const attemptRef = vault.saveSecret({ tenantId, name: 'LOCK_ATTEMPT_TOKEN', value: attemptToken });
  const onboarding = { tenantId, attempt: { idHash: name, status: 'authorized', tokenRef: attemptRef } };
  store.mutate(state => {
    state.whatsappOnboardingByTenant ??= {};
    state.whatsappOnboardingByTenant[tenantId] = onboarding;
    const tenant = state.tenants.find(t => t.id === tenantId);
    tenant.whatsappNumber = `number-${name}`;
    Object.assign(tenant.config.whatsapp, {
      phoneNumberId: `lock-phone-${name}`, wabaId: `lock-waba-${name}`, accessTokenRef: ref,
    });
  });
  // Drive the snapshot lane explicitly so a background timer cannot mask durability.
  clearTimeout(store.snapshotSaveTimer);
  store.snapshotSaveTimer = null;
  return { token, ref, attemptToken, attemptRef, onboarding, whatsappNumber: `number-${name}`,
    whatsapp: structuredClone(store.getState().tenants.find(t => t.id === tenantId).config.whatsapp) };
}

async function until(predicate, message) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error(message);
}

const settled = promise => promise.then(
  () => 'committed',
  error => error.code ?? error.name,
);

async function blockWriteLane(store) {
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const blocker = store.queueWrite(async () => {
    entered.resolve();
    await resume.promise;
  }, 'checkpoint queue barrier');
  await entered.promise;
  return async () => { resume.resolve(); await blocker; };
}

async function race(holder, onboardingStore, write, name, {
  prepare = () => checkpoint(onboardingStore, name),
  compete = () => onboardingStore.persistWhatsAppOnboarding(tenantId),
  outcomes = ['committed', 'committed'],
} = {}) {
  const resume = Promise.withResolvers();
  const originals = new Map([...new Set([holder.pool, onboardingStore.pool])].map(pool => [pool, pool.connect]));
  const operations = [];
  let connections = 0;
  let holderPid;
  let onboardingPid;
  let locked = false;
  try {
    for (const [pool, connect] of originals) {
      pool.connect = async () => {
        const client = await connect.call(pool);
        if (connections++ === 0) {
          holderPid = client.processID;
          const query = client.query;
          const release = client.release;
          client.query = async (...args) => {
            const result = await query.apply(client, args);
            if (/SELECT .*FROM app_state.*FOR UPDATE/i.test(args[0])) {
              // Pause only after PostgreSQL has acquired the actual runtime row lock.
              locked = true;
              await resume.promise;
            }
            return result;
          };
          client.release = (...args) => {
            client.query = query;
            client.release = release;
            return release.apply(client, args);
          };
        } else {
          onboardingPid = client.processID;
        }
        return client;
      };
    }
    operations.push(settled(write()));
    await until(() => locked, `${name}: runtime lock was not acquired`);
    const expected = prepare();
    operations.push(settled(compete()));
    await until(async () => {
      if (!onboardingPid) return false;
      const { rows } = await admin.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked', [holderPid, onboardingPid]);
      return rows[0].blocked;
    }, `${name}: onboarding did not wait for the runtime transaction`);
    // Before the fix, onboarding already owns tenants here; resuming the holder
    // creates a real cycle, resolved by PostgreSQL with 40P01. Afterwards it
    // waits on app_state first and both transactions commit in the same order.
    resume.resolve();
    const results = await Promise.all(operations);
    assert.deepEqual(results, outcomes, `${name}: unexpected transaction outcomes (40P01 is a lock inversion)`);
    console.log(`PASS ${name}: PostgreSQL lock contention observed; ${results.join(', ')}`);
    return expected;
  } finally {
    resume.resolve();
    await Promise.all(operations);
    for (const [pool, connect] of originals) pool.connect = connect;
  }
}

async function verifyCheckpoint(store, expected, { versioned = true } = {}) {
  const document = (await store.pool.query("SELECT document FROM app_state WHERE id='runtime'")).rows[0].document;
  assert.deepEqual(document.whatsappOnboardingByTenant[tenantId], expected.onboarding);
  assert.deepEqual(document.tenants.find(t => t.id === tenantId).config.whatsapp, expected.whatsapp);
  assert.equal(document.tenants.find(t => t.id === tenantId).whatsappNumber, expected.whatsappNumber);
  for (const [ref, token] of [[expected.ref, expected.token], [expected.attemptRef, expected.attemptToken]]) {
    assert.equal(document.secretsByRef[ref].algorithm, 'aes-256-gcm');
    assert.ok(document.secretsByRef[ref].ciphertext);
    assert.equal(JSON.stringify(document).includes(token), false, 'runtime must not contain plaintext credentials');
  }
  const tenant = (await store.pool.query('SELECT payload FROM tenants WHERE id=$1', [tenantId])).rows[0].payload;
  const binding = (await store.pool.query('SELECT payload FROM whatsapp_bindings WHERE tenant_id=$1', [tenantId])).rows[0].payload;
  assert.deepEqual(tenant.config.whatsapp, expected.whatsapp);
  assert.equal(tenant.whatsappNumber, expected.whatsappNumber);
  assert.deepEqual(binding, expected.whatsapp);
  assert.equal(JSON.stringify([tenant, binding]).includes(expected.token), false);
  // Reopen without flushing the writer: a later full snapshot must not rescue a lost checkpoint.
  const restarted = await open();
  assert.deepEqual(restarted.getState().whatsappOnboardingByTenant[tenantId], expected.onboarding);
  if (versioned) {
    assert.ok(Number.isSafeInteger(document.whatsappCheckpointVersionsByTenant?.[tenantId]));
    assert.ok(document.whatsappCheckpointVersionsByTenant[tenantId] > 0);
  }
  assert.equal(restarted.getState().whatsappCheckpointVersionsByTenant?.[tenantId], document.whatsappCheckpointVersionsByTenant?.[tenantId]);
  assert.ok(new SecretVault({ store: restarted, encryptionKey }).readSecret(expected.ref) === expected.token,
    'encrypted binding credential must survive restart');
  assert.ok(new SecretVault({ store: restarted, encryptionKey }).readSecret(expected.attemptRef) === expected.attemptToken,
    'encrypted onboarding credential must survive restart independently of the binding');
  console.log('PASS durable onboarding, tenant/binding mirrors and encrypted credential across restart without flush');
}

function withoutWhatsApp(tenant) {
  const result = JSON.parse(JSON.stringify(tenant));
  delete result.whatsappNumber;
  delete result.config.whatsapp;
  return result;
}

async function runtime(store) {
  return (await store.pool.query("SELECT document FROM app_state WHERE id='runtime'")).rows[0].document;
}

async function verifyOtherTenantFields(store, expected) {
  const document = await runtime(store);
  const mirror = (await store.pool.query('SELECT payload FROM tenants WHERE id=$1', [tenantId])).rows[0].payload;
  assert.deepEqual(withoutWhatsApp(document.tenants.find(t => t.id === tenantId)), expected);
  assert.deepEqual(withoutWhatsApp(mirror), expected);
}

try {
  before = await publicDigest();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema} -c statement_timeout=15000 -c lock_timeout=10000`);
  const store = await open();
  // Upgrade a real pre-version checkpoint, including encrypted credentials.
  // A snapshot loaded before the upgrade must retain both the new WhatsApp
  // checkpoint and a Google grant reconnected independently in the meantime.
  const legacy = checkpoint(store, 'legacy-unversioned');
  await store.save();
  assert.equal((await runtime(store)).whatsappCheckpointVersionsByTenant, undefined);
  await verifyCheckpoint(store, legacy, { versioned: false });
  const legacySnapshot = await open();
  const googleToken = crypto.randomBytes(32).toString('hex');
  const recoveredRef = new SecretVault({ store, encryptionKey }).saveSecret({ tenantId, name: 'LOCK_GOOGLE_RECOVERED', value: googleToken });
  const recoveredGoogle = { tenantId, status: 'connected', mode: 'live', accountEmail: 'recovered@example.test',
    refreshTokenRef: recoveredRef, connectedAt: '2028-01-01T00:00:00.000Z' };
  store.getState().googleConnectionsByTenant[tenantId] = recoveredGoogle;
  const recoveredTenant = store.getState().tenants.find(t => t.id === tenantId);
  recoveredTenant.config.googleOAuth = { status: 'connected', mode: 'live', accountEmail: recoveredGoogle.accountEmail, refreshTokenRef: recoveredRef };
  recoveredTenant.config.googleSheets.refreshTokenRef = recoveredRef;
  recoveredTenant.config.googleDrive.refreshTokenRef = recoveredRef;
  recoveredTenant.lifecycle.googleStatus = 'connected';
  await store.persistTenantCritical(tenantId);
  const upgraded = checkpoint(store, 'first-versioned');
  await race(store, legacySnapshot, () => store.persistWhatsAppOnboarding(tenantId), 'legacy-upgrade', {
    prepare: () => upgraded,
    compete: () => legacySnapshot.queueSnapshotWrite(() => legacySnapshot.save(), 'legacy snapshot regression'),
  });
  await verifyCheckpoint(legacySnapshot, upgraded);
  assert.equal((await runtime(store)).whatsappCheckpointVersionsByTenant[tenantId], 1);
  const recovered = await open();
  assert.deepEqual(recovered.getState().googleConnectionsByTenant[tenantId], recoveredGoogle);
  assert.equal(recovered.getState().tenants.find(t => t.id === tenantId).config.googleOAuth.refreshTokenRef, recoveredRef);
  assert.ok(new SecretVault({ store: recovered, encryptionKey }).readSecret(recoveredRef) === googleToken,
    'Google must remain reconnected, with its encrypted grant, across the WhatsApp upgrade and stale snapshot');
  console.log('PASS unversioned checkpoint upgrades to version 1; reconnected Google survives stale snapshot/restart');

  const expected = await race(store, store,
    () => store.queueSnapshotWrite(() => store.save(), 'lock regression snapshot'), 'snapshot');
  await verifyCheckpoint(store, expected);
  // Critical writes share one queue per instance, but can race across instances.
  const peer = await open();
  const criticalExpected = await race(peer, store,
    () => peer.persistTenantCritical(tenantId), 'tenant-critical');
  await verifyCheckpoint(store, criticalExpected);

  const stale = await open();
  const snapshotTenant = stale.getState().tenants.find(t => t.id === tenantId);
  snapshotTenant.status = 'active';
  Object.assign(snapshotTenant.lifecycle, { activationStatus: 'active', access: 'active', activatedAt: '2026-11-03T19:00:00.000Z' });
  snapshotTenant.config.googleDrive.rootFolderId = 'snapshot-local-google-folder';
  const snapshotOtherFields = withoutWhatsApp(snapshotTenant);
  const newer = checkpoint(store, 'newer-durable');
  const previousVersion = store.getState().whatsappCheckpointVersionsByTenant[tenantId];
  await race(store, stale, () => store.persistWhatsAppOnboarding(tenantId), 'stale-snapshot', {
    prepare: () => {
      assert.equal(store.getState().whatsappCheckpointVersionsByTenant[tenantId], previousVersion,
        'the next version must not be published before commit');
      return newer;
    },
    compete: () => stale.queueSnapshotWrite(() => stale.save(), 'stale snapshot regression'),
  });
  await verifyCheckpoint(stale, newer);
  assert.equal(stale.getState().whatsappCheckpointVersionsByTenant[tenantId], previousVersion + 1);
  assert.deepEqual(stale.getState().whatsappOnboardingByTenant[tenantId], newer.onboarding,
    'save must reconcile both its frozen snapshot and the live state');
  await verifyOtherTenantFields(stale, snapshotOtherFields);
  console.log('PASS WhatsApp merge preserves local activation and Google fields');

  // Both instances start at the same epoch. The loser must read again after its
  // lock wait, before capturing onboarding/binding/secrets or allocating a version.
  const olderWriter = await open();
  const revocation = { accountEvent: 'PARTNER_REMOVED', accountEventAt: '2030-01-01T01:00:00.000Z', accessRevokedAt: '2030-01-01T01:00:00.000Z' };
  const revoke = () => {
    olderWriter.mutate(state => Object.assign(state.tenants.find(t => t.id === tenantId).config.whatsapp, revocation));
    clearTimeout(olderWriter.snapshotSaveTimer);
    olderWriter.snapshotSaveTimer = null;
  };
  revoke();
  const newest = checkpoint(stale, 'latest-connection');
  const versionBeforeWriters = stale.getState().whatsappCheckpointVersionsByTenant[tenantId];
  await race(stale, olderWriter, () => stale.persistWhatsAppOnboarding(tenantId), 'stale-onboarding', {
    prepare: () => newest,
    outcomes: ['committed', 'whatsapp_checkpoint_conflict'],
    compete: () => olderWriter.persistWhatsAppOnboarding(tenantId).catch(error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.retryable, true);
      throw error;
    }),
  });
  await verifyCheckpoint(olderWriter, newest);
  assert.deepEqual(olderWriter.getState().whatsappOnboardingByTenant[tenantId], newest.onboarding);
  assert.equal(stale.getState().whatsappCheckpointVersionsByTenant[tenantId], versionBeforeWriters + 1);
  assert.equal(olderWriter.getState().whatsappCheckpointVersionsByTenant[tenantId], versionBeforeWriters + 1);
  assert.equal((await runtime(olderWriter)).whatsappCheckpointVersionsByTenant[tenantId], versionBeforeWriters + 1,
    'a rejected stale write must not allocate another durable version');
  assert.ok(new SecretVault({ store: olderWriter, encryptionKey }).readSecret(newest.ref) === newest.token,
    'conflict reconciliation must refresh the live encrypted binding credential');
  revoke();
  await olderWriter.persistWhatsAppOnboarding(tenantId);
  const revoked = { ...newest, whatsapp: { ...newest.whatsapp, ...revocation } };
  await verifyCheckpoint(olderWriter, revoked);
  assert.equal(olderWriter.getState().whatsappCheckpointVersionsByTenant[tenantId], versionBeforeWriters + 2);
  console.log('PASS explicit retryable 409, no version advance on conflict; revocation retry preserves fresh secrets');

  const identical = await open();
  await olderWriter.persistWhatsAppOnboarding(tenantId);
  const beforeAdoption = await runtime(identical);
  const identicalTenant = identical.getState().tenants.find(t => t.id === tenantId);
  identicalTenant.config.whatsapp = Object.fromEntries(Object.entries(identicalTenant.config.whatsapp).reverse());
  identicalTenant.config.googleDrive.rootFolderId = 'unrelated-local-edit';
  await identical.persistWhatsAppOnboarding(tenantId);
  assert.deepEqual(await runtime(identical), beforeAdoption, 'identical stale payload must adopt without writing or advancing the version');
  assert.equal(identical.getState().whatsappCheckpointVersionsByTenant[tenantId], beforeAdoption.whatsappCheckpointVersionsByTenant[tenantId]);
  assert.equal(identicalTenant.config.googleDrive.rootFolderId, 'unrelated-local-edit');
  console.log('PASS identical stale payload adopts the durable version regardless of JSON key order or unrelated edits');
  // Even an old critical tenant write must not revert the binding mirror.
  await store.persistTenantCritical(tenantId);
  await verifyCheckpoint(store, revoked);
  console.log('PASS stale onboarding/critical writers retain the latest connection and monotonic versions');

  const queued = await open();
  const remote = await open();
  Object.assign(queued.getState().tenants.find(t => t.id === tenantId).config.whatsapp, revocation, { accountEventAt: '2031-01-01T00:00:00.000Z' });
  const queuedVersion = queued.getState().whatsappCheckpointVersionsByTenant[tenantId];
  const releaseQueue = await blockWriteLane(queued);
  const queuedResult = queued.persistWhatsAppOnboarding(tenantId).then(() => null, error => error);
  let remoteCheckpoint;
  try {
    remoteCheckpoint = checkpoint(remote, 'queued-newer');
    await remote.persistWhatsAppOnboarding(tenantId);
    // The independent snapshot lane replaces live state while the checkpoint
    // waits behind another write. Its call-time intent must still conflict.
    await queued.queueSnapshotWrite(() => queued.save(), 'snapshot ahead of queued checkpoint');
    assert.deepEqual(queued.getState().tenants.find(t => t.id === tenantId).config.whatsapp, remoteCheckpoint.whatsapp);
  } finally { await releaseQueue(); }
  const queuedError = await queuedResult;
  assert.equal(queuedError?.code, 'whatsapp_checkpoint_conflict', 'a live-state merge must not turn the queued revocation into silent success');
  assert.equal(queuedError.statusCode, 409);
  assert.equal(queuedError.retryable, true);
  assert.equal((await runtime(queued)).whatsappCheckpointVersionsByTenant[tenantId], queuedVersion + 1);
  await verifyCheckpoint(queued, remoteCheckpoint);
  Object.assign(queued.getState().tenants.find(t => t.id === tenantId).config.whatsapp, revocation);
  await queued.persistWhatsAppOnboarding(tenantId);
  await verifyCheckpoint(queued, { ...remoteCheckpoint, whatsapp: { ...remoteCheckpoint.whatsapp, ...revocation } });
  console.log('PASS checkpoint queued behind another write retains its intent across a stale snapshot; explicit conflict and revocation retry');

  const changing = await open();
  const changingVersion = changing.getState().whatsappCheckpointVersionsByTenant[tenantId];
  const captured = checkpoint(changing, 'captured-at-call');
  const releaseChanging = await blockWriteLane(changing);
  const capturedResult = changing.persistWhatsAppOnboarding(tenantId).then(() => null, error => error);
  let later;
  try { later = checkpoint(changing, 'later-local-mutation'); }
  finally { await releaseChanging(); }
  assert.equal(await capturedResult, null);
  await verifyCheckpoint(changing, captured);
  assert.deepEqual(changing.getState().whatsappOnboardingByTenant[tenantId], later.onboarding);
  assert.ok(new SecretVault({ store: changing, encryptionKey }).readSecret(later.ref) === later.token);
  assert.equal(changing.getState().whatsappCheckpointVersionsByTenant[tenantId], changingVersion,
    'a commit must not label a different live mutation as the committed checkpoint');
  const concurrentConflict = changing.persistWhatsAppOnboarding(tenantId).then(() => null, error => error);
  const latestLocal = checkpoint(changing, 'mutation-after-conflicting-call');
  assert.equal((await concurrentConflict)?.code, 'whatsapp_checkpoint_conflict');
  assert.deepEqual(changing.getState().whatsappOnboardingByTenant[tenantId], latestLocal.onboarding,
    'conflict reconciliation must not erase mutations made after the call');
  assert.ok(new SecretVault({ store: changing, encryptionKey }).readSecret(latestLocal.ref) === latestLocal.token);
  assert.equal(changing.getState().whatsappCheckpointVersionsByTenant[tenantId], changingVersion);
  await verifyCheckpoint(changing, captured);
  console.log('PASS immutable call-time payload persists; commit/conflict leave subsequent live mutations and their secrets untouched');

  // Keep a WhatsApp writer behind newer activation/Google data, including a
  // rotated secret with the same reference that is NOT part of WhatsApp.
  const whatsappOnly = await open();
  const googleWriter = await open();
  const oldVault = new SecretVault({ store: whatsappOnly, encryptionKey });
  const googleVault = new SecretVault({ store: googleWriter, encryptionKey });
  const googleRef = oldVault.saveSecret({ tenantId, name: 'LOCK_GOOGLE', value: crypto.randomBytes(32).toString('hex') });
  googleVault.saveSecret({ tenantId, name: 'LOCK_GOOGLE', value: crypto.randomBytes(32).toString('hex') });
  const googleState = googleWriter.getState();
  const googleTenant = googleState.tenants.find(t => t.id === tenantId);
  googleTenant.status = 'active';
  Object.assign(googleTenant.lifecycle, { activationStatus: 'active', access: 'active', googleStatus: 'connected' });
  const googleConnection = { tenantId, status: 'connected', mode: 'live', refreshTokenRef: googleRef,
    accountEmail: 'lock-contract@example.test', connectedAt: '2030-01-01T00:00:00.000Z' };
  googleState.googleConnectionsByTenant[tenantId] = googleConnection;
  googleTenant.config.googleOAuth = structuredClone(googleConnection);
  googleTenant.config.googleSheets.refreshTokenRef = googleRef;
  googleTenant.config.googleDrive.refreshTokenRef = googleRef;
  await googleWriter.save();
  clearTimeout(googleWriter.snapshotSaveTimer);
  googleWriter.snapshotSaveTimer = null;
  const savedOtherFields = withoutWhatsApp((await runtime(googleWriter)).tenants.find(t => t.id === tenantId));
  const savedGoogleSecret = structuredClone(googleState.secretsByRef[googleRef]);
  const scoped = checkpoint(whatsappOnly, 'whatsapp-only');
  await whatsappOnly.persistWhatsAppOnboarding(tenantId);
  await verifyCheckpoint(whatsappOnly, scoped);
  await verifyOtherTenantFields(whatsappOnly, savedOtherFields);
  const scopedDocument = await runtime(whatsappOnly);
  assert.deepEqual(scopedDocument.googleConnectionsByTenant[tenantId], googleConnection);
  assert.ok(scopedDocument.secretsByRef[googleRef].ciphertext === savedGoogleSecret.ciphertext,
    'WhatsApp must not replay an older unreferenced Google secret');
  console.log('PASS WhatsApp checkpoint leaves newer activation, Google and unrelated secrets intact');

  await googleWriter.persistWhatsAppOnboarding('norte');
  const perTenantDocument = await runtime(googleWriter);
  assert.equal(perTenantDocument.whatsappCheckpointVersionsByTenant.norte, 1);
  assert.equal(perTenantDocument.whatsappCheckpointVersionsByTenant[tenantId], scopedDocument.whatsappCheckpointVersionsByTenant[tenantId]);
  await verifyCheckpoint(googleWriter, scoped);
  console.log('PASS checkpoint versions and writes are isolated per tenant');

  const rollback = await open();
  const committedVersion = rollback.getState().whatsappCheckpointVersionsByTenant[tenantId];
  checkpoint(rollback, 'rollback');
  const collisionPhone = rollback.getState().tenants.find(t => t.id === 'norte').config.whatsapp.phoneNumberId;
  rollback.getState().tenants.find(t => t.id === tenantId).config.whatsapp.phoneNumberId = collisionPhone;
  await assert.rejects(rollback.persistWhatsAppOnboarding(tenantId), error => error.code === '23505');
  assert.equal(rollback.getState().whatsappCheckpointVersionsByTenant[tenantId], committedVersion);
  assert.equal((await runtime(rollback)).whatsappCheckpointVersionsByTenant[tenantId], committedVersion);
  await verifyCheckpoint(rollback, scoped);
  console.log('PASS rolled-back checkpoint does not advance the durable or in-memory version');
} finally {
  try {
    for (const store of stores) {
      clearTimeout(store.snapshotSaveTimer);
      await Promise.allSettled([store.saveQueue, store.snapshotQueue]);
      await store.pool.end();
    }
    if (!/^via_wa_locks_[a-f0-9]{16}$/.test(schema)) throw new Error('Invalid disposable test schema');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (before) {
      assert.deepEqual(await publicDigest(), before, 'all existing public tables must remain unchanged');
      console.log('PASS disposable schema removed; all public table contents unchanged');
    }
  } finally {
    await admin.end();
  }
}
