export const CATALOG_NODE_TYPES = Object.freeze({
  tenant: 'tenant',
  family: 'family',
  product: 'product',
  brand: 'brand',
  category: 'category',
  presentation: 'presentation',
  attribute: 'attribute',
});

export const CATALOG_RELATION_TYPES = Object.freeze({
  belongsToFamily: 'PRODUCT_BELONGS_TO_FAMILY',
  hasPresentation: 'PRODUCT_HAS_PRESENTATION',
  hasVariant: 'PRODUCT_HAS_VARIANT',
  hasFlavor: 'PRODUCT_HAS_FLAVOR',
  hasAttribute: 'PRODUCT_HAS_ATTRIBUTE',
  sameBrand: 'PRODUCT_SAME_BRAND',
  alternativeOf: 'PRODUCT_ALTERNATIVE_OF',
  substituteOf: 'PRODUCT_SUBSTITUTE_OF',
  relatedTo: 'PRODUCT_RELATED_TO',
});

export function relationKey(type, from, to) {
  return `${type}:${from}:${to}`;
}

export function nodeKey(type, value) {
  return `${type}:${normalizeKey(value)}`;
}

export function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

export function addRelation(relations, type, from, to, metadata = {}, relationKeys = null) {
  if (!type || !from || !to || from === to) return;
  const key = relationKey(type, from, to);
  if (relationKeys) {
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
  } else if (relations.some((relation) => relation.key === key)) return;
  relations.push({ key, type, from, to, metadata });
}
