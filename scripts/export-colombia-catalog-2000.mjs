import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colombiaCatalogResearch2000 } from '../server/data/colombiaCatalog2000.js';
import { catalogRowsToSheetValues } from '../server/services/catalogImportService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '..', 'artifacts', 'catalogo-colombia-2000.csv');

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const canonicalRows = colombiaCatalogResearch2000.map((product) => ({
  sku: product.sku,
  nombre: product.name,
  categoria: product.category,
  marca: product.brand,
  presentacion: product.presentation,
  precio: product.price,
  stock: product.stock,
  aliases: Array.isArray(product.aliases) ? product.aliases.join('|') : product.aliases,
  activo: product.active,
  drive_file_id: product.driveFileId,
  descripcion: product.description,
  etiquetas: Array.isArray(product.tags) ? product.tags.join('|') : product.tags,
  familia_producto: product.productFamily,
  presentacion_normalizada: product.normalizedPresentation,
  atributos_json: product.attributes ? JSON.stringify(product.attributes) : '',
  origen_catalogo: product.catalogOrigin,
  permite_venta_por_valor: product.allowsSaleByAmount,
}));
const values = catalogRowsToSheetValues(canonicalRows);
const csv = values.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `\uFEFF${csv}`, 'utf8');
console.log(`wrote=${outputPath} rows=${colombiaCatalogResearch2000.length} columns=${values[0].length}`);
