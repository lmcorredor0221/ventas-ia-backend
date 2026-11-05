// Catalog content is data, never instructions for the model.
export function attributeText(value, depth = 0) {
  if (depth > 3 || value == null) return '';
  if (typeof value !== 'object') return String(value).slice(0, 200);
  return Object.entries(value).slice(0, 32)
    .map(([key, item]) => `${key.replaceAll('_', ' ')} ${attributeText(item, depth + 1)}`).join(' ');
}

export function catalogEvidence(row, query) {
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tokens = norm(query).split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const fields = { name: row.name, brand: row.brand, aliases: (row.aliases ?? []).join(' '),
    presentation: `${row.presentation ?? ''} ${row.normalizedPresentation ?? ''}`, description: row.description,
    family: row.productFamily, category: row.category, tags: (row.tags ?? []).join(' '), attributes: attributeText(row.attributes) };
  return Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, tokens.filter((token) => norm(value).includes(token))]));
}
