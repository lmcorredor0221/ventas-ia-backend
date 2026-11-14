import { createHash } from 'node:crypto';

// Commercial sequencing is enforced here; the interpreter decides from context
// whether the buyer has finished adding items. Payment alone is not that signal.
export function basketKey(draft = {}) {
  const lines = activeItems(draft.items).map(item => [item.product?.sku ?? item.skuHint ?? item.catalogQuery,
    item.product?.name, item.product?.presentation, item.quantity, item.budgetAmount,
    item.requestedWeight, item.requestedWeightGrams, item.unitPricePerKg,
    item.requestedPresentation, stableHashValue(item.requestedAttributes), item.product?.price, item.lineTotal]
    .map((value, index) => normalizeHashValue(value, index)));
  lines.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash('sha256').update(JSON.stringify([lines, normalizeHashValue(draft.subtotal), Boolean(draft.delivery)])).digest('hex');
}

// Interactive checkout offers persist the identity of the basket that the
// customer reviewed. Hydrating the draft can normalize optional fields and
// produce a different hash for the same commercial basket. Once a persisted
// identity exists, it is the canonical identity until the runtime explicitly
// starts a new collection/review cycle.
export function checkoutBasketKey({ draft = {}, previous = null, collectionComplete = null, basketChanged = false } = {}) {
  if (collectionComplete === true || basketChanged === true) return basketKey(draft);
  const persisted = previous?.basketKey ?? draft?.checkout?.basketKey;
  return typeof persisted === 'string' && persisted.trim()
    ? persisted
    : basketKey(draft);
}

export function checkoutProgress({ draft, previous, collectionComplete = null, basketChanged = false }) {
  const key = checkoutBasketKey({ draft, previous, collectionComplete, basketChanged });
  const missingFields = draft.missingFields ?? [];
  const items = activeItems(draft.items);
  // A basket may be complete before we know who receives it or where it goes.
  // Those checkout facts must not erase the buyer's explicit acceptance of the
  // basket; otherwise every name/address turn returns to the review phase.
  const basketUnresolved = !items.length || missingFields.some(field => ![
    'customer_name', 'delivery_address', 'payment_method',
  ].includes(field))
    || items.some(item => !item.product || !(Number(item.product.price) > 0)
      || !(Number(item.lineTotal) > 0) || item.available === false);
  const checkoutDetailsPending = missingFields.includes('customer_name') || missingFields.includes('delivery_address');
  const reviewedKey = !basketUnresolved && collectionComplete === true ? key
    : collectionComplete === false ? null
      : previous?.reviewedKey === key ? previous.reviewedKey : null;
  const phase = basketUnresolved || checkoutDetailsPending ? 'collecting' : reviewedKey !== key ? 'review'
    : draft.delivery && !draft.paymentMethod ? 'payment' : 'confirmation';
  return { phase, basketKey: key, reviewedKey: reviewedKey === key ? reviewedKey : null };
}

function activeItems(items = []) {
  return (items ?? []).filter((item) => item?.removedByCustomer !== true && item?.selectionStatus !== 'removed');
}

function stableHashValue(value) {
  if (Array.isArray(value)) return value.map(stableHashValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableHashValue(value[key])]));
  }
  return value === undefined ? null : value;
}

function normalizeHashValue(value, index = null) {
  const numericIndexes = new Set([3, 4, 5, 6, 9, 10]);
  if (numericIndexes.has(index) && value !== null && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return stableHashValue(value);
}
