import { attributesSearchText } from '../domain/catalogMetadata.js';
import { normalizeProduct } from './catalogKnowledgeIndex.js';

// This module contains only catalog projection and query preparation.  It
// deliberately does not decide intent, select a product, or impose
// presentation/category filters.  Those remain responsibilities of the LLM
// interpreter and the resolution flow respectively.
const STOP_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'me',
  'mi', 'para', 'por', 'que', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'o',
  'quiero', 'regalame', 'regala', 'dame', 'necesito', 'favor', 'pedido',
]);

export function normalizeCatalogSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function catalogSearchTokens(value, { includeShort = false } = {}) {
  return [...new Set(normalizeCatalogSearchText(value)
    .split(' ')
    .filter((token) => token.length >= (includeShort ? 2 : 3))
    .filter((token) => !STOP_WORDS.has(token)))];
}

export function deriveCatalogFamily(product = {}) {
  const explicit = String(product.productFamily ?? product.family ?? '').trim();
  if (explicit) return explicit;
  return String(product.name ?? '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|l|lt|litros?|g|gr|kg|unidades?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || String(product.name ?? '').trim();
}

export function catalogNativeSearchText(product = {}) {
  return normalizeCatalogSearchText([
    product.name,
    product.brand,
    product.category,
    product.presentation,
    product.normalizedPresentation,
    product.productFamily ?? product.family,
    product.description,
    ...(product.aliases ?? []),
    ...(product.tags ?? []),
    attributesSearchText(product.attributes),
  ].filter(Boolean).join(' '));
}

/**
 * Builds a relational projection from the same normalized products that feed
 * the legacy immutable graph.  The projection is generic: every tenant gets
 * its own product, family, brand, category, presentation, alias, tag and
 * attribute anchors without special cases for particular products.
 */
export function buildCatalogNativeProjection({ tenantId, catalogVersion, products = [] } = {}) {
  const seenProducts = new Set();
  const projectionProducts = [];
  const relations = [];
  const relationKeys = new Set();

  const addRelation = ({ sku, relationType, value, metadata = {} }) => {
    const label = String(value ?? '').trim();
    const anchorKey = normalizeCatalogSearchText(label);
    if (!sku || !relationType || !anchorKey) return;
    const key = `${sku}|${relationType}|${anchorKey}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    relations.push({
      tenantId,
      catalogVersion,
      productSku: sku,
      relationType,
      anchorKey,
      anchorTokens: catalogSearchTokens(label, { includeShort: true }),
      metadata: { label, ...metadata },
    });
  };

  for (const rawProduct of products) {
    if (!rawProduct?.sku || seenProducts.has(String(rawProduct.sku))) continue;
    const product = normalizeProduct(rawProduct);
    if (product.active === false) continue;
    const family = deriveCatalogFamily(product);
    // Preserve operational fields that are not part of the legacy normalized
    // graph contract (for example unit-pricing metadata).  The normalized
    // values still win for the shared search fields, so the projection keeps
    // one stable shape while remaining a faithful read model of the tenant's
    // authored catalog.
    const payload = {
      ...rawProduct,
      ...product,
      productFamily: product.productFamily ?? family,
      family,
    };
    const searchText = catalogNativeSearchText(payload);
    const searchTokens = catalogSearchTokens(searchText, { includeShort: true });
    seenProducts.add(product.sku);
    projectionProducts.push({
      tenantId,
      catalogVersion,
      sku: product.sku,
      name: product.name,
      category: product.category,
      brand: product.brand,
      presentation: product.presentation,
      normalizedPresentation: product.normalizedPresentation,
      productFamily: family || null,
      price: product.price,
      stock: product.stock,
      active: product.active !== false,
      searchText,
      searchTokens,
      payload,
    });

    addRelation({ sku: product.sku, relationType: 'product', value: product.name });
    addRelation({ sku: product.sku, relationType: 'family', value: family });
    addRelation({ sku: product.sku, relationType: 'brand', value: product.brand });
    addRelation({ sku: product.sku, relationType: 'category', value: product.category });
    addRelation({ sku: product.sku, relationType: 'presentation', value: product.presentation });
    addRelation({ sku: product.sku, relationType: 'presentation', value: product.normalizedPresentation });
    for (const alias of product.aliases ?? []) addRelation({ sku: product.sku, relationType: 'alias', value: alias });
    for (const tag of product.tags ?? []) addRelation({ sku: product.sku, relationType: 'tag', value: tag });
    for (const attribute of flattenAttributes(product.attributes)) {
      addRelation({
        sku: product.sku,
        relationType: attribute.key.includes('sabor') || attribute.key.includes('flavor') ? 'flavor'
          : attribute.key.includes('variante') || attribute.key.includes('tipo') ? 'variant'
            : 'attribute',
        value: `${attribute.key} ${attribute.value}`,
        metadata: { attributeKey: attribute.key, attributeValue: attribute.value },
      });
    }
  }

  return { tenantId, catalogVersion, products: projectionProducts, relations };
}

/**
 * Converts LLM interpretation into ranked-retrieval evidence.  Only an
 * explicit SKU can become an exact predicate.  Presentation/category/brand
 * hints remain evidence so the database can surface compatible alternatives
 * instead of hiding them prematurely.
 */
export function buildCatalogNativeSearchTerms({ query = '', semanticQuery = '', retrievalHints = {}, filters = {} } = {}) {
  const explicitSku = String(filters?.sku ?? '').trim() || null;
  const saleMode = normalizeCatalogSaleMode(retrievalHints?.saleMode ?? filters?.saleMode);
  const { saleMode: _ignoredHintSaleMode, ...searchHints } = retrievalHints ?? {};
  const hintValues = flattenValues(searchHints);
  const filterValues = Object.entries(filters ?? {})
    .filter(([key]) => key !== 'sku' && key !== 'saleMode')
    .flatMap(([, value]) => flattenValues(value));
  const queryText = normalizeCatalogSearchText(query);
  const semanticText = normalizeCatalogSearchText(semanticQuery);
  const evidenceText = [queryText, semanticText, ...hintValues, ...filterValues]
    .filter(Boolean)
    .join(' ');
  const queryTokens = catalogSearchTokens(queryText);
  const semanticTokens = catalogSearchTokens(semanticText);
  const evidenceTokens = [...new Set([
    ...queryTokens,
    ...semanticTokens,
    ...hintValues.flatMap((value) => catalogSearchTokens(value)),
    ...filterValues.flatMap((value) => catalogSearchTokens(value)),
  ])];
  const relationKeys = [...new Set([
    queryText,
    semanticText,
    ...hintValues.map(normalizeCatalogSearchText),
    ...filterValues.map(normalizeCatalogSearchText),
  ].filter(Boolean))].slice(0, 80);
  return {
    explicitSku,
    saleMode,
    queryText,
    semanticText,
    evidenceText,
    queryTokens,
    semanticTokens,
    evidenceTokens,
    relationKeys,
  };
}

/**
 * Commercial mode is a retrieval constraint, not textual evidence. Keeping
 * it separate prevents terms such as "weight" from changing lexical/graph
 * ranking while still allowing PostgreSQL to exclude incompatible rows before
 * its candidate LIMIT is applied.
 */
export function normalizeCatalogSaleMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['unit', 'units', 'unidad', 'unidades'].includes(normalized)) return 'unit';
  if (['weight', 'peso', 'granel', 'fraccionado', 'fraccionada'].includes(normalized)) return 'weight';
  if (['amount', 'valor', 'presupuesto', 'budget'].includes(normalized)) return 'amount';
  return null;
}

export function compactCatalogVocabularyFromRows({ catalogVersion = null, rows = [] } = {}) {
  const products = new Map();
  for (const row of rows) {
    const product = String(row?.product_family ?? row?.productFamily ?? row?.name ?? '').trim();
    const brand = String(row?.brand ?? '').trim();
    if (!product) continue;
    const key = `${normalizeCatalogSearchText(product)}|${normalizeCatalogSearchText(brand)}`;
    if (!products.has(key)) products.set(key, { product, ...(brand ? { brand } : {}) });
  }
  return {
    catalogVersion,
    products: [...products.values()].sort((left, right) => (
      left.product.localeCompare(right.product, 'es') || String(left.brand ?? '').localeCompare(String(right.brand ?? ''), 'es')
    )),
  };
}

function flattenAttributes(value, prefix = '') {
  if (!value || typeof value !== 'object') return [];
  const output = [];
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = normalizeCatalogSearchText(prefix ? `${prefix} ${rawKey}` : rawKey);
    if (!key || rawValue === false || rawValue == null) continue;
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) output.push(...flattenAttributes({ [rawKey]: item }, prefix));
      continue;
    }
    if (typeof rawValue === 'object') {
      output.push(...flattenAttributes(rawValue, key));
      continue;
    }
    output.push({ key, value: String(rawValue) });
  }
  return output;
}

function flattenValues(value) {
  if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'number') return [];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (typeof value === 'object') return Object.values(value).flatMap(flattenValues);
  return [String(value)];
}
