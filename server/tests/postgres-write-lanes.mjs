import assert from 'node:assert/strict';
import { PostgresStore } from '../store/postgresStore.js';

const store = Object.create(PostgresStore.prototype);
store.state = { revision: 1 };
store.saveQueue = Promise.resolve();
store.snapshotQueue = Promise.resolve();
store.snapshotSaveTimer = null;
store.snapshotSaveDeferred = null;
store.snapshotSaving = false;
store.snapshotDirty = false;

let releaseSnapshot;
const snapshotStarted = new Promise((resolve) => {
  store.save = async () => {
    resolve();
    await new Promise((release) => { releaseSnapshot = release; });
  };
});

store.queueSave();
store.startSnapshotSave();
await snapshotStarted;

const criticalWrite = store.queueWrite(async () => 'persisted', 'critical test write');
assert.equal(await criticalWrite, 'persisted');

releaseSnapshot();
await store.snapshotQueue;

console.log('Postgres write lane contract tests passed');

const incremental = Object.create(PostgresStore.prototype);
incremental.state = { revision: 1 };
incremental.incrementalPersistenceEnabled = true;
incremental.snapshotDirty = false;
incremental.queueSave = () => { throw new Error('incremental mutation must not schedule a snapshot'); };
const telemetry = [];
incremental.telemetry = { record: (...args) => telemetry.push(args) };
incremental.mutate((state) => { state.revision = 2; }, { snapshot: false, domain: 'conversation', operation: 'test-update' });
assert.equal(incremental.state.revision, 2);
assert.equal(telemetry[0]?.[1], 'incremental_mutation');
assert.deepEqual(telemetry[0]?.[2]?.metadata, {
  domain: 'conversation',
  operation: 'test-update',
  snapshotHint: false,
  snapshotScheduled: false,
});

const legacy = Object.create(PostgresStore.prototype);
legacy.state = { revision: 1 };
legacy.incrementalPersistenceEnabled = false;
legacy.queueSave = () => { throw new Error('mutations must never schedule a full snapshot'); };
legacy.deltaCount = 0;
legacy.queueIncrementalStatePatch = (before, after, metadata) => {
  legacy.deltaCount += 1;
  assert.equal(before.revision, 1);
  assert.equal(after.revision, 2);
  assert.deepEqual(metadata, { domain: 'runtime', operation: 'mutate', snapshotHint: true });
};
legacy.mutate((state) => { state.revision = 2; });
assert.equal(legacy.deltaCount, 1, 'a default mutation must persist an incremental delta');

const deltaWriter = Object.create(PostgresStore.prototype);
const queries = [];
const client = {
  query: async (...args) => { queries.push(args); },
  release: () => {},
};
deltaWriter.pool = { connect: async () => client };
deltaWriter.queueWrite = (operation) => operation();
deltaWriter.telemetry = { record: () => {} };
await deltaWriter.queueIncrementalStatePatch(
  { catalogKnowledgeIndexesByTenant: { demo: { catalogVersion: 'old' } }, tools: [{ key: 'a' }] },
  { catalogKnowledgeIndexesByTenant: { demo: { catalogVersion: 'new' } }, tools: [{ key: 'b' }] },
  { domain: 'catalog', operation: 'publish' },
);
const deltaPaths = queries
  .filter(([sql]) => String(sql).includes('jsonb_set'))
  .map(([, params]) => params[0]);
assert.deepEqual(deltaPaths, [['catalogKnowledgeIndexesByTenant', 'demo'], ['tools']]);

console.log('Incremental persistence contract tests passed');
