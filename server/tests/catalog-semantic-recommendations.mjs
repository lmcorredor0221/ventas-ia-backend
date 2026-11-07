import assert from 'node:assert/strict';
import { buildCatalogKnowledgeIndex, searchCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';

const rows = [
  {
    sku: 'BEV-CIF-GRA',
    name: 'Cifrut granadilla',
    category: 'jugos',
    productFamily: 'bebida de fruta',
    presentation: '200 ml',
    description: 'Bebida de fruta refrescante para calmar la sed.',
    tags: ['jugo', 'fruta', 'refrescante', 'calmar la sed'],
    attributes: { ocasion_consumo: ['calmar la sed'], tipo_bebida: 'jugo' },
    price: 2200,
    stock: 30,
  },
  {
    sku: 'BEV-AGU-600',
    name: 'Agua Cristal sin gas 600ml',
    category: 'bebidas',
    productFamily: 'agua embotellada',
    presentation: '600 ml',
    description: 'Agua para hidratarse y calmar la sed.',
    tags: ['agua', 'hidratacion', 'refrescante', 'calmar la sed'],
    attributes: { ocasion_consumo: ['calmar la sed'], tipo_bebida: 'agua' },
    price: 1800,
    stock: 50,
  },
  {
    sku: 'BEV-COC-400',
    name: 'Coca-Cola 400ml',
    category: 'bebidas',
    productFamily: 'gaseosa',
    presentation: '400 ml',
    description: 'Gaseosa para acompañar comidas.',
    tags: ['gaseosa', 'refrescante'],
    attributes: { tipo_bebida: 'gaseosa' },
    price: 3200,
    stock: 36,
  },
  {
    sku: 'SNK-CHO-01',
    name: 'Chocoramo',
    category: 'snacks',
    productFamily: 'ponque',
    presentation: '65 g',
    description: 'Ponque cubierto de chocolate.',
    tags: ['mecato', 'dulce'],
    price: 2800,
    stock: 42,
  },
];

const index = buildCatalogKnowledgeIndex({ tenantId: 'semantic-recommendation-test', rows, sourceRef: 'fixture', range: 'Catalogo!A:P' });
const result = searchCatalogKnowledgeIndex(index, {
  query: 'sed',
  semanticQuery: 'algo refrescante para calmar la sed fruta hidratacion',
  recommendation: true,
  filters: { category: 'bebidas' },
  limit: 3,
});

assert.deepEqual(new Set(result.rows.slice(0, 2).map((row) => row.name)), new Set([
  'Cifrut granadilla',
  'Agua Cristal sin gas 600ml',
]));
assert.equal(result.rows.some((row) => row.name === 'Chocoramo'), false, 'the category filter must remain mandatory');
assert.equal(result.retrieval.recommendation, true);
assert.equal(result.retrieval.semanticCandidateCount >= 2, true);
assert.equal(result.retrieval.diversityApplied, true);
assert.equal(typeof result.rows[0].semanticScore, 'number');

const exact = searchCatalogKnowledgeIndex(index, { query: 'Coca-Cola 400ml', filters: { category: 'bebidas' }, limit: 3 });
assert.equal(exact.rows[0].name, 'Coca-Cola 400ml');
assert.equal(exact.retrieval.recommendation, false);

const exactWithContext = searchCatalogKnowledgeIndex(index, {
  query: 'Coca-Cola 400ml',
  semanticQuery: 'refrescante para acompañar la comida',
  recommendation: false,
  filters: { category: 'bebidas' },
  limit: 3,
});
assert.equal(exactWithContext.rows[0].name, 'Coca-Cola 400ml');
assert.equal(exactWithContext.retrieval.recommendation, false);

console.log('catalog-semantic-recommendations: ok');
