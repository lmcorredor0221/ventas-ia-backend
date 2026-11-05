import assert from 'node:assert/strict';
import { applyOrderDataAudit, orderDataRevision } from '../domain/orderDataAudit.js';
const tenant = { id: 'a', config: { orderPolicy: { deliveryFee: 2000, deliveryMinimumSubtotal: 0 } } };
const product = { tenantId: 'a', sku: 'SAL', name: 'Salchichón', price: 5000, stock: 10, active: true, allowsSaleByAmount: true };
const messages = [{ id: 'm1', role: 'user', text: 'Quiero 5000 pesos de salchichón y dos panes. Pago en efectivo.' },
  { id: 'm2', role: 'user', text: 'Corrijo, solo un pan, sin duplicarlo.' }];
const pan = { tenantId: 'a', sku: 'PAN', name: 'Pan', price: 1000, stock: 9, active: true };
const line = { rawItemId: 's', product, quantity: 1 };
const draft = { items: [line, { rawItemId: 'p', product: pan, quantity: 2 }, { rawItemId: 'duplicate', product: pan, quantity: 1 }], delivery: true };
const evidence = [{ messageId: 'm1', quote: '5000 pesos de salchichón' }];
const correction = { op: 'update_line', rawItemId: 's', changes: { saleMode: 'amount', quantity: null, requestedAmount: 5000 }, evidence, reason: 'Compra por importe' };
const input = { draft, tenant, messages, catalog: [product, pan], paymentMethods: [{ id: 'cash' }] };
const run = corrections => applyOrderDataAudit({ ...input, result: { purchaseIntent: 'purchase', verdict: 'correct', corrections, reason: 'Rectificación' } });
const result = run([correction,
  { op: 'update_line', rawItemId: 'p', changes: { quantity: 1 }, evidence: [{ messageId: 'm2', quote: 'solo un pan' }], reason: 'Cantidad final explícita' },
  { op: 'remove_line', rawItemId: 'duplicate', evidence: [{ messageId: 'm2', quote: 'sin duplicarlo' }], reason: 'No duplicar' }]);
assert.equal(result.draft.items.length, 2); assert.equal(result.draft.items[0].quantity, null);
assert.equal(result.draft.items[0].lineTotal, 5000); assert.equal(result.draft.items[1].lineTotal, 1000);
assert.equal(draft.items.length, 3, 'No mutating input state');
assert.notEqual(orderDataRevision(result.draft, tenant), orderDataRevision(draft, tenant));
assert.throws(() => run([{ ...correction, changes: { price: 1 } }]), /audit_invalid_fields/);
assert.throws(() => run([{ ...correction, changes: { allowsSaleByAmount: true } }]), /audit_invalid_fields/);
assert.throws(() => run([{ ...correction, evidence: [{ messageId: 'fake', quote: '5000' }] }]), /audit_invalid_evidence/);
assert.throws(() => run([{ ...correction, evidence: [{ messageId: 'm1', quote: '100 pesos' }] }]), /audit_invalid_evidence/);
assert.throws(() => run([{ ...correction, sku: 'FOREIGN' }]), /audit_unknown_product/);
assert.throws(() => applyOrderDataAudit({ ...input, catalog: [{ ...product, tenantId: 'b' }], result: { purchaseIntent: 'purchase', verdict: 'correct', corrections: [correction] } }), /audit_unknown_product/);
assert.throws(() => applyOrderDataAudit({ ...input, catalog: [{ ...product, allowsSaleByAmount: false }], result: { purchaseIntent: 'purchase', verdict: 'correct', corrections: [correction] } }), /audit_amount_not_authorized/);
assert.throws(() => run([{ ...correction, changes: { saleMode: 'amount', quantity: 1, requestedAmount: 5000 } }]), /audit_unpriced_line/);
assert.throws(() => run([{ ...correction, op: 'set_field', field: 'paymentVerified', value: true }]), /audit_forbidden_field/);
assert.throws(() => run([{ ...correction, op: 'set_field', field: 'paymentMethod', value: 'unknown' }]), /audit_invalid_payment/);
const added = run([{ op: 'add_line', sku: 'PAN', changes: { quantity: 1, saleMode: 'units' },
  evidence: [{ messageId: 'm2', quote: 'solo un pan' }], reason: 'Producto omitido' }]);
assert.equal(added.draft.items.at(-1).product.sku, 'PAN');
assert.deepEqual(applyOrderDataAudit({ ...input, result: { purchaseIntent: 'purchase', verdict: 'approve', corrections: [] } }).draft, draft);
console.log('PASS order audit: corrections, unchanged basket, provenance, tenant boundary, immutable commerce and payment scope');
