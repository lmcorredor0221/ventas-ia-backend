import assert from 'node:assert/strict';
import { validateCatalogCsv, catalogRowsToSheetValues, catalogRowToProduct } from '../services/catalogImportService.js';

const csv = 'sku,nombre,precio,stock,permite_venta_por_valor\nFRU,Banano,5000,10,TRUE\nCOC,Coca-Cola,3200,10,FALSE';
const result = validateCatalogCsv(csv);
assert.equal(result.valid, true);
const [fruit, soda] = result.rows.map(catalogRowToProduct);
assert.equal(fruit.allowsSaleByAmount, true);
assert.equal(soda.allowsSaleByAmount, false);
assert.equal(catalogRowsToSheetValues(result.rows)[0].at(-1), 'permite_venta_por_valor');
assert.equal(validateCatalogCsv(csv.replace('TRUE', 'sometimes')).valid, false);
assert.equal(catalogRowToProduct(validateCatalogCsv('sku,nombre,precio,stock\nX,Old,100,1').rows[0]).allowsSaleByAmount, false);
console.log('Amount-sale catalog flag checks passed');
