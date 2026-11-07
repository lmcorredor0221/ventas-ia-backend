import assert from 'node:assert/strict';
import { buildCatalogKnowledgeIndex, searchCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';

const rows = [
  { sku: 'COKE-15-ORIG', name: 'Coca-Cola original', brand: 'Coca-Cola', category: 'gaseosas', presentation: '1.5 L', normalizedPresentation: '1500 ml', productFamily: 'Coca-Cola', price: 7200, stock: 8, aliases: ['coca cola litro y medio'], tags: ['gaseosa'], attributes: { variante: 'Original' }, active: true },
  { sku: 'COKE-15-ZERO', name: 'Coca-Cola sin azúcar', brand: 'Coca-Cola', category: 'gaseosas', presentation: '1.5 L', normalizedPresentation: '1500 ml', productFamily: 'Coca-Cola', price: 7200, stock: 6, aliases: ['coca cola zero'], tags: ['gaseosa'], attributes: { variante: 'Zero' }, active: true },
  { sku: 'COKE-350-ORIG', name: 'Coca-Cola original', brand: 'Coca-Cola', category: 'gaseosas', presentation: '350 ml', normalizedPresentation: '350 ml', productFamily: 'Coca-Cola', price: 2800, stock: 10, aliases: [], tags: ['gaseosa'], attributes: { variante: 'Original' }, active: true },
  { sku: 'CHOC-REG', name: 'Ponqué Chocorramo', brand: 'Ramo', category: 'ponqués', presentation: '65 g', normalizedPresentation: '65 g', productFamily: 'Chocorramo', price: 2800, stock: 4, aliases: ['chocorramo'], tags: [], attributes: {}, active: true },
  { sku: 'CHOC-MINI', name: 'Chocorramo mini', brand: 'Ramo', category: 'ponqués', presentation: '40 g', normalizedPresentation: '40 g', productFamily: 'Chocorramo', price: 1600, stock: 4, aliases: ['chocorramo pequeño'], tags: [], attributes: {}, active: true },
];

const index = buildCatalogKnowledgeIndex({ tenantId: 'tenant-a', rows, sourceRef: 'sheet-a', range: 'Catalogo!A1:P1000' });
assert.equal(index.status, 'published');
assert.equal(index.rowCount, rows.length);
assert.ok(index.catalogVersion);
assert.ok(index.relations.some((relation) => relation.type === 'PRODUCT_ALTERNATIVE_OF'));
assert.equal(index.searchDocuments.length, rows.length);

const exactPresentation = searchCatalogKnowledgeIndex(index, {
  query: 'Coca Cola litro y medio',
  filters: { presentation: '1.5 L' },
});
assert.deepEqual(exactPresentation.rows.map((row) => row.sku).sort(), ['COKE-15-ORIG', 'COKE-15-ZERO']);
assert.ok(exactPresentation.rows.every((row) => row.normalizedPresentation === '1500 ml'));

const family = searchCatalogKnowledgeIndex(index, { query: 'chocorramo' });
assert.ok(family.rows.some((row) => row.sku === 'CHOC-REG'));

const changed = buildCatalogKnowledgeIndex({ tenantId: 'tenant-a', rows: [...rows, { ...rows[0], sku: 'NEW-1' }], sourceRef: 'sheet-a', range: 'Catalogo!A1:P1000', previousVersion: index.catalogVersion });
assert.notEqual(changed.catalogVersion, index.catalogVersion);
assert.equal(changed.previousVersion, index.catalogVersion);

const isolated = buildCatalogKnowledgeIndex({ tenantId: 'tenant-b', rows: [{ ...rows[0], price: 9999 }], sourceRef: 'sheet-b', range: 'Catalogo!A1:P1000' });
assert.equal(searchCatalogKnowledgeIndex(isolated, { query: 'coca cola' }).rows[0].price, 9999);
assert.notEqual(isolated.catalogVersion, index.catalogVersion);

console.log('catalog-knowledge-index: ok');
