import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-batch-lease-'));
const store = new JsonStore(path.join(tempDir, 'store.json'));
store.load();

try {
  assert.equal(store.acquireInboundBatchLease('andina:phone:57300', { ownerId: 'worker-a', leaseMs: 5_000 }), true);
  assert.equal(store.acquireInboundBatchLease('andina:phone:57300', { ownerId: 'worker-a', leaseMs: 5_000 }), true);
  assert.equal(store.acquireInboundBatchLease('andina:phone:57300', { ownerId: 'worker-b', leaseMs: 5_000 }), false);
  assert.equal(store.releaseInboundBatchLease('andina:phone:57300', { ownerId: 'worker-b' }), true);
  assert.equal(store.acquireInboundBatchLease('andina:phone:57300', { ownerId: 'worker-b', leaseMs: 5_000 }), false);
  assert.equal(store.releaseInboundBatchLease('andina:phone:57300', { ownerId: 'worker-a' }), true);
  assert.equal(store.acquireInboundBatchLease('andina:phone:57300', { ownerId: 'worker-b', leaseMs: 5_000 }), true);
  console.log('Inbound batch lease contract tests passed');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
