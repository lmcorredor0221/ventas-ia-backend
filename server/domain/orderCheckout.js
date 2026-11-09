import { createHash } from 'node:crypto';

// Commercial sequencing is enforced here; the interpreter decides from context
// whether the buyer has finished adding items. Payment alone is not that signal.
export function basketKey(draft = {}) {
  const lines = (draft.items ?? []).map(item => [item.product?.sku ?? item.skuHint ?? item.catalogQuery,
    item.product?.name, item.product?.presentation, item.quantity, item.budgetAmount,
    item.requestedPresentation, item.requestedAttributes, item.product?.price, item.lineTotal]);
  return createHash('sha256').update(JSON.stringify([lines, draft.subtotal, draft.delivery])).digest('hex');
}

export function checkoutProgress({ draft, previous, collectionComplete = null }) {
  const key = basketKey(draft);
  const missingFields = draft.missingFields ?? [];
  // A basket may be complete before we know who receives it or where it goes.
  // Those checkout facts must not erase the buyer's explicit acceptance of the
  // basket; otherwise every name/address turn returns to the review phase.
  const basketUnresolved = !draft.items?.length || missingFields.some(field => ![
    'customer_name', 'delivery_address', 'payment_method',
  ].includes(field))
    || draft.items.some(item => !item.product || !(Number(item.product.price) > 0)
      || !(Number(item.lineTotal) > 0) || item.available === false);
  const checkoutDetailsPending = missingFields.includes('customer_name') || missingFields.includes('delivery_address');
  const reviewedKey = !basketUnresolved && collectionComplete === true ? key
    : collectionComplete === false ? null : previous?.reviewedKey ?? null;
  const phase = basketUnresolved || checkoutDetailsPending ? 'collecting' : reviewedKey !== key ? 'review'
    : draft.delivery && !draft.paymentMethod ? 'payment' : 'confirmation';
  return { phase, basketKey: key, reviewedKey: reviewedKey === key ? reviewedKey : null };
}
