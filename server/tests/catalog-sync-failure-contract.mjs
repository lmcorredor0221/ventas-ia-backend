import assert from 'node:assert/strict';
import { CatalogSyncWorker } from '../services/catalogSyncWorker.js';

const worker = new CatalogSyncWorker({
  store: { getTenant: async () => ({ id: 'demo' }) },
  tools: { liveGoogleContext: async () => null },
  config: { catalogSyncMode: 'on_demand', catalogSyncWorkerEnabled: false },
  events: { emit: () => {} },
});

const result = await worker.syncTenant('demo', 'test');
assert.equal(result.status, 'skipped');
assert.equal(result.code, 'google_unavailable');
assert.match(result.message, /Google Sheets/i);
console.log('catalog-sync-failure-contract: ok');
