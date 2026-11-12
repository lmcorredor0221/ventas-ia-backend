import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VARIABLE_PRICE_NOTICE,
  applyVariableFulfillmentAdjustment,
  basketHasVariablePricing,
  initializeVariableEstimate,
} from '../domain/variablePricing.js';
import { whatsappOrderSummary } from '../domain/whatsappOrderSummary.js';
import { evaluateDeliveryPolicy } from '../domain/deliveryPolicy.js';
import { createAppAsync } from '../index.js';

const fixedLine = { sku: 'GASEOSA-1', saleMode: 'units', quantity: 1, unitPrice: 3200, lineTotal: 3200 };
const weightLine = initializeVariableEstimate({
  sku: 'QUESO-CORTE', name: 'Queso doble crema al corte', presentation: 'Al corte', saleMode: 'weight',
  requestedWeightGrams: 250, unitPricePerKg: 43200, lineTotal: 10800,
});
const amountLine = initializeVariableEstimate({
  sku: 'LIMON-GRANEL', name: 'Limón', presentation: 'A granel', saleMode: 'amount',
  requestedAmount: 5000, lineTotal: 5000,
});

assert.equal(basketHasVariablePricing([fixedLine]), false, 'A fixed package must not trigger the notice.');
assert.equal(basketHasVariablePricing([fixedLine, weightLine]), true, 'An actual weight line triggers the notice.');
assert.equal(basketHasVariablePricing([amountLine]), true, 'An actual budget line triggers the notice.');
assert.equal(weightLine.estimatedWeightGrams, 250);
assert.equal(weightLine.estimatedUnitPricePerKg, 43200);
assert.equal(weightLine.estimatedLineTotal, 10800);

const adjustedWeight = applyVariableFulfillmentAdjustment(weightLine, {
  actualWeightGrams: 280,
  actualUnitPricePerKg: 44000,
  reason: 'Peso real verificado en el alistamiento.',
}, { actorId: 'tendero-1', at: '2026-11-11T12:00:00.000Z' });
assert.equal(adjustedWeight.lineTotal, 12320);
assert.equal(adjustedWeight.actualLineTotal, 12320);
assert.equal(adjustedWeight.estimatedLineTotal, 10800, 'The estimated value is immutable evidence.');
assert.equal(adjustedWeight.fulfillmentAdjustments.length, 1);
assert.equal(adjustedWeight.fulfillmentAdjustments[0].before.actualLineTotal, 10800);
assert.equal(adjustedWeight.fulfillmentAdjustments[0].reason, 'Peso real verificado en el alistamiento.');

const adjustedAmount = applyVariableFulfillmentAdjustment(amountLine, { actualLineTotal: 4800 }, {
  actorId: 'tendero-1', at: '2026-11-11T12:01:00.000Z',
});
assert.equal(adjustedAmount.actualLineTotal, 4800, 'Budget orders record a final monetary value without inventing grams.');
assert.equal(adjustedAmount.actualWeightGrams, null);

const updateSummary = whatsappOrderSummary({
  id: 'ord-variable-1', customerName: 'Luis', deliveryAddress: 'Calle 1', paymentMethodLabel: 'Tarjeta',
  items: [adjustedWeight, fixedLine], subtotal: 15520, pricing: { subtotal: 15520, deliveryFee: 0, total: 15520 },
  customerReconfirmation: { status: 'required', difference: 1520 },
  customerChangeSummary: { reason: 'Peso real verificado en el alistamiento.', itemChanges: [{ type: 'changed', before: { name: 'Queso doble crema al corte', lineTotal: 10800 }, after: { name: 'Queso doble crema al corte', lineTotal: 12320 } }] },
}, { stage: 'updated' });
assert.match(updateSummary, /estimado/i);
assert.match(updateSummary, /Antes de cualquier cobro adicional/i);
assert.match(updateSummary, /Cambios realizados/i);
assert.match(updateSummary, /Peso real verificado/i);

// Exercise the real checkout wiring: payment selection sends the notice once,
// preserves the usual confirmation actions, and fixed baskets never receive it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-variable-pricing-'));
const { store, runtime, orders, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', whatsappMode: 'mock', backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});
runtime.planner = {};
const tenantId = 'andina';
const customer = { name: 'Luis', defaultAddress: 'Calle 1' };
const product = {
  sku: 'QUESO-CORTE', name: 'Queso doble crema al corte', presentation: 'Al corte', price: 43200, stock: 1,
  attributes: { commerce: { saleModes: ['weight'], weight: { pricePerKg: 43200, stockGrams: 5000, minGrams: 50, incrementGrams: 50 } } },
};
const fixedProduct = { sku: 'GASEOSA-1', name: 'Gaseosa', presentation: '600 ml', price: 3200, stock: 10 };
const conversationId = 'variable-payment-notice';
const args = {
  tenantId, conversationId, customerProfile: customer,
  normalized: { waId: '573000009999', text: 'media libra de queso' },
};
const conversation = () => store.getState().conversations.find(item => item.id === args.conversationId);
const offer = purpose => Object.values(store.getState().interactionOffersById ?? {})
  .filter(item => item.conversationId === args.conversationId && item.purpose === purpose && item.status === 'active').at(-1);
const lastAgent = () => conversation().messages.filter(item => item.role === 'agent').at(-1);
const click = option => runtime.handleInteractiveReply({ ...args, normalized: {
  ...args.normalized, text: option.title, interactive: { optionId: option.id },
} });

try {
  store.mutate(state => {
    state.productsByTenant[tenantId] = [structuredClone(product), structuredClone(fixedProduct)];
    state.conversations.unshift({ id: conversationId, tenantId, waId: args.normalized.waId, messages: [], status: 'live' });
  });
  await runtime.handleDeliveryOrder({ ...args, plan: {
    intent: 'delivery_order', customerDetails: { name: customer.name, deliveryAddress: customer.defaultAddress }, order: { delivery: true, items: [{
      rawName: 'queso doble crema', catalogQuery: 'queso doble crema',
      requestedWeight: { amount: 0.5, unit: 'lb' },
    }] }, missingFields: [],
  } });
  await click(offer('cart_review').options[0]);
  const payment = offer('payment_method');
  assert.ok(payment, 'Review must advance to payment.');
  await click(payment.options.find(option => option.value === 'cash'));
  assert.match(lastAgent().text, new RegExp(VARIABLE_PRICE_NOTICE.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(lastAgent().interactive.buttons.map(button => button.title), ['Confirmar pedido', 'Ajustar pedido', 'Hablar con la tienda']);
  const noticeAt = conversation().orderDraft.variablePricingNoticeSentAt;
  assert.ok(noticeAt);

  // A later continuation cannot duplicate the advisory for the same draft.
  await runtime.handleOrderClarification({ ...args, normalized: { ...args.normalized, text: 'sí' }, plan: { intent: 'order_clarification', order: {} } });
  assert.equal(conversation().messages.filter(item => item.role === 'agent' && item.text.includes(VARIABLE_PRICE_NOTICE)).length, 1);

  args.conversationId = 'fixed-payment-notice';
  args.normalized = { ...args.normalized, waId: '573000009998', text: 'una gaseosa' };
  store.mutate(state => state.conversations.unshift({ id: args.conversationId, tenantId, waId: args.normalized.waId, messages: [], status: 'live' }));
  await runtime.handleDeliveryOrder({ ...args, plan: {
    intent: 'delivery_order', customerDetails: { name: customer.name, deliveryAddress: customer.defaultAddress }, order: { delivery: true, items: [{ skuHint: fixedProduct.sku, catalogQuery: fixedProduct.name, quantity: 1 }] }, missingFields: [],
  } });
  await click(offer('cart_review').options[0]);
  await click(offer('payment_method').options.find(option => option.value === 'cash'));
  assert.doesNotMatch(lastAgent().text, /productos solicitados por peso/i);

  // The fulfillment endpoint is the transactional boundary: it keeps the
  // estimate, writes the audit, queues the customer update and blocks dispatch
  // only when a tenant explicitly configured the selected method as prepaid.
  const preparedItems = [structuredClone(weightLine)];
  store.mutate(state => {
    const tenant = state.tenants.find(item => item.id === tenantId);
    tenant.config.orderPolicy.paymentMethods = [{ id: 'breb', label: 'Bre-B', paymentTiming: 'prepaid' }];
    const pricing = evaluateDeliveryPolicy({ tenant, items: preparedItems, delivery: true, draftVersion: 0 });
    state.ordersByTenant[tenantId] ??= [];
    state.ordersByTenant[tenantId].push({
      id: 'ord-variable-adjustment', tenantId, conversationId: 'variable-fulfillment', status: 'preparing', version: 0,
      customerName: 'Luis', deliveryAddress: 'Calle 1', delivery: true, paymentMethod: 'breb', paymentMethodLabel: 'Bre-B',
      items: preparedItems, subtotal: pricing.subtotal, pricing, statusHistory: [], editHistory: [], createdAt: '2026-11-11T12:00:00.000Z', updatedAt: '2026-11-11T12:00:00.000Z',
    });
  });
  const fulfillment = await orders.adjustVariablePricing({ orderId: 'ord-variable-adjustment', tenantId, actorId: 'tendero-1', input: {
    sku: weightLine.sku, expectedVersion: 0, actualWeightGrams: 300, actualUnitPricePerKg: 43200, reason: 'Peso real confirmado por la tienda.',
  } });
  assert.equal(fulfillment.order.pricing.total, 12960);
  assert.equal(fulfillment.order.customerReconfirmation.status, 'required');
  assert.equal(fulfillment.order.items[0].estimatedLineTotal, 10800);
  assert.equal(fulfillment.order.items[0].actualLineTotal, 12960);
  assert.equal(fulfillment.order.variablePricingAdjustments.length, 1);
  assert.equal(fulfillment.order.variablePricingAdjustments[0].reason, 'Peso real confirmado por la tienda.');
  assert.equal(fulfillment.notification, 'queued');
  assert.ok(store.getState().integrationOutbox.some(entry => entry.kind === 'order.summary_notification'
    && entry.aggregateId === 'ord-variable-adjustment' && entry.payload?.stage === 'updated'), 'A total change queues the client update.');
  await assert.rejects(
    orders.transition({ orderId: 'ord-variable-adjustment', tenantId, nextStatus: 'dispatched', actorId: 'tendero-1' }),
    { code: 'order_customer_reconfirmation_required' },
  );
  const unchanged = await orders.adjustVariablePricing({ orderId: 'ord-variable-adjustment', tenantId, actorId: 'tendero-1', input: {
    sku: weightLine.sku, expectedVersion: 1, actualWeightGrams: 300, actualUnitPricePerKg: 43200,
  } });
  assert.equal(unchanged.notification, 'not_queued', 'Saving identical real values must not notify the client again.');
  assert.equal(unchanged.order.customerReconfirmation.status, 'required', 'An unchanged save must not clear an already-required reconfirmation.');
  assert.equal(store.getState().integrationOutbox.filter(entry => entry.kind === 'order.summary_notification' && entry.aggregateId === 'ord-variable-adjustment').length, 1);
  const reconfirmed = await orders.confirmVariablePricing({ orderId: 'ord-variable-adjustment', tenantId, actorId: 'tendero-1', input: { expectedVersion: 2 } });
  assert.equal(reconfirmed.order.customerReconfirmation.status, 'confirmed');
  await orders.transition({ orderId: 'ord-variable-adjustment', tenantId, nextStatus: 'dispatched', actorId: 'tendero-1' });
  console.log('Variable pricing contract passed: line modes, audit, checkout notice and fixed basket guard.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
