import assert from 'node:assert/strict';
import { basketKey, checkoutProgress } from '../domain/orderCheckout.js';

// A checkout offer persists its basket identity. After hydration, optional
// fields may serialize differently even though the commercial basket is the
// same. The persisted identity must remain authoritative for continuation;
// otherwise the customer is sent back to the same review summary.
const draft = {
  items: [{
    product: { sku: 'sku-1', name: 'Leche', presentation: '1 L', price: 4800 },
    quantity: 1,
    lineTotal: 4800,
  }],
  subtotal: 4800,
  delivery: true,
  paymentMethod: 'cash',
  missingFields: [],
};
const persistedKey = 'persisted-checkout-basket-v1';
const checkout = checkoutProgress({
  draft,
  previous: { basketKey: persistedKey, reviewedKey: persistedKey },
});

assert.equal(checkout.phase, 'confirmation');
assert.equal(checkout.basketKey, persistedKey);
assert.equal(checkout.reviewedKey, persistedKey);
assert.equal(basketKey(draft).startsWith('persisted-'), false);

// An explicitly new collection/review still establishes a fresh identity.
const recollected = checkoutProgress({ draft, previous: { reviewedKey: persistedKey }, collectionComplete: true });
assert.equal(recollected.phase, 'confirmation');
assert.notEqual(recollected.basketKey, persistedKey);
assert.equal(recollected.reviewedKey, recollected.basketKey);

console.log('Checkout basket identity contract passed.');
