// Channel restriction, not a sales classifier or a catalog resolver. The LLM
// supplies contextual evidence; these checks enforce known catalog restrictions.
export const WHATSAPP_COMMERCE_NOTICE = 'Por las políticas de WhatsApp, no podemos gestionar pedidos de alcohol o tabaco por este canal. Para otras consultas, puedes contactar directamente con la tienda.';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const categories = new Set(['alcohol', 'tobacco']);

export function normalizeCommercePolicy(value = {}) {
  const entries = (list, restricted) => (Array.isArray(list) ? list : []).slice(0, 30)
    .filter(item => item && typeof item.rawName === 'string' && item.rawName.trim()
      && (!restricted || categories.has(item.category)))
    .map(item => ({ rawName: item.rawName.trim().slice(0, 160), ...(restricted ? { category: item.category } : {}) }));
  return {
    restrictedItems: entries(value?.restrictedItems, true),
    uncertainItems: entries(value?.uncertainItems, false),
    continueAllowedItems: value?.continueAllowedItems === true,
  };
}

export function catalogCommerceCategory(product = {}) {
  const explicit = product.commerceCategory ?? product.attributes?.commerceCategory;
  if (categories.has(explicit) || explicit === 'uncertain') return explicit;
  const category = normalize(product.category);
  const name = normalize(product.name ?? product.rawName ?? product.catalogQuery);
  if (/\b(tabaco|cigarrillos?|cigarros?|tobacco|vapeadores?)\b/.test(`${category} ${name}`)) return 'tobacco';
  // "Alcohol" alone is not evidence of an alcoholic drink. Do not confuse
  // cleaning products, ingredients, personal names or alcohol-free claims.
  if (/\b(gel|limpieza|antiseptico|desinfectante|vinagre|salsa|esencia)\b/.test(name)) return null;
  if (/\b(sin alcohol|0[.,]0|no alcoholica)\b/.test(name)) return 'uncertain';
  if (/\b(cervezas?|licores?|aguardientes?|rones|ron|whisk[ey]+|vodka|tequila|vinos?|bebidas alcoholicas)\b/.test(category)) return 'alcohol';
  if (/\b(cervezas?|licores?|aguardientes?|ron|whisk[ey]+|vodka|tequila)\b/.test(name) || /^vino\b/.test(name)) return 'alcohol';
  if (/\balcohol\b/.test(name)) return 'uncertain';
  return null;
}

function matchesEvidence(item, evidence) {
  const expected = normalize(evidence.rawName);
  return [item.rawName, item.rawText, item.catalogQuery, item.name, item.product?.name]
    .map(normalize).some(actual => actual && (actual === expected
      || (expected.length >= 4 && actual.includes(expected))));
}

export function assessCommerceItems({ items = [], policy, products = [] } = {}) {
  const normalized = normalizeCommercePolicy(policy);
  const restrictedItems = [...normalized.restrictedItems];
  const uncertainItems = [...normalized.uncertainItems];
  const allowedItems = [];
  const unresolvedItems = [];
  for (const item of items) {
    const sku = item.product?.sku ?? item.skuHint ?? item.sku;
    const catalogProduct = sku ? products.find(product => product.sku === sku) : null;
    const category = catalogCommerceCategory(catalogProduct ?? item.product ?? item);
    const rawName = String(item.rawName ?? item.catalogQuery ?? item.name ?? catalogProduct?.name ?? item.product?.name ?? 'producto').slice(0, 160);
    if (categories.has(category)) restrictedItems.push({ rawName, category });
    else if (category === 'uncertain') {
      uncertainItems.push({ rawName });
      unresolvedItems.push({ ...item, commerceCategory: 'uncertain' });
    } else if (uncertainItems.some(entry => matchesEvidence(item, entry))) unresolvedItems.push({ ...item, commerceCategory: 'uncertain' });
    else if (!restrictedItems.some(entry => matchesEvidence(item, entry))) allowedItems.push(item);
  }
  return { restrictedItems, uncertainItems, allowedItems, unresolvedItems, blocked: restrictedItems.length > 0 || uncertainItems.length > 0 };
}

export function assertCommerceOrderAllowed(items, products) {
  const decision = assessCommerceItems({ items, products });
  if (!decision.blocked) return;
  const error = new Error('El pedido contiene productos restringidos o pendientes de clasificación para este canal.');
  error.code = 'whatsapp_commerce_restricted';
  error.statusCode = 422;
  throw error;
}
