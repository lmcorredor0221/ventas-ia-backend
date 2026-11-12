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

// The interpreter may infer a broad need ("antojo dulce") without naming a
// SKU. Its catalog concept must bring compatible products into the candidate
// set and rank them ahead of incidental lexical matches, while remaining a
// soft signal rather than a filter.
const sweetRecommendation = searchCatalogKnowledgeIndex(index, {
  query: 'antojo de algo dulce',
  semanticQuery: 'antojo dulce recomendacion',
  recommendation: true,
  retrievalHints: { category: 'ponqués' },
  limit: 5,
});
assert.ok(sweetRecommendation.rows.some((row) => row.sku === 'CHOC-REG'));
assert.ok(sweetRecommendation.rows.some((row) => row.sku === 'CHOC-MINI'));
assert.ok(['CHOC-REG', 'CHOC-MINI'].includes(sweetRecommendation.rows[0].sku));

const graphExpanded = searchCatalogKnowledgeIndex(index, {
  query: 'Coca-Cola litro y medio',
  filters: { presentation: '1.5 L' },
  limit: 10,
});
assert.ok(graphExpanded.retrieval.graphCandidateCount >= 2);
assert.ok(graphExpanded.retrieval.graphPaths.some((path) => path.relationTypes.includes('PRODUCT_HAS_PRESENTATION')));

const multiValueAttributes = buildCatalogKnowledgeIndex({
  tenantId: 'tenant-attributes',
  rows: [{
    sku: 'ATTR-1',
    name: 'Producto con atributos',
    category: 'pruebas',
    presentation: 'unidad',
    productFamily: 'Producto con atributos',
    attributes: { formato: ['familiar', 'botella'] },
    active: true,
  }],
});
assert.equal(searchCatalogKnowledgeIndex(multiValueAttributes, {
  query: 'producto atributos',
  filters: { attributes: { formato: ['familiar'] } },
}).rows[0].sku, 'ATTR-1');

const weightedCatalog = buildCatalogKnowledgeIndex({
  tenantId: 'tenant-weight',
  rows: [{
    sku: 'BANANO-KG', name: 'Banano criollo', category: 'Frutas', presentation: '1 kg',
    price: 4500, stock: 50, active: true, allowsSaleByAmount: true,
    attributes: { measure: { amount: 1, unit: 'kg' }, commerce: {
      saleModes: ['weight'], weight: { pricePerKg: 4500, stockGrams: 12000, minGrams: 50, incrementGrams: 50 },
    } },
  }],
});
const weightNode = weightedCatalog.nodes.find(node => node.type === 'attribute' && node.key === 'modalidad-venta-peso');
assert.ok(weightNode, 'el grafo debe representar la modalidad por peso');
assert.ok(weightedCatalog.relations.some(relation => relation.to === weightNode.id && relation.type === 'PRODUCT_HAS_ATTRIBUTE'));
assert.ok(!weightedCatalog.nodes.some(node => node.key === 'commerce-object-object'));
assert.equal(weightedCatalog.products['BANANO-KG'].attributes.commerce.weight.stockGrams, 12000);
assert.equal(weightedCatalog.products['BANANO-KG'].allowsSaleByAmount, true);

const changed = buildCatalogKnowledgeIndex({ tenantId: 'tenant-a', rows: [...rows, { ...rows[0], sku: 'NEW-1' }], sourceRef: 'sheet-a', range: 'Catalogo!A1:P1000', previousVersion: index.catalogVersion });
assert.notEqual(changed.catalogVersion, index.catalogVersion);
assert.equal(changed.previousVersion, index.catalogVersion);

const isolated = buildCatalogKnowledgeIndex({ tenantId: 'tenant-b', rows: [{ ...rows[0], price: 9999 }], sourceRef: 'sheet-b', range: 'Catalogo!A1:P1000' });
assert.equal(searchCatalogKnowledgeIndex(isolated, { query: 'coca cola' }).rows[0].price, 9999);
assert.notEqual(isolated.catalogVersion, index.catalogVersion);

console.log('catalog-knowledge-index: ok');
