const CANONICAL_HEADERS = [
  'sku',
  'nombre',
  'categoria',
  'marca',
  'presentacion',
  'precio',
  'stock',
  'aliases',
  'activo',
  'drive_file_id',
  'descripcion',
  'etiquetas',
  'familia_producto',
  'presentacion_normalizada',
  'atributos_json',
  'origen_catalogo',
];

const HEADER_ALIASES = {
  sku: ['sku', 'codigo', 'codigo_producto', 'product_id'],
  nombre: ['nombre', 'name', 'producto', 'product'],
  categoria: ['categoria', 'category', 'tipo'],
  marca: ['marca', 'brand'],
  presentacion: ['presentacion', 'presentation', 'tamano', 'variedad'],
  precio: ['precio', 'price', 'valor', 'valor_unitario'],
  stock: ['stock', 'existencias', 'inventario', 'cantidad_disponible'],
  aliases: ['aliases', 'alias', 'sinonimos'],
  activo: ['activo', 'active', 'habilitado', 'disponible'],
  drive_file_id: ['drive_file_id', 'drivefileid', 'drive_file', 'ficha_drive'],
  descripcion: ['descripcion', 'description', 'detalle', 'detalle_producto'],
  etiquetas: ['etiquetas', 'tags', 'tag', 'palabras_clave', 'keywords'],
  familia_producto: ['familia_producto', 'familia', 'product_family'],
  presentacion_normalizada: ['presentacion_normalizada', 'presentation_normalized', 'tamano_normalizado', 'medida_normalizada'],
  atributos_json: ['atributos_json', 'attributes_json', 'atributos', 'attributes'],
  origen_catalogo: ['origen_catalogo', 'catalog_origin', 'origen'],
};

export function validateCatalogCsv(csvText) {
  const text = String(csvText ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) return invalidResult('El archivo esta vacio.');

  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  if (!records.length) return invalidResult('No encontramos filas en el archivo.');

  const headerMap = mapHeaders(records[0]);
  const missingHeaders = ['sku', 'nombre'].filter((key) => headerMap[key] === undefined);
  if (missingHeaders.length) {
    return {
      valid: false,
      rows: [],
      errors: [{ row: 1, field: 'encabezados', message: `Faltan columnas obligatorias: ${missingHeaders.join(', ')}` }],
      warnings: [],
      headers: records[0],
      delimiter,
      totalRows: Math.max(records.length - 1, 0),
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];
  const seenSkus = new Map();
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record.every((value) => !String(value ?? '').trim())) continue;
    const rowNumber = index + 1;
    const row = canonicalRow(record, headerMap);
    if (!row.sku) errors.push({ row: rowNumber, field: 'sku', message: 'El SKU es obligatorio.' });
    if (!row.nombre) errors.push({ row: rowNumber, field: 'nombre', message: 'El nombre del producto es obligatorio.' });
    if (row.sku && seenSkus.has(row.sku)) {
      errors.push({ row: rowNumber, field: 'sku', message: `SKU repetido; tambien aparece en la fila ${seenSkus.get(row.sku)}.` });
    } else if (row.sku) {
      seenSkus.set(row.sku, rowNumber);
    }
    if (row.precio === null) errors.push({ row: rowNumber, field: 'precio', message: 'El precio debe ser un numero mayor o igual a cero.' });
    if (row.stock === null) errors.push({ row: rowNumber, field: 'stock', message: 'El stock debe ser un numero mayor o igual a cero.' });
    if (!row.presentacion) warnings.push({ row: rowNumber, field: 'presentacion', message: 'Sin presentacion; el agente puede pedir una aclaracion.' });
    if (row.atributos_json && !parseAttributes(row.atributos_json)) {
      errors.push({ row: rowNumber, field: 'atributos_json', message: 'Los atributos deben ser un objeto JSON valido.' });
    }
    if (row.activo === false && row.sku) warnings.push({ row: rowNumber, field: 'activo', message: 'Este producto quedara inactivo y no se ofrecera.' });
    rows.push(row);
  }

  return {
    valid: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    warnings,
    headers: records[0],
    delimiter,
    totalRows: rows.length,
    activeRows: rows.filter((row) => row.activo).length,
  };
}

export function catalogRowsToSheetValues(rows) {
  return [CANONICAL_HEADERS, ...rows.map((row) => [
    row.sku,
    row.nombre,
    row.categoria,
    row.marca,
    row.presentacion,
    row.precio,
    row.stock,
    row.aliases,
    row.activo ? 'TRUE' : 'FALSE',
    row.drive_file_id,
    row.descripcion,
    row.etiquetas,
    row.familia_producto,
    row.presentacion_normalizada,
    row.atributos_json,
    row.origen_catalogo,
  ])];
}

export function catalogRowToProduct(row) {
  return {
    sku: row.sku,
    name: row.nombre,
    category: row.categoria,
    brand: row.marca,
    presentation: row.presentacion,
    price: row.precio ?? 0,
    stock: row.stock ?? 0,
    aliases: splitAliases(row.aliases),
    active: row.activo,
    driveFileId: row.drive_file_id || null,
    description: row.descripcion || null,
    tags: splitAliases(row.etiquetas),
    productFamily: row.familia_producto || null,
    normalizedPresentation: row.presentacion_normalizada || normalizePresentation(row.presentacion),
    attributes: parseAttributes(row.atributos_json) ?? {},
    catalogOrigin: row.origen_catalogo || null,
  };
}

export const catalogHeaders = CANONICAL_HEADERS;

function canonicalRow(record, headerMap) {
  const value = (key) => headerMap[key] === undefined ? '' : String(record[headerMap[key]] ?? '').trim();
  return {
    sku: value('sku'),
    nombre: value('nombre'),
    categoria: value('categoria'),
    marca: value('marca'),
    presentacion: value('presentacion'),
    precio: numberOrNull(value('precio')),
    stock: numberOrNull(value('stock')),
    aliases: value('aliases'),
    activo: booleanValue(value('activo'), true),
    drive_file_id: value('drive_file_id'),
    descripcion: value('descripcion'),
    etiquetas: value('etiquetas'),
    familia_producto: value('familia_producto'),
    presentacion_normalizada: value('presentacion_normalizada') || normalizePresentation(value('presentacion')),
    atributos_json: value('atributos_json'),
    origen_catalogo: value('origen_catalogo'),
  };
}

function mapHeaders(headers) {
  const result = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalizeHeader(alias) === normalized)) {
        result[key] ??= index;
        break;
      }
    }
  });
  return result;
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const candidates = [',', ';', '\t'];
  return candidates.sort((a, b) => count(firstLine, b) - count(firstLine, a))[0];
}

function count(value, token) {
  return value.split(token).length - 1;
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeNumber(value) {
  return String(value ?? '').replace(/[^\d.,-]/g, '').trim();
}

function numberOrNull(value) {
  if (!String(value ?? '').trim()) return null;
  const normalized = normalizeNumber(value);
  if (!normalized) return null;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  let canonical = normalized;
  if (lastComma > lastDot) canonical = normalized.replace(/\./g, '').replace(',', '.');
  else if (lastDot >= 0 && normalized.slice(lastDot + 1).length === 3) canonical = normalized.replace(/\./g, '');
  else canonical = normalized.replace(/,/g, '');
  const number = Number(canonical);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function booleanValue(value, fallback) {
  if (!String(value ?? '').trim()) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['false', 'falso', 'no', '0', 'inactivo'].includes(normalized)) return false;
  if (['true', 'verdadero', 'si', '1', 'activo'].includes(normalized)) return true;
  return fallback;
}

function splitAliases(value) {
  return String(value ?? '').split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
}

function parseAttributes(value) {
  if (!String(value ?? '').trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePresentation(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/mililitros?/g, 'ml')
    .replace(/litros?/g, 'l')
    .replace(/gramos?/g, 'g')
    .replace(/kilogramos?/g, 'kg')
    .replace(/unidades?/g, 'und')
    .replace(/\s+/g, ' ');
}

function invalidResult(message) {
  return { valid: false, rows: [], errors: [{ row: 0, field: 'archivo', message }], warnings: [], headers: [], delimiter: ',', totalRows: 0 };
}
