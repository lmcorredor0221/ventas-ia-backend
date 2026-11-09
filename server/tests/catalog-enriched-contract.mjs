import assert from 'node:assert/strict';
import { ToolRegistry } from '../services/toolRegistry.js';
import { validateCatalogCsv, catalogRowsToSheetValues, catalogRowToProduct } from '../services/catalogImportService.js';

const headers = ['sku','nombre','categoria','marca','presentacion','precio','stock','aliases','activo','drive_file_id','descripcion','etiquetas','familia_producto','presentacion_normalizada','atributos','origen_catalogo'];
const values = [headers,
  ['A','Paños','Aseo','Limpio','2 unidades',4000,10,'','TRUE','','Biodegradables para limpieza','reutilizable','panos','2 und',JSON.stringify({material:'algodón',color:'azul',sin_perfume:true}),'fixture'],
  ['B','Paños','Aseo','Limpio','2 unidades',5000,10,'','TRUE','','Para limpieza','suave','panos','2 und',JSON.stringify({material:'poliéster',color:'rojo',sin_perfume:false}),'fixture'],
];
const csv = values.map(row => row.map(value => '"' + String(value).replaceAll('"','""') + '"').join(',')).join('\n');
const validation = validateCatalogCsv(csv);
assert.equal(validation.valid, true);
const products = validation.rows.map(catalogRowToProduct);
assert.equal(products[0].description, 'Biodegradables para limpieza');
assert.equal(products[0].attributes.material, 'algodón');
assert.equal(catalogRowsToSheetValues(validation.rows)[0].length, 17);
assert.equal(validateCatalogCsv(csv.replace('""material""','invalid')).valid, false);
const legacy = validateCatalogCsv('sku,nombre,precio,stock\nOLD,Arroz,3000,2');
assert.equal(legacy.valid, true);
assert.deepEqual(catalogRowToProduct(legacy.rows[0]).attributes, {});

const state = {tenants:[{id:'demo'}], productsByTenant:{demo:products, other:[{sku:'OTHER',name:'Algodon privado',stock:1}]}};
const ranges = [];
const tools = new ToolRegistry({store:{getState:()=>state,mutate:fn=>fn(state)},config:{allowLocalCatalogFallback:true},googleWorkspace:{readValues:async args=>{ranges.push(args.range);return values;}}});
tools.liveGoogleContext = async () => null;
const search = async filters => (await tools.googleSheetsReadTable('demo',{filters})).rows;
assert.deepEqual((await search({query:'biodegradables'})).map(p=>p.sku), ['A']);
assert.deepEqual((await search({query:'algodon'})).map(p=>p.sku), ['A']);
assert.deepEqual((await search({query:'reutilizable'})).map(p=>p.sku), ['A']);
assert.deepEqual((await search({query:'paños',attributes:{material:'algodon'}})).map(p=>p.sku), ['A']);
assert.deepEqual((await search({sku:'B',attributes:{sin_perfume:true}})).map(p=>p.sku), []);
assert.deepEqual((await search({attributes:{sin_perfume:false}})).map(p=>p.sku), ['B']);
assert.deepEqual(await search({attributes:{desconocido:true}}), []);
assert.deepEqual(await search({sku:'A-no-existe'}), []);

const liveRows = await tools.readLiveCatalogRows({tenantId:'demo',live:{spreadsheetId:'test',accessToken:'fixture'},range:"'Mi Catalogo'!A1:J1000"});
assert.equal(ranges[0], "'Mi Catalogo'!A1:Q1000", 'Historical ranges must include metadata without changing tenant/tab');
assert.deepEqual(liveRows[0].attributes, products[0].attributes);
assert.equal(liveRows[0].description, products[0].description);
assert.equal(liveRows[0].price, 4000);
assert.equal(state.productsByTenant.other[0].sku, 'OTHER');
console.log('Enriched catalog import, live read, metadata search and tenant isolation passed');
