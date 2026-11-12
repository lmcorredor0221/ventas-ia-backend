import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { evaluateDeliveryPolicy } from '../domain/deliveryPolicy.js';
import { createOrderSummaryNotification } from '../services/orderSummaryNotification.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-manual-product-review-'));
const app = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});
const { store, runtime, orders, integrationOutbox, tools, events } = app;
const tenantId = 'andina';
const product = {
  sku: 'BROWNIE-AREQUIPE',
  name: 'Brownie Mamai de Arequipe',
  presentation: '60 g',
  brand: 'Mamai',
  category: 'Ponqués y brownies',
  productFamily: 'Brownie',
  price: 3500,
  stock: 20,
  active: true,
};

function pendingReview(rawName = 'brownie mamai de arequipe') {
  return {
    version: 1,
    status: 'pending',
    lines: [{
      id: 'missing-brownie',
      lineId: 'missing-brownie',
      rawName,
      catalogQuery: rawName,
      requestedQuantity: 2,
      status: 'pending',
      reason: 'catalog_product_not_found',
    }],
  };
}

try {
  let initialPricing;
  store.mutate(state => {
    const tenant = state.tenants.find(item => item.id === tenantId);
    const baseItems = [{
      sku: 'COCA-15', name: 'Coca-Cola Original', presentation: '1.5 L', saleMode: 'units',
      quantity: 1, unitPrice: 7200, lineTotal: 7200,
    }];
    initialPricing = evaluateDeliveryPolicy({ tenant, items: baseItems, delivery: true, draftVersion: 0 });
    state.productsByTenant[tenantId] = [product];
    state.conversations.unshift({ id: 'manual-review-conv', tenantId, waId: '573001112233', messages: [], status: 'blocked' });
    state.ordersByTenant[tenantId] ??= [];
    state.ordersByTenant[tenantId].unshift({
      id: 'ord-manual-review', tenantId, conversationId: 'manual-review-conv', waId: '573001112233',
      customerName: 'Luis', deliveryAddress: 'Calle 1', delivery: true,
      paymentMethod: 'cash', paymentMethodLabel: 'Efectivo',
      items: baseItems, subtotal: 7200, pricing: initialPricing,
      status: 'pending_human_preparation', version: 0, statusHistory: [], editHistory: [],
      manualProductReview: pendingReview(),
    });
    state.pendingRequests.unshift({
      id: 'prepare-manual-review', tenantId, conversationId: 'manual-review-conv', type: 'human_handoff',
      status: 'pending', action: 'prepare_delivery_order', assignedTeam: 'operaciones',
      contextSnapshot: { orderId: 'ord-manual-review', action: 'prepare_delivery_order' },
    });
  });

  const found = await orders.resolveManualProductFound({
    orderId: 'ord-manual-review', tenantId, lineId: 'missing-brownie', actorId: 'tendero-1',
    input: { expectedVersion: 0, sku: product.sku, quantity: 2, reason: 'La tienda encontró la referencia solicitada.' },
  });
  assert.equal(found.order.items.length, 2);
  assert.equal(found.order.items[1].sku, product.sku);
  assert.equal(found.order.items[1].quantity, 2);
  assert.equal(found.order.subtotal, 14200);
  assert.equal(found.order.manualProductReview.lines[0].status, 'found');
  assert.equal(found.order.manualProductReview.status, 'awaiting_customer_confirmation');
  assert.equal(found.order.customerReconfirmation.status, 'required');
  assert.ok(store.getState().integrationOutbox.some(entry => entry.kind === 'order.summary_notification'
    && entry.aggregateId === found.order.id && entry.payload.stage === 'manual_review_found'));
  await assert.rejects(
    orders.transition({ orderId: found.order.id, tenantId, nextStatus: 'preparing', actorId: 'tendero-1', allowPendingRequest: true }),
    { code: 'order_customer_reconfirmation_required' },
  );

  const notificationEntry = store.getState().integrationOutbox.find(entry => entry.kind === 'order.summary_notification'
    && entry.aggregateId === found.order.id && entry.payload.stage === 'manual_review_found');
  await createOrderSummaryNotification({ store, tools, events })(notificationEntry);
  const confirmationOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find(offer => offer.purpose === 'order_change_confirmation' && offer.status === 'active');
  assert.ok(confirmationOffer, 'The updated summary must ask the customer to confirm the change.');
  const confirmOption = confirmationOffer.options.find(option => option.action === 'confirm_order_change');
  const confirmedInteraction = await runtime.processInbound({
    tenantId,
    conversationId: 'manual-review-conv',
    waId: '573001112233',
    messageId: 'wamid.manual-review-confirmation',
    text: confirmOption.title,
    interactive: { optionId: confirmOption.id },
  });
  assert.equal(confirmedInteraction.result.summary, 'Customer confirmed updated order');
  const confirmed = { order: orders.findOrder(found.order.id, tenantId) };
  assert.equal(confirmed.order.customerReconfirmation.status, 'confirmed');
  assert.equal(confirmed.order.manualProductReview.status, 'resolved');
  const preparing = await orders.transition({
    orderId: found.order.id, tenantId, nextStatus: 'preparing', actorId: 'tendero-1', allowPendingRequest: true,
  });
  assert.equal(preparing.order.status, 'preparing');

  store.mutate(state => {
    const tenant = state.tenants.find(item => item.id === tenantId);
    const items = [{ sku: 'COCA-15', name: 'Coca-Cola Original', presentation: '1.5 L', saleMode: 'units', quantity: 1, unitPrice: 7200, lineTotal: 7200 }];
    const pricing = evaluateDeliveryPolicy({ tenant, items, delivery: true, draftVersion: 0 });
    state.ordersByTenant[tenantId].unshift({
      id: 'ord-manual-unavailable', tenantId, conversationId: 'manual-review-conv', waId: '573001112233',
      customerName: 'Luis', deliveryAddress: 'Calle 1', delivery: true,
      paymentMethod: 'cash', paymentMethodLabel: 'Efectivo', items, subtotal: 7200, pricing,
      status: 'pending_human_preparation', version: 0, statusHistory: [], editHistory: [],
      manualProductReview: pendingReview('producto especial'),
    });
  });
  const unavailable = await orders.resolveManualProductUnavailable({
    orderId: 'ord-manual-unavailable', tenantId, lineId: 'missing-brownie', actorId: 'tendero-1',
    input: { expectedVersion: 0, reason: 'La tienda verificó el inventario y no está disponible.' },
  });
  assert.equal(unavailable.order.items.length, 1);
  assert.equal(unavailable.order.manualProductReview.lines[0].status, 'unavailable');
  assert.equal(unavailable.order.manualProductReview.status, 'resolved');
  assert.equal(unavailable.order.customerReconfirmation, null);
  assert.ok(store.getState().integrationOutbox.some(entry => entry.kind === 'order.summary_notification'
    && entry.aggregateId === unavailable.order.id && entry.payload.stage === 'manual_review_unavailable'));

  store.mutate(state => {
    const tenant = state.tenants.find(item => item.id === tenantId);
    const items = [{ sku: 'COCA-15', name: 'Coca-Cola Original', presentation: '1.5 L', saleMode: 'units', quantity: 1, unitPrice: 7200, lineTotal: 7200 }];
    const pricing = evaluateDeliveryPolicy({ tenant, items, delivery: true, draftVersion: 0 });
    state.ordersByTenant[tenantId].unshift({
      id: 'ord-manual-mixed', tenantId, conversationId: 'manual-review-conv', waId: '573001112233',
      customerName: 'Luis', deliveryAddress: 'Calle 1', delivery: true,
      paymentMethod: 'cash', paymentMethodLabel: 'Efectivo', items, subtotal: 7200, pricing,
      status: 'pending_human_preparation', version: 0, statusHistory: [], editHistory: [],
      manualProductReview: {
        version: 1,
        status: 'pending',
        lines: [
          { id: 'mixed-found', lineId: 'mixed-found', rawName: 'brownie mamai', catalogQuery: 'brownie mamai', requestedQuantity: 1, status: 'pending' },
          { id: 'mixed-unavailable', lineId: 'mixed-unavailable', rawName: 'producto agotado', catalogQuery: 'producto agotado', requestedQuantity: 1, status: 'pending' },
        ],
      },
    });
  });
  const mixedFound = await orders.resolveManualProductFound({
    orderId: 'ord-manual-mixed', tenantId, lineId: 'mixed-found', actorId: 'tendero-1',
    input: { expectedVersion: 0, sku: product.sku, quantity: 1 },
  });
  const mixedUnavailable = await orders.resolveManualProductUnavailable({
    orderId: 'ord-manual-mixed', tenantId, lineId: 'mixed-unavailable', actorId: 'tendero-1',
    input: { expectedVersion: mixedFound.order.version },
  });
  assert.equal(mixedUnavailable.order.manualProductReview.status, 'awaiting_customer_confirmation');
  const mixedNotification = store.getState().integrationOutbox.find(entry => entry.kind === 'order.summary_notification'
    && entry.aggregateId === mixedUnavailable.order.id && entry.payload.stage === 'manual_review_unavailable');
  await createOrderSummaryNotification({ store, tools, events })(mixedNotification);
  const mixedOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find(offer => offer.purpose === 'order_change_confirmation' && offer.status === 'active'
      && offer.options.some(option => option.value?.includes('ord-manual-mixed')));
  assert.ok(mixedOffer, 'A mixed found/unavailable review must still request confirmation for the added product.');

  console.log('Manual product review order flow passed: found, unavailable, reconfirmation and preparation guard.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
