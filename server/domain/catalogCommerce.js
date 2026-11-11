const POSITIVE_INT = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const NON_NEGATIVE_INT = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

const WEIGHT_UNIT_GRAMS = {
  g: 1,
  kg: 1000,
  lb: 500,
  arroba: 12500,
};

function commerceConfig(product = {}) {
  const commerce = product?.attributes?.commerce;
  return commerce && typeof commerce === 'object' && !Array.isArray(commerce) ? commerce : {};
}

export function saleModesForProduct(product = {}) {
  const configured = commerceConfig(product).saleModes;
  const modes = new Set(Array.isArray(configured) ? configured.map(value => String(value).trim().toLowerCase()) : []);
  if (product?.allowsSaleByAmount === true) modes.add('amount');
  return modes;
}

export function weightSaleTerms(product = {}) {
  const weight = commerceConfig(product).weight;
  if (!saleModesForProduct(product).has('weight') || !weight || typeof weight !== 'object' || Array.isArray(weight)) return null;
  if (!POSITIVE_INT(weight.pricePerKg) || !NON_NEGATIVE_INT(weight.stockGrams)) return null;
  const minGrams = weight.minGrams == null ? 1 : Number(weight.minGrams);
  const incrementGrams = weight.incrementGrams == null ? 1 : Number(weight.incrementGrams);
  if (!POSITIVE_INT(minGrams) || !POSITIVE_INT(incrementGrams)) return null;
  return {
    pricePerKg: Number(weight.pricePerKg),
    stockGrams: Number(weight.stockGrams),
    minGrams,
    incrementGrams,
  };
}

export function supportsWeightSale(product = {}) {
  return Boolean(weightSaleTerms(product));
}

export function normalizeRequestedWeight(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const amount = Number(value.amount ?? value.value);
  const unit = String(value.unit ?? '').trim().toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || !Object.hasOwn(WEIGHT_UNIT_GRAMS, unit)) return null;
  const grams = amount * WEIGHT_UNIT_GRAMS[unit];
  return Number.isSafeInteger(grams) && grams > 0 ? { amount, unit, grams } : null;
}

export function quoteWeightSale(product, requestedWeight) {
  const terms = weightSaleTerms(product);
  const normalized = normalizeRequestedWeight(requestedWeight);
  if (!terms || !normalized) return null;
  const { grams } = normalized;
  if (grams < terms.minGrams || grams % terms.incrementGrams !== 0) return null;
  return {
    ...terms,
    requestedWeight: normalized,
    grams,
    lineTotal: Math.round((terms.pricePerKg * grams) / 1000),
    available: terms.stockGrams >= grams,
  };
}
