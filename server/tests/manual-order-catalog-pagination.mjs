import assert from 'node:assert/strict';
import { buildCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';
import { ToolRegistry } from '../services/toolRegistry.js';
import { ManualOrderService } from '../services/manualOrderService.js';

const products = Array.from({ length: 64 }, (_, index) => ({
  sku: `SKU-${String(index + 1).padStart(3, '0')}`,
  name: index >= 60 ? `Ponque Chocoramo ${index - 59}` : `Producto ${String(index + 1).padStart(3, '0')}`,
  brand: index >= 60 ? 'Ramo' : 'Marca',
  productFamily: index >= 60 ? 'Chocoramo' : `Familia ${index + 1}`,
  presentation: 'Unidad', category: 'alimentos', price: 1000 + index, stock: 10, active: true,
}));
const index = buildCatalogKnowledgeIndex({ tenantId: 'shop', rows: products, sourceRef: 'sheet-shop', range: 'Catalogo!A1:Q1000' });
let publishedIndex = index;
const state = {
  tenants: [{ id: 'shop', config: { catalog: { readSource: 'postgres' } } }],
  conversations: [{ id: 'manual-1', tenantId: 'shop', waId: 'buyer', status: 'manual_active', manualMode: 'whatsapp_external', messages: [] }],
  ordersByTenant: {}, customerProfilesByTenant: {},
};
let documentReads = 0;
const store = {
  getState: () => state,
  getPublishedCatalogKnowledgeIndexMetadata: async () => ({
    tenantId: 'shop', catalogVersion: publishedIndex.catalogVersion, sourceHash: publishedIndex.sourceHash,
    rowCount: publishedIndex.rowCount, publishedAt: publishedIndex.syncedAt,
  }),
  getPublishedCatalogKnowledgeIndex: async () => { documentReads += 1; return publishedIndex; },
};
const tools = new ToolRegistry({
  store,
  config: { catalogReadSource: 'postgres', catalogKnowledgeIndexEnabled: true, allowLocalCatalogFallback: false },
  events: { emit: () => {} },
});
const service = new ManualOrderService({ store, tools, usage: {}, events: {}, outbox: null });

const first = await service.context('shop', 'manual-1');
assert.equal(first.products.length, 25, 'El contexto inicial no debe transferir el catálogo completo');
assert.equal(first.catalog.totalCount, 64);
assert.equal(first.catalog.returnedCount, 25);
assert.ok(first.catalog.nextCursor, 'La primera página debe permitir continuar');

const second = await service.context('shop', 'manual-1', { cursor: first.catalog.nextCursor });
assert.equal(second.products.length, 25);
assert.notEqual(second.products[0].sku, first.products[0].sku, 'El cursor debe avanzar a productos distintos');
assert.equal(documentReads, 1, 'Dos lecturas de la misma versión deben reutilizar el índice en memoria');

const searched = await service.context('shop', 'manual-1', { query: 'chocoramo', limit: 50 });
assert.equal(searched.catalog.totalCount, 4);
assert.ok(searched.products.every((product) => product.name.toLowerCase().includes('chocoramo')));

const selected = await tools.googleSheetsReadTable('shop', {
  purpose: 'manual_order_catalog',
  skus: ['SKU-002', 'SKU-063'],
});
assert.deepEqual(selected.rows.map((product) => product.sku), ['SKU-002', 'SKU-063'], 'La confirmación debe recargar solo los SKU seleccionados');
assert.equal(selected.pagination, null);

const replacement = buildCatalogKnowledgeIndex({
  tenantId: 'shop',
  rows: [...products, { sku: 'SKU-065', name: 'Producto nuevo', brand: 'Marca', productFamily: 'Nuevo', presentation: 'Unidad', category: 'alimentos', price: 2000, stock: 5, active: true }],
  sourceRef: 'sheet-shop', range: 'Catalogo!A1:Q1000', previousVersion: index.catalogVersion,
});
publishedIndex = replacement;
const refreshed = await service.context('shop', 'manual-1');
assert.equal(refreshed.catalog.catalogVersion, replacement.catalogVersion, 'Una nueva versión debe invalidar la página anterior');
assert.equal(documentReads, 2, 'Una nueva versión debe producir exactamente una nueva carga del documento');
await assert.rejects(
  () => service.context('shop', 'manual-1', { cursor: first.catalog.nextCursor }),
  (error) => error.code === 'catalog_cursor_stale' && error.statusCode === 409,
  'Un cursor de otra versión no puede mezclar páginas de catálogos distintos',
);

let concurrentReads = 0;
const concurrentTools = new ToolRegistry({
  store: {
    ...store,
    getPublishedCatalogKnowledgeIndex: async () => {
      concurrentReads += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return publishedIndex;
    },
  },
  config: { catalogReadSource: 'postgres', catalogKnowledgeIndexEnabled: true, allowLocalCatalogFallback: false },
  events: { emit: () => {} },
});
const concurrentService = new ManualOrderService({ store, tools: concurrentTools, usage: {}, events: {}, outbox: null });
await Promise.all([
  concurrentService.context('shop', 'manual-1'),
  concurrentService.context('shop', 'manual-1'),
]);
assert.equal(concurrentReads, 1, 'Dos lecturas simultáneas de la misma versión deben compartir la carga');

console.log('manual-order-catalog-pagination: versioned cache, pagination and bounded response passed');
