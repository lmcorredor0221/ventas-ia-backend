import assert from 'node:assert/strict';
import { whatsappOrderSummary, splitWhatsAppText } from '../domain/whatsappOrderSummary.js';
import { evaluateDeliveryPolicy } from '../domain/deliveryPolicy.js';
import { catalog } from './fixtures/order-edit.mjs';

const tenant = { id: 'summary-test', config: { orderPolicy: { deliveryFee: 3000, deliveryMinimumSubtotal: 0 } } };
const items = catalog.slice(0, 2).map((product, index) => ({ sku: product.sku, name: product.name,
  presentation: product.presentation, quantity: index ? 1 : 2, unitPrice: product.price, lineTotal: index ? 2800 : 14400 }));
const order = { id: 'ord-summary', tenantId: tenant.id, customerName: 'Ana Gómez', deliveryAddress: 'Calle 100 # 20-30',
  paymentMethod: 'bre_b', delivery: true, items, subtotal: 17200,
  pricing: evaluateDeliveryPolicy({ tenant, items, draftVersion: 1 }) };
const review = whatsappOrderSummary(order);
assert.equal(review.complete, true);
assert.match(review.text, /• Coca-Cola original \(1\.5 L\)\n  2 × \$ 7\.200 = \*\$ 14\.400\*/);
assert.match(review.text, /\*Subtotal de productos: \$ 17\.200\*\nDomicilio: \$ 3\.000\n\*Total: \$ 20\.200\*/);
assert.match(review.text, /\*Medio de pago:\* Bre-B/);
assert.match(whatsappOrderSummary(order, { stage: 'received' }).text, /La tienda lo revisará para alistarlo/);
assert.doesNotMatch(whatsappOrderSummary(order, { stage: 'updated' }).text, /¿Confirmamos/);
for (const mutate of [
  o => { o.items[0].unitPrice = null; }, o => { o.items[0].quantity = null; },
  o => { o.items[0].lineTotal = 1; }, o => { o.pricing.subtotal = 0; }, o => { o.pricing.total = 0; },
  o => { o.pricing.deliveryFee = null; o.pricing.total = null; }, o => { o.items = []; },
]) {
  const invalid = structuredClone(order); mutate(invalid);
  const result = whatsappOrderSummary(invalid);
  assert.equal(result.complete, false);
  assert.match(result.text, /\*Total: Por confirmar\*/);
  assert.doesNotMatch(result.text, /\*Total: \$ 0\*/);
}
for (const field of ['customerName', 'deliveryAddress', 'paymentMethod']) {
  const result = whatsappOrderSummary({ ...order, [field]: '' });
  assert.equal(result.complete, false); assert.match(result.text, /Por confirmar/);
}
const amountItem = { name: 'Queso campesino', quantity: null, unitPrice: 15000,
  saleMode: 'amount', requestedAmount: 6000, lineTotal: 6000, allowsSaleByAmount: true };
const amountOrder = { ...order, items: [amountItem], subtotal: 6000,
  pricing: evaluateDeliveryPolicy({ tenant, items: [amountItem] }) };
assert.equal(whatsappOrderSummary(amountOrder).complete, true);
assert.match(whatsappOrderSummary(amountOrder).text, /Por valor solicitado: \*\$ 6\.000\*/);
assert.doesNotMatch(whatsappOrderSummary(amountOrder).text, /×|gramos/);
const free = whatsappOrderSummary({ ...order, pricing: { ...order.pricing, deliveryFee: 0, total: 17200 } });
assert.match(free.text, /Domicilio: \$ 0 \(sin costo\)/);
const noDelivery = whatsappOrderSummary({ ...order, delivery: false, pricing: { ...order.pricing, delivery: false, deliveryFee: 0, total: 17200 } });
assert.match(noDelivery.text, /No incluye servicio de domicilio/);
assert.doesNotMatch(noDelivery.text, /Recoge|recoger|retiro/i);
const custom = whatsappOrderSummary({ ...order, paymentMethod: 'transferencia_tienda' }, { paymentMethods: [{ id: 'transferencia_tienda', label: 'Transferencia a la tienda' }] });
assert.match(custom.text, /Medio de pago:\* Transferencia a la tienda/);
const injected = whatsappOrderSummary({ ...order, customerName: 'Ana\n*Total: $0*' });
assert.match(injected.text, /\*Nombre:\* Ana Total: \$0\n\*Dirección:/);
for (const text of [review.text.repeat(30), '🙂'.repeat(5000), 'a'.repeat(12000)]) {
  const parts = splitWhatsAppText(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => part.length <= 4096 && !/[\uD800-\uDBFF]$/.test(part)));
}
console.log('PASS WhatsApp summaries: names, presentations, line math, totals, unknowns, amount sales, payment labels, no delivery, Unicode and splitting.');
