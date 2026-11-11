import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { normalizeCandidateItems } from '../services/llmPlanner.js';

// Regression: the LLM can understand a reply such as "una de cada una" and
// return numerical updates for existing lines. Those updates must reach the
// operational basket without treating a semantic measure ("media libra") as
// a unit quantity or a stock failure.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-llm-line-updates-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});

const tenantId = 'andina';
const conversationId = 'llm-line-updates';
const waId = '573000000906';
const pan = { sku: 'PAN-500', name: 'Pan tajado blanco Bimbo', presentation: '500 g', price: 10200, stock: 50, category: 'Panadería' };
const queso = { sku: 'QUESO-250', name: 'Queso doble crema Colanta', presentation: '250 g', price: 10800, stock: 24, category: 'Lácteos' };

const measuredInference = normalizeCandidateItems([{
  rawName: 'queso doble crema',
  quantity: 2,
  quantityExplicit: false,
  requestedMeasure: 'media libra',
}])[0];
assert.equal(measuredInference.quantity, null,
  'An inferred carry-over number cannot replace an explicit semantic measure');
assert.equal(measuredInference.requestedMeasure, 'media libra');

function seedDraft(id, { cheeseStock = queso.stock } = {}) {
  const cheese = { ...queso, stock: cheeseStock };
  store.mutate((state) => {
    state.conversations.unshift({
      id,
      tenantId,
      waId: `${waId}${id.length}`,
      messages: [],
      status: 'live',
      orderDraft: {
        delivery: true,
        items: [
          { lineId: `${id}-pan`, rawName: 'pan tajado', catalogQuery: 'pan tajado', quantity: null, selectionStatus: 'selected', product: structuredClone(pan) },
          { lineId: `${id}-queso`, rawName: 'queso doble crema', catalogQuery: 'queso doble crema', quantity: 'media libra', selectionStatus: 'selected', product: structuredClone(cheese) },
        ],
        missingFields: ['quantity:pan tajado', 'quantity:queso doble crema'],
      },
    });
  });
  return cheese;
}

store.mutate((state) => {
  state.productsByTenant[tenantId] = [structuredClone(pan), structuredClone(queso)];
  state.conversations.unshift({
    id: conversationId,
    tenantId,
    waId,
    messages: [],
    status: 'live',
    orderDraft: {
      delivery: true,
      items: [
        { lineId: 'line-pan', rawName: 'pan tajado', catalogQuery: 'pan tajado', quantity: null, selectionStatus: 'selected', product: structuredClone(pan) },
        // This value mirrors legacy/provider data before the boundary fix.
        // It is semantic evidence, not a numeric stock quantity.
        { lineId: 'line-queso', rawName: 'queso doble crema', catalogQuery: 'queso doble crema', quantity: 'media libra', selectionStatus: 'selected', product: structuredClone(queso) },
      ],
      missingFields: ['quantity:pan tajado', 'quantity:queso doble crema'],
    },
  });
});

try {
  await runtime.handleOrderClarification({
    tenantId,
    conversationId,
    normalized: { waId, text: 'una de cada una', traceId: 'llm-line-updates' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle de prueba 1' },
    preserveExistingCatalogSelections: true,
    plan: {
      intent: 'order_clarification',
      order: { delivery: true },
      lineUpdates: [
        { lineId: 'line-pan', quantity: 1, quantityExplicit: true },
        { lineId: 'line-queso', quantity: 1, quantityExplicit: true },
      ],
      missingFields: [],
    },
  });

  const conversation = store.getState().conversations.find((item) => item.id === conversationId);
  const draft = conversation.orderDraft;
  assert.equal(draft.items.find((item) => item.lineId === 'line-pan').quantity, 1);
  assert.equal(draft.items.find((item) => item.lineId === 'line-queso').quantity, 1);
  assert.equal(draft.items.find((item) => item.lineId === 'line-queso').requestedMeasure, 'media libra');
  assert.equal(draft.items.every((item) => item.available === true), true, 'validated unit quantities must use real stock');
  assert.equal(draft.missingFields.some((field) => field.startsWith('stock:')), false, 'a semantic measure is not a stock shortage');
  assert.equal(draft.subtotal, 21000);
  assert.notEqual(conversation.status, 'blocked');

  // The resolved basket must advance through its normal checkout boundary;
  // it must not restart catalog search or fall back to a human handoff.
  await runtime.handleOrderClarification({
    tenantId,
    conversationId,
    normalized: { waId, text: 'continuar pedido', traceId: 'llm-line-updates-continue' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle de prueba 1' },
    preserveExistingCatalogSelections: true,
    plan: {
      intent: 'order_clarification',
      order: { delivery: true, collectionComplete: true },
      missingFields: [],
    },
  });
  const checkoutConversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(checkoutConversation.orderDraft.checkout.phase, 'payment');
  assert.deepEqual(checkoutConversation.orderDraft.missingFields, ['payment_method']);

  // Different contextual phrasings can update several existing lines with
  // mixed quantities; arithmetic remains a runtime responsibility.
  const mixedId = 'mixed-quantities';
  seedDraft(mixedId);
  await runtime.handleOrderClarification({
    tenantId, conversationId: mixedId,
    normalized: { waId: '573000000905', text: 'dos panes y tres quesos', traceId: 'mixed-quantities' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle de prueba 1' }, preserveExistingCatalogSelections: true,
    plan: { intent: 'order_clarification', order: { delivery: true }, lineUpdates: [
      { lineId: `${mixedId}-pan`, quantity: 2, quantityExplicit: true },
      { lineId: `${mixedId}-queso`, quantity: 3, quantityExplicit: true },
    ], missingFields: [] },
  });
  const mixed = store.getState().conversations.find((item) => item.id === mixedId).orderDraft;
  assert.equal(mixed.subtotal, 52800);
  assert.equal(mixed.missingFields.some((field) => field.startsWith('stock:')), false);

  // A genuinely ambiguous reply keeps quantity pending; it must never become
  // a fabricated stock failure merely because one line has a semantic measure.
  const ambiguousId = 'ambiguous-reply';
  seedDraft(ambiguousId);
  await runtime.handleOrderClarification({
    tenantId, conversationId: ambiguousId,
    normalized: { waId: '573000000904', text: 'el de siempre', traceId: 'ambiguous-reply' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle de prueba 1' }, preserveExistingCatalogSelections: true,
    plan: { intent: 'order_clarification', order: { delivery: true }, missingFields: [] },
  });
  const ambiguous = store.getState().conversations.find((item) => item.id === ambiguousId).orderDraft;
  assert.equal(ambiguous.missingFields.some((field) => field.startsWith('quantity:')), true);
  assert.equal(ambiguous.missingFields.some((field) => field.startsWith('stock:')), false);

  // A true lack of stock is still surfaced once an operational quantity exists.
  const stockId = 'actual-stock-gap';
  seedDraft(stockId, { cheeseStock: 1 });
  await runtime.handleOrderClarification({
    tenantId, conversationId: stockId,
    normalized: { waId: '573000000903', text: 'una de pan y dos de queso', traceId: 'actual-stock-gap' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle de prueba 1' }, preserveExistingCatalogSelections: true,
    plan: { intent: 'order_clarification', order: { delivery: true }, lineUpdates: [
      { lineId: `${stockId}-pan`, quantity: 1, quantityExplicit: true },
      { lineId: `${stockId}-queso`, quantity: 2, quantityExplicit: true },
    ], missingFields: [] },
  });
  const stockGap = store.getState().conversations.find((item) => item.id === stockId).orderDraft;
  assert.equal(stockGap.missingFields.includes('stock:queso doble crema'), true);
  console.log('LLM line updates reconciliation passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
