import assert from 'node:assert/strict';
import {
  buildCatalogNativeProjection,
  buildCatalogNativeSearchTerms,
  compactCatalogVocabularyFromRows,
} from '../services/catalogNativeSearch.js';

const products = [
  {
    sku: 'COKE-15-ORIG',
    name: 'Coca-Cola original',
    brand: 'Coca-Cola',
    category: 'gaseosas',
    presentation: '1.5 L',
    normalizedPresentation: '1500 ml',
    productFamily: 'Coca-Cola',
    aliases: ['coca cola litro y medio'],
    attributes: { variante: 'Original' },
    price: 7200,
    stock: 8,
    active: true,
    customCommercialField: 'preserve-me',
  },
  {
    sku: 'CHOC-65',
    name: 'Ponque Chocorramo 65 g',
    brand: 'Ramo',
    category: 'ponques',
    presentation: '65 g',
    productFamily: 'Chocorramo',
    aliases: ['chocorramo'],
    price: 2800,
    stock: 10,
    active: true,
  },
];

const projection = buildCatalogNativeProjection({
  tenantId: 'tenant-a',
  catalogVersion: 'v1',
  products,
});

assert.equal(projection.products.length, 2);
assert.ok(projection.relations.some((relation) => relation.productSku === 'COKE-15-ORIG' && relation.relationType === 'family'));
assert.ok(projection.relations.some((relation) => relation.productSku === 'COKE-15-ORIG' && relation.relationType === 'alias'));
assert.match(projection.products[0].searchText, /coca cola litro y medio/i);
assert.equal(projection.products[0].payload.customCommercialField, 'preserve-me');

const terms = buildCatalogNativeSearchTerms({
  query: 'Coca Cola litro y medio',
  semanticQuery: 'gaseosa Coca-Cola 1.5 litros',
  filters: { presentation: '1.5 L', brand: 'Coca-Cola' },
  retrievalHints: { productFamily: 'Coca-Cola', variant: 'original' },
});
assert.equal(terms.explicitSku, null, 'Los atributos inferidos deben ser evidencia, no filtros destructivos.');
assert.ok(terms.queryTokens.includes('coca'));
assert.ok(terms.evidenceTokens.includes('original'));
assert.ok(terms.relationKeys.includes('coca cola'));

const exactTerms = buildCatalogNativeSearchTerms({ filters: { sku: 'CHOC-65', presentation: '65 g' } });
assert.equal(exactTerms.explicitSku, 'CHOC-65', 'Solo un SKU explícito es una condición exacta.');

const vocabulary = compactCatalogVocabularyFromRows({
  catalogVersion: 'v1',
  rows: projection.products.map((product) => ({
    product_family: product.productFamily,
    name: product.name,
    brand: product.brand,
  })),
});
assert.deepEqual(vocabulary, {
  catalogVersion: 'v1',
  products: [
    { product: 'Chocorramo', brand: 'Ramo' },
    { product: 'Coca-Cola', brand: 'Coca-Cola' },
  ],
});

console.log('catalog-native-projection: projection and soft retrieval evidence passed');
