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
  const unresolved = !draft.items?.length || (draft.missingFields ?? []).some(field => field !== 'payment_method')
    || draft.items.some(item => !item.product || !(Number(item.product.price) > 0)
      || !(Number(item.lineTotal) > 0) || item.available === false);
  const reviewedKey = !unresolved && collectionComplete === true ? key
    : collectionComplete === false ? null : previous?.reviewedKey ?? null;
  const phase = unresolved ? 'collecting' : reviewedKey !== key ? 'review'
    : draft.delivery && !draft.paymentMethod ? 'payment' : 'confirmation';
  return {
    phase,
    basketKey: key,
    reviewedKey: reviewedKey === key ? reviewedKey : null,
    // Persist only the semantic signal produced for this turn. Callers decide
    // explicitly when it is valid to carry it into a catalog-choice reply.
    collectionComplete: collectionComplete === true,
  };
}
