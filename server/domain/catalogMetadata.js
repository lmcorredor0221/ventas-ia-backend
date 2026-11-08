export const DEFAULT_CATALOG_RANGE = 'Catalogo!A1:Q1000';

// Existing tenants still have A:H/A:J saved. Expand columns only; preserve
// their spreadsheet, tab and row boundaries. Named/custom ranges stay intact.
export function enrichedCatalogRange(range = DEFAULT_CATALOG_RANGE) {
  return String(range || DEFAULT_CATALOG_RANGE).replace(/^(.*!|)(\$?A\$?\d*):(\$?)([A-P])(\$?\d*)$/i, '$1$2:$3Q$5');
}

export function catalogImportRanges(range, rowCount, previousCount = 0) {
  const effective = enrichedCatalogRange(range);
  const match = effective.match(/^(.*!|)\$?A\$?(\d*):\$?[A-Z]+\$?(\d*)$/i);
  if (!match) throw new Error('La importación requiere un rango de catálogo que comience en la columna A.');
  const sheet = match[1];
  const start = Number(match[2] || 1);
  const end = Math.max(Number(match[3] || 1000), start + rowCount, start + previousCount);
  const read = match[3] ? effective.replace(/\d+$/, String(end)) : effective;
  return { read, clear: `${sheet}A${start}:Q${end}`, write: `${sheet}A${start}:Q${start + rowCount}` };
}

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

// This text is retrieval evidence, never a rule equating "familiar" to a size.
// False flags must not advertise the feature; explicit boolean filters below
// distinguish false from missing evidence.
export function attributesSearchText(value, depth = 0) {
  if (depth > 6 || value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(item => attributesSearchText(item, depth + 1)).join(' ');
  if (isObject(value)) return Object.entries(value).map(([key, item]) =>
    item === false || item == null ? '' : `${normalize(key)} ${item === true ? '' : attributesSearchText(item, depth + 1)}`
  ).join(' ');
  return String(value);
}

export function matchesCatalogAttributes(actual, expected) {
  if (!isObject(expected)) return false;
  if (!Object.keys(expected).length) return true;
  if (!isObject(actual)) return false;
  return Object.entries(expected).every(([key, wanted]) => {
    const entry = Object.entries(actual).find(([name]) => normalize(name) === normalize(key));
    if (!entry) return false;
    const value = entry[1];
    if (isObject(wanted)) return matchesCatalogAttributes(value, wanted);
    if (Array.isArray(wanted)) return Array.isArray(value) && wanted.every(item => value.some(candidate => normalize(candidate) === normalize(item)));
    if (typeof wanted === 'boolean' || typeof wanted === 'number') return value === wanted;
    return wanted != null && value != null && normalize(value) === normalize(wanted);
  });
}

export function catalogProductContext(product) {
  const { sku, name, aliases, category, stock, brand, presentation, normalizedPresentation, productFamily, attributes, tags, description } = product;
  return { sku, name, aliases, category, stock, brand, presentation, normalizedPresentation, productFamily, attributes, tags, description: description ? String(description).slice(0, 1000) : undefined };
}
