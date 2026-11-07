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
  snapshotScheduled: false,
});

const legacy = Object.create(PostgresStore.prototype);
legacy.state = { revision: 1 };
legacy.incrementalPersistenceEnabled = false;
legacy.snapshotCount = 0;
legacy.queueSave = () => { legacy.snapshotCount += 1; };
legacy.mutate((state) => { state.revision = 2; }, { snapshot: false, domain: 'conversation' });
assert.equal(legacy.snapshotCount, 1, 'the feature flag must keep legacy snapshot behavior until enabled');

console.log('Incremental persistence feature flag contract tests passed');
