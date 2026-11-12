import assert from 'node:assert/strict';
import { CatalogSyncWorker } from '../services/catalogSyncWorker.js';
import { buildCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';

const rows = [{
  sku: 'COKE-15-ORIG',
  name: 'Coca-Cola original',
  brand: 'Coca-Cola',
  category: 'gaseosas',
  presentation: '1.5 L',
  normalizedPresentation: '1500 ml',
  productFamily: 'Coca-Cola',
  price: 7200,
  stock: 8,
  active: true,
}];

const calls = [];
const state = {
  tenants: [{ id: 'demo', config: { googleSheets: { catalogRange: 'Catalogo!A1:P1000' } } }],
};
const index = buildCatalogKnowledgeIndex({
  tenantId: 'demo',
  rows,
  sourceRef: 'sheet-demo',
  range: 'Catalogo!A1:P1000',
});
const store = {
  getState: () => state,
  getTenant: async () => state.tenants[0],
  mutate: (mutator) => mutator(state),
  persistTenantCritical: async (tenantId) => { calls.push(['tenant', tenantId]); },
  persistCatalogSnapshot: async (payload) => { calls.push(['snapshot', payload]); return { status: 'published', catalogVersion: payload.index.catalogVersion }; },
};
const tools = {
  liveGoogleContext: async () => ({ spreadsheetId: 'sheet-demo', accessToken: 'test' }),
  readLiveCatalogRows: async (payload) => {
    calls.push(['read', payload]);
    return rows;
  },
  catalogSearch: {
    sync: async (payload) => {
      calls.push(['index', payload]);
      return index;
    },
  },
};

const worker = new CatalogSyncWorker({
  store,
  tools,
  config: { catalogSyncMode: 'on_demand', catalogSyncWorkerEnabled: true },
  events: { emit: () => {} },
});

worker.start();
assert.equal(worker.timer, null, 'on-demand mode must not start a periodic timer');
const result = await worker.syncTenant('demo', 'test');

assert.equal(result.status, 'published');
assert.equal(calls[0][0], 'read');
assert.equal(calls[0][1].persist, false);
assert.equal(calls[1][0], 'index');
assert.equal(calls[1][1].persist, false);
assert.equal(calls[2][0], 'snapshot');
assert.equal(calls[2][1].index.catalogVersion, index.catalogVersion);
assert.equal(calls[2][1].products.length, 1);
assert.deepEqual(calls[3], ['tenant', 'demo']);
assert.equal(state.tenants[0].config.catalog.readSource, 'postgres');
assert.equal(result.operationalSource, 'postgres');
assert.equal((await worker.getStatus('demo')).mode, 'on_demand');
assert.equal((await worker.getStatus('demo')).scheduled, false);
assert.equal((await worker.getStatus('demo')).lastResult.status, 'published');

const durableWorker = new CatalogSyncWorker({
  store: {
    getState: () => ({}),
    getPublishedCatalogKnowledgeIndex: async () => ({
      status: 'published', catalogVersion: 'durable-v1', rowCount: 2000,
      nodeCount: 2000, relationCount: 4000, vectorCount: 2000, syncedAt: '2026-11-08T20:00:00.000Z',
    }),
  },
  config: { catalogSyncMode: 'on_demand', catalogSyncWorkerEnabled: false },
});
const durableStatus = await durableWorker.getStatus('demo');
assert.equal(durableStatus.published.catalogVersion, 'durable-v1');
assert.equal(durableStatus.published.rowCount, 2000);

await worker.stop();

const nativeCalls = [];
const nativeState = {
  tenants: [{ id: 'native-demo', config: { googleSheets: { catalogRange: 'Catalogo!A1:P1000' } } }],
  catalogKnowledgeIndexesByTenant: { 'native-demo': { catalogVersion: 'stale-in-memory-document' } },
};
const nativeWorker = new CatalogSyncWorker({
  store: {
    getState: () => nativeState,
    getTenant: async () => nativeState.tenants[0],
    getPublishedCatalogKnowledgeIndexMetadata: async () => null,
    mutate: (mutator) => mutator(nativeState),
    persistTenantCritical: async (tenantId) => { nativeCalls.push(['tenant', tenantId]); },
    persistCatalogSnapshot: async (payload) => {
      nativeCalls.push(['snapshot', payload]);
      return {
        status: 'published',
        catalogVersion: payload.index.catalogVersion,
        nativeProjection: { productCount: rows.length, relationCount: 6 },
      };
    },
  },
  tools: {
    liveGoogleContext: async () => ({ spreadsheetId: 'sheet-native-demo', accessToken: 'test' }),
    readLiveCatalogRows: async () => rows,
    catalogSearch: {
      sync: async () => {
        throw new Error('Native publication must not hydrate the legacy in-memory catalog index.');
      },
    },
  },
  config: { catalogSyncMode: 'on_demand', catalogSyncWorkerEnabled: true, catalogNativeSearchEnabled: true },
  events: { emit: () => {} },
});

const nativeResult = await nativeWorker.syncTenant('native-demo', 'test-native');
assert.equal(nativeResult.status, 'published');
assert.equal(nativeResult.nativeProjection, true);
assert.equal(nativeResult.nativeProjectionRows, rows.length);
assert.equal(nativeCalls[0][0], 'snapshot');
assert.equal(nativeState.catalogKnowledgeIndexesByTenant['native-demo'], undefined,
  'A native publication must release an obsolete full in-memory catalog document.');
assert.equal(nativeState.catalogIndexStatusByTenant['native-demo'].nativeProjection, true);
await nativeWorker.stop();

console.log('catalog-sync-worker: ok');
