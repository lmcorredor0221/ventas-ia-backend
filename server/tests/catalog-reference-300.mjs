import assert from 'node:assert/strict';
import { colombiaCatalogExpansion200, colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

assert.equal(colombiaCatalogExpansion200.length, 200, 'La expansion debe aportar 200 referencias.');
assert.equal(colombiaCatalogTestSeed300.length, 300, 'La biblioteca de prueba debe sumar 300 referencias.');
assert.equal(new Set(colombiaCatalogTestSeed300.map((product) => product.sku)).size, 300, 'Los SKU de la biblioteca deben ser unicos.');

for (const product of colombiaCatalogTestSeed300) {
  assert.ok(product.name, `${product.sku}: falta nombre`);
  assert.ok(product.presentation, `${product.sku}: falta presentacion visible`);
  assert.ok(product.normalizedPresentation, `${product.sku}: falta presentacion normalizada`);
  assert.ok(product.description, `${product.sku}: falta descripcion`);
  assert.ok(product.productFamily, `${product.sku}: falta familia`);
  assert.ok(Array.isArray(product.tags) && product.tags.length, `${product.sku}: faltan etiquetas`);
  assert.equal(product.active, true, `${product.sku}: la referencia de prueba debe estar activa`);
  assert.ok(product.attributes?.measure, `${product.sku}: faltan atributos de presentacion`);
}

assert.ok(colombiaCatalogTestSeed300.some((product) => product.sku === 'COL-128' && product.attributes.measure.canonicalAmount === 3000));
assert.ok(colombiaCatalogTestSeed300.some((product) => product.sku === 'COL-226' && product.productFamily === 'ponque'));
assert.ok(colombiaCatalogTestSeed300.some((product) => product.sku === 'BOG-SNA-068' && product.productFamily === 'dulce'), 'La categoria Dulces y chocolates no puede clasificarse como lacteo solo por una palabra del nombre.');
assert.ok(colombiaCatalogTestSeed300.filter((product) => product.category === 'Huevos').every((product) => product.productFamily === 'huevo'), 'La categoria Huevos debe conservar una familia unica, independiente de aliases como panal.');

console.log('Catalog reference 300 checks passed');
