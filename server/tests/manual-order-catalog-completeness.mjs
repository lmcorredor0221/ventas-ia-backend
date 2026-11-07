import assert from 'node:assert/strict';
import { ToolRegistry } from '../services/toolRegistry.js';
import { buildCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';

const products = Array.from({ length: 30 }, (_, index) => ({
  sku: `SKU-${String(index + 1).padStart(3, '0')}`,
  name: index === 28 ? 'Ponqué Chocorramo 65 g' : index === 29 ? 'Chocorramo mini 35 g' : `Producto ${index + 1}`,
  brand: index >= 28 ? 'Ramo' : 'Marca',
  productFamily: index >= 28 ? 'Chocorramo' : `Familia ${index + 1}`,
  presentation: index >= 28 ? (index === 28 ? '65 g' : '35 g') : 'Unidad',
  category: 'alimentos',
  price: 1000 + index,
  stock: 10,
  aliases: index >= 28 ? ['chocorramo'] : [],
  active: true,
}));

const index = buildCatalogKnowledgeIndex({
  tenantId: 'demo',
  rows: products,
  sourceRef: 'sheet-demo',
  range: 'Catalogo!A1:Q1000',
});

const state = {
  tenants: [{ id: 'demo', config: { catalog: { readSource: 'postgres' } } }],
};
const store = {
  getState: () => state,
  getPublishedCatalogKnowledgeIndex: async () => index,
};

const tools = new ToolRegistry({
  store,
  config: { catalogReadSource: 'postgres', catalogKnowledgeIndexEnabled: true, allowLocalCatalogFallback: false },
  events: { emit: () => {} },
});

const result = await tools.googleSheetsReadTable('demo', {
  filters: {},
  purpose: 'manual_order_catalog',
});

assert.equal(result.status, 'success');
assert.equal(result.source_row_count, 30);
assert.equal(result.rows.length, 30, 'El flujo manual no debe truncar el catálogo a 25 productos');
assert.deepEqual(result.rows.filter((row) => row.name.toLowerCase().includes('chocorramo')).map((row) => row.sku).sort(), ['SKU-029', 'SKU-030']);

console.log('manual-order-catalog-completeness: ok');
