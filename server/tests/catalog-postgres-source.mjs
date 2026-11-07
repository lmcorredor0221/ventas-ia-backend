import assert from 'node:assert/strict';
import { ToolRegistry } from '../services/toolRegistry.js';
import { buildCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';

const products = [
  {
    sku: 'COKE-15-ORIG',
    name: 'Coca-Cola original',
    brand: 'Coca-Cola',
    category: 'gaseosas',
    presentation: '1.5 L',
    normalizedPresentation: '1500 ml',
    productFamily: 'Coca-Cola',
    price: 7200,
    stock: 8,
    attributes: { variante: 'Original' },
    active: true,
  },
  {
    sku: 'COKE-15-ZERO',
    name: 'Coca-Cola sin azúcar',
    brand: 'Coca-Cola',
    category: 'gaseosas',
    presentation: '1.5 L',
    normalizedPresentation: '1500 ml',
    productFamily: 'Coca-Cola',
    price: 7200,
    stock: 6,
    attributes: { variante: 'Zero' },
    active: true,
  },
];

const index = buildCatalogKnowledgeIndex({
  tenantId: 'demo',
  rows: products,
  sourceRef: 'sheet-demo',
  range: 'Catalogo!A1:P1000',
});

const state = {
  tenants: [{ id: 'demo', config: { catalog: { readSource: 'postgres' }, googleSheets: { range: 'Catalogo!A1:H1000', catalogRange: 'Catalogo!A1:P1000' } } }],
  conversations: [],
};
let googleReads = 0;
const store = {
  getState: () => state,
  getPublishedCatalogKnowledgeIndex: async () => index,
  listProducts: async () => products,
};
const tools = new ToolRegistry({
  store,
  config: { catalogReadSource: 'google', catalogKnowledgeIndexEnabled: true, allowLocalCatalogFallback: false },
  events: { emit: () => {} },
  googleWorkspace: { readValues: async () => { googleReads += 1; return []; } },
});
tools.liveGoogleContext = async () => { throw new Error('PostgreSQL mode must not ask Google for the catalog'); };

const result = await tools.googleSheetsReadTable('demo', {
  query: 'Coca-Cola litro y medio',
  filters: { presentation: '1.5 L' },
});

assert.equal(result.status, 'success');
assert.equal(result.source, 'postgres_catalog');
assert.equal(result.source_range, 'Catalogo!A1:P1000');
assert.equal(result.source_row_count, 2);
assert.equal(googleReads, 0);
assert.deepEqual(result.rows.map((row) => row.sku).sort(), ['COKE-15-ORIG', 'COKE-15-ZERO']);

console.log('catalog-postgres-source: ok');
