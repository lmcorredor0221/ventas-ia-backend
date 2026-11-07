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
const index = buildCatalogKnowledgeIndex({
  tenantId: 'demo',
  rows,
  sourceRef: 'sheet-demo',
  range: 'Catalogo!A1:P1000',
});
const store = {
  getTenant: async () => ({ id: 'demo', config: { googleSheets: { catalogRange: 'Catalogo!A1:P1000' } } }),
  persistCatalogSnapshot: async (payload) => calls.push(['snapshot', payload]),
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
  config: { catalogSyncWorkerEnabled: false },
  events: { emit: () => {} },
});
const result = await worker.syncTenant('demo', 'test');

assert.equal(result.status, 'published');
assert.equal(calls[0][0], 'read');
assert.equal(calls[0][1].persist, false);
assert.equal(calls[1][0], 'index');
assert.equal(calls[1][1].persist, false);
assert.equal(calls[2][0], 'snapshot');
assert.equal(calls[2][1].index.catalogVersion, index.catalogVersion);
assert.equal(calls[2][1].products.length, 1);

console.log('catalog-sync-worker: ok');
