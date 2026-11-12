import assert from 'node:assert/strict';
import { ToolRegistry } from '../services/toolRegistry.js';

const nativeRows = [
  {
    sku: 'COKE-15-ORIG',
    name: 'Coca-Cola original',
    brand: 'Coca-Cola',
    category: 'gaseosas',
    presentation: '1.5 L',
    productFamily: 'Coca-Cola',
    price: 7200,
    stock: 8,
    active: true,
  },
];
const metadata = {
  available: true,
  tenantId: 'demo',
  catalogVersion: 'catalog-native-v1',
  rowCount: 3000,
  projectionRowCount: 3000,
};
const state = {
  tenants: [{ id: 'demo', config: { catalog: { readSource: 'postgres' } } }],
  conversations: [],
};
let legacyDocumentReads = 0;
let nativeSearches = 0;
let nativePages = 0;
const store = {
  getState: () => state,
  getPublishedCatalogNativeSearchMetadata: async () => metadata,
  searchPublishedCatalogNative: async (_tenantId, payload) => {
    nativeSearches += 1;
    assert.equal(payload.query, 'Coca-Cola litro y medio');
    return {
      available: true,
      metadata,
      rows: nativeRows,
      relations: [],
      retrieval: { provider: 'postgres_fts_trgm_relations', directCandidateCount: 1, graphCandidateCount: 1 },
    };
  },
  pagePublishedCatalogNative: async () => {
    nativePages += 1;
    return {
      available: true,
      metadata,
      rows: nativeRows,
      totalCount: 3000,
      returnedCount: 1,
      nextCursor: 'next-page',
      retrieval: { provider: 'postgres_fts_trgm_relations' },
    };
  },
  getPublishedCatalogProductsBySkus: async (_tenantId, skus) => ({
    available: true,
    metadata,
    rows: nativeRows.filter((row) => skus.includes(row.sku)),
  }),
  getPublishedCatalogKnowledgeIndex: async () => {
    legacyDocumentReads += 1;
    throw new Error('The native route must not hydrate the immutable JSON catalog.');
  },
};
const tools = new ToolRegistry({
  store,
  config: {
    catalogReadSource: 'postgres',
    catalogKnowledgeIndexEnabled: true,
    catalogNativeSearchEnabled: true,
    catalogNativeSearchCandidateLimit: 40,
    allowLocalCatalogFallback: false,
  },
  events: { emit: () => {} },
});
tools.liveGoogleContext = async () => { throw new Error('PostgreSQL operational reads must not reach Google.'); };

const search = await tools.googleSheetsReadTable('demo', {
  query: 'Coca-Cola litro y medio',
  retrievalHints: { productFamily: 'Coca-Cola' },
});
assert.equal(search.source, 'postgres_native_catalog');
assert.equal(search.catalog_version, 'catalog-native-v1');
assert.deepEqual(search.rows.map((row) => row.sku), ['COKE-15-ORIG']);
assert.equal(nativeSearches, 1);
assert.equal(legacyDocumentReads, 0);

const page = await tools.googleSheetsReadTable('demo', {
  purpose: 'manual_order_catalog',
  query: 'coca cola',
  limit: 25,
});
assert.equal(page.source, 'postgres_native_catalog');
assert.equal(page.pagination.totalCount, 3000);
assert.equal(page.pagination.nextCursor, 'next-page');
assert.equal(nativePages, 1);
assert.equal(legacyDocumentReads, 0);

const selected = await tools.googleSheetsReadTable('demo', {
  purpose: 'manual_order_catalog',
  skus: ['COKE-15-ORIG'],
});
assert.deepEqual(selected.rows.map((row) => row.sku), ['COKE-15-ORIG']);
assert.equal(legacyDocumentReads, 0);

console.log('catalog-native-tool-routing: native PostgreSQL reads avoid full snapshot hydration');
