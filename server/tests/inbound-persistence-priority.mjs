import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresStore } from '../store/postgresStore.js';

assert.ok(process.env.POSTGRES_TEST_DATABASE_URL, 'Explicit local test URL required');
const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local only');
const schema = `inbound_priority_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url.toString(), ssl: false });
let store;
const failures = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const message = id => ({ tenantId: 'andina', messageId: id, messageType: 'text', waId: '573000000000', text: 'Prueba local' });
const test = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } };
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new PostgresStore({ databaseUrl: url.toString(), ssl: 'disable' });
  await store.load();
  await test('Durable inbound receipt is independent of a blocked snapshot queue', async () => {
    let release, entered;
    const barrier = new Promise(r => { release = r; });
    const started = new Promise(r => { entered = r; });
    const snapshot = store.queueWrite(async () => { entered(); await barrier; }, 'controlled snapshot');
    await started;
    const enqueue = store.enqueueInboundMessage(message('priority-1'));
    let completed;
    try { completed = await Promise.race([enqueue.then(() => true), pause(500).then(() => false)]); }
    finally { release(); await snapshot; await enqueue; }
    assert.equal(completed, true, 'Inbound was blocked by unrelated snapshot persistence');
    assert.equal((await store.getInboundMessage('priority-1')).status, 'queued');
    assert.equal((await store.listOutbox({ limit: 100 })).filter(x => x.aggregateId === 'priority-1').length, 1);
  });
  await test('Concurrent redelivery creates exactly one inbound and one outbox entry', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => store.enqueueInboundMessage(message('priority-dedup'))));
    assert.equal(results.filter(r => r.created).length, 1);
    assert.equal((await store.listOutbox({ limit: 100 })).filter(x => x.aggregateId === 'priority-dedup').length, 1);
  });
  await test('Outbox failure rolls back inbound before acknowledgment', async () => {
    const connect = store.pool.connect.bind(store.pool);
    store.pool.connect = async () => {
      const client = await connect(); const query = client.query.bind(client);
      client.query = (sql, ...args) => String(sql).includes('INSERT INTO integration_outbox')
        ? Promise.reject(new Error('Injected outbox failure')) : query(sql, ...args);
      const release = client.release.bind(client);
      client.release = (...args) => { client.query = query; client.release = release; return release(...args); };
      return client;
    };
    try { await assert.rejects(store.enqueueInboundMessage(message('priority-rollback')), /Injected outbox failure/); }
    finally { store.pool.connect = connect; }
    assert.equal(await store.getInboundMessage('priority-rollback'), null);
    assert.equal((await store.listOutbox({ limit: 100 })).filter(x => x.aggregateId === 'priority-rollback').length, 0);
  });
  await test('Flush waits for accepted independent writes', async () => {
    if (!store.runInboundWrite) throw Error('Independent inbound write tracking unavailable');
    let release; const barrier = new Promise(r => { release = r; });
    const operation = store.runInboundWrite(() => barrier);
    let completed = false; const flushed = store.flush().then(() => { completed = true; });
    await pause(30); const early = completed; release(); await operation; await flushed;
    assert.equal(early, false); assert.equal(store.inboundWrites.size, 0);
  });
} finally {
  try { await store?.close(); }
  finally {
    if (store && !store.pool.ended) await store.pool.end();
    assert.match(schema, /^inbound_priority_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
  }
}
assert.deepEqual(failures, []);
