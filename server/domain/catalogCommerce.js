const POSITIVE_INT = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const NON_NEGATIVE_INT = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

const WEIGHT_UNIT_GRAMS = {
  g: 1,
  gr: 1,
  gramos: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  kilogramo: 1000,
  kilogramos: 1000,
  lb: 500,
  libra: 500,
  libras: 500,
  arroba: 12500,
};

const SALE_MODE_ALIASES = Object.freeze({
  units: 'unit',
  unit: 'unit',
  unidad: 'unit',
  unidades: 'unit',
  weight: 'weight',
  peso: 'weight',
  amount: 'amount',
  presupuesto: 'amount',
  valor: 'amount',
});

function commerceConfig(product = {}) {
  const commerce = product?.attributes?.commerce;
  return commerce && typeof commerce === 'object' && !Array.isArray(commerce) ? commerce : {};
}

export function saleModesForProduct(product = {}) {
  const configured = commerceConfig(product).saleModes;
  const modes = new Set(Array.isArray(configured)
    ? configured
      .map(value => SALE_MODE_ALIASES[String(value).trim().toLowerCase()] ?? null)
      .filter(Boolean)
    : []);
  if (product?.allowsSaleByAmount === true) modes.add('amount');
  // Legacy rows without an explicit commerce contract are unit-sale rows.
  // An explicit contract remains authoritative, so a weight/amount-only row
  // is not silently made unit-saleable.
  if (configured == null) modes.add('unit');
  return modes;
}

export function supportsUnitSale(product = {}) {
  return saleModesForProduct(product).has('unit');
}

export function supportsAmountSale(product = {}) {
  return saleModesForProduct(product).has('amount');
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

export function weightGramsForValue(value, unit) {
  const amount = Number(value);
  const normalizedUnit = String(unit ?? '').trim().toLowerCase();
  const multiplier = WEIGHT_UNIT_GRAMS[normalizedUnit];
  if (!Number.isFinite(amount) || amount <= 0 || !multiplier) return null;
  const grams = amount * multiplier;
  return Number.isSafeInteger(grams) && grams > 0 ? grams : null;
}

export function normalizeRequestedWeight(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const amount = Number(value.amount ?? value.value);
  const unit = String(value.unit ?? '').trim().toLowerCase();
  const grams = weightGramsForValue(amount, unit);
  return grams ? { amount, unit, grams } : null;
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
