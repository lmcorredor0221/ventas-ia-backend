import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { IntegrationOutbox } from '../services/integrationOutbox.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-outbox-'));
try {
  const store = new JsonStore(path.join(tempDir, 'store.json'));
  store.load();
  let handled = 0;
  const outbox = new IntegrationOutbox({
    store,
    config: { integrationOutboxEnabled: true },
    handlers: {
      'test.success': async (entry) => {
        handled += 1;
        return { idempotencyKey: entry.idempotencyKey };
      },
      'test.failure': async () => {
        throw new Error('provider unavailable');
      },
    },
  });

  const first = await outbox.enqueue({ kind: 'test.success', idempotencyKey: 'same-key', payload: { value: 1 } });
  const duplicate = await outbox.enqueue({ kind: 'test.success', idempotencyKey: 'same-key', payload: { value: 2 } });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);

  const drained = await outbox.drain();
  assert.equal(drained.processed, 1);
  assert.equal(handled, 1);
  assert.equal(store.listOutbox({ status: 'processed' }).length, 1);

  await outbox.enqueue({ kind: 'test.failure', idempotencyKey: 'failure-key' });
  await outbox.drain();
  const failed = store.listOutbox({ status: 'retrying' });
  assert.equal(failed.length, 1);
  assert.match(failed[0].lastError, /provider unavailable/);
  console.log('Integration outbox tests passed');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
