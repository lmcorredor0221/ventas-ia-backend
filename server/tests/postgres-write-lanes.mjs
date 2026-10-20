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
