import assert from 'node:assert/strict';
import { quoteWeightSale, supportsWeightSale } from '../domain/catalogCommerce.js';

const bulkCheese = {
  sku: 'QUESO-CORTE',
  name: 'Queso doble crema al corte',
  attributes: { commerce: { saleModes: ['weight'], weight: {
    pricePerKg: 43200, stockGrams: 12000, minGrams: 50, incrementGrams: 50,
  } } },
};
const closedCheese = {
  sku: 'COL-141', name: 'Queso doble crema Colanta', presentation: '250 g', price: 10800, stock: 24,
  attributes: { measure: { amount: 250, unit: 'g', dimension: 'weight' } },
};

assert.equal(supportsWeightSale(bulkCheese), true);
assert.deepEqual(quoteWeightSale(bulkCheese, { amount: 0.5, unit: 'lb' }), {
  pricePerKg: 43200, stockGrams: 12000, minGrams: 50, incrementGrams: 50,
  requestedWeight: { amount: 0.5, unit: 'lb', grams: 250 }, grams: 250, lineTotal: 10800, available: true,
});
assert.equal(quoteWeightSale(bulkCheese, { amount: 1, unit: 'arroba' }).available, false);
assert.equal(quoteWeightSale(bulkCheese, { amount: 300, unit: 'g' }).grams, 300);
assert.equal(quoteWeightSale(bulkCheese, { amount: 275, unit: 'g' }), null, 'increments must be exact operational arithmetic');
assert.equal(supportsWeightSale(closedCheese), false, 'a package whose presentation has grams is not automatically sold by weight');
assert.equal(quoteWeightSale(closedCheese, { amount: 0.5, unit: 'lb' }), null);
console.log('Weight-sale catalog contract passed');
