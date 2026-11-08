import assert from 'node:assert/strict';
import { colombiaCatalogResearch2000, colombiaCatalogResearchAdditions1700, colombiaCatalogResearchDistribution } from '../data/colombiaCatalog2000.js';
import { catalogHeaders } from '../services/catalogImportService.js';
import { normalizePresentation } from '../services/catalogImportService.js';

assert.equal(colombiaCatalogResearch2000.length, 2000);
assert.equal(colombiaCatalogResearchAdditions1700.length, 1700);
assert.equal(new Set(colombiaCatalogResearch2000.map(product => product.sku)).size, 2000);
assert.deepEqual(Object.values(colombiaCatalogResearchDistribution).reduce((sum, count) => sum + count, 0), 1700);
assert.deepEqual(colombiaCatalogResearch2000.slice(0, 300).map(product => product.sku),
  (await import('../data/colombiaCatalogExpansion.js')).colombiaCatalogTestSeed300.map(product => product.sku));

for (const product of colombiaCatalogResearch2000) {
  assert.ok(product.sku && product.name && product.category && product.presentation);
  assert.ok(Array.isArray(product.aliases) && product.aliases.length > 0);
  assert.equal(product.normalizedPresentation, normalizePresentation(product.presentation));
  assert.equal(typeof product.attributes, 'object');
  assert.ok(product.catalogOrigin);
}

const researchRows = colombiaCatalogResearchAdditions1700.filter(product => product.catalogOrigin === 'colombia_market_research_2026_presence');
assert.equal(researchRows.length, 1700);
assert.ok(researchRows.every(product => product.active === false && product.price === 0 && product.stock === 0),
  'Las filas de investigación no deben quedar vendibles sin precio/stock del tenant.');
assert.ok(colombiaCatalogResearch2000.some(product => product.aliases.includes('cubeta de huevos')));
assert.ok(colombiaCatalogResearch2000.some(product => product.aliases.includes('cfrut')));
assert.ok(colombiaCatalogResearch2000.some(product => product.aliases.includes('yojo yojo')));
assert.ok(colombiaCatalogResearch2000.filter(product => ['Frutas', 'Verduras', 'Carnes frias'].includes(product.category)).every(product => product.allowsSaleByAmount === true));
assert.ok(colombiaCatalogResearch2000.filter(product => !['Frutas', 'Verduras', 'Carnes frias'].includes(product.category)).every(product => product.allowsSaleByAmount === false));

assert.deepEqual(catalogHeaders, [
  'sku', 'nombre', 'categoria', 'marca', 'presentacion', 'precio', 'stock', 'aliases', 'activo', 'drive_file_id',
  'descripcion', 'etiquetas', 'familia_producto', 'presentacion_normalizada', 'atributos_json', 'origen_catalogo', 'permite_venta_por_valor',
]);

console.log(JSON.stringify({
  passed: true,
  total: colombiaCatalogResearch2000.length,
  preserved: 300,
  additions: researchRows.length,
  schemaFields: catalogHeaders.length,
  status: 'research_rows_gated_until_tenant_sync',
}));

