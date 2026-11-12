import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-basket-mutations-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', dataFile: path.join(dir, 'store.json'), whatsappMode: 'mock',
  allowLocalCatalogFallback: true, contextualProductSelectionV2: true,
  contextualProductSelectionTenants: ['andina'], backgroundWorkersEnabled: false,
});
const products = [
  { sku: 'EGGS', name: 'Cubeta huevos AAA', price: 28500, stock: 50 },
  { sku: 'GRANADILLA', name: 'Cifrut granadilla', price: 2700, stock: 50 },
  { sku: 'NARANJA', name: 'Cifrut naranja', price: 2700, stock: 50 },
  { sku: 'CHOCORAMO', name: 'Ponque Chocoramo', price: 2800, stock: 50 },
];
const quantities = [1, 3, 2, 3];
const selected = products.map((product, i) => ({
  lineId: `L${i === 3 ? 5 : i + 1}`, rawName: product.name, catalogQuery: product.name,
  quantity: quantities[i], product, selectionStatus: 'selected', available: true,
  lineTotal: product.price * quantities[i], catalogCandidates: [product, { ...product, sku: `${product.sku}-OTHER` }],
}));
const unresolved = { lineId: 'L4', rawName: 'Brownie Mamai arequipe', catalogQuery: 'brownie mamai arequipe',
  quantity: 1, product: null, selectionStatus: 'not_found', catalogCandidates: [] };
const searches = [];
const adjudications = [];
const call = runtime.tools.call.bind(runtime.tools);
runtime.tools.call = async (name, ...args) => {
  if (name === 'google_sheets_read_table') {
    searches.push(args[2]?.query);
    return { rows: [] };
  }
  return call(name, ...args);
};
runtime.planner = {
  async composeReply({ fallbackText }) { return { text: fallbackText }; },
  async adjudicateCatalogCandidates({ context }) {
    adjudications.push(context.items.map(item => item.lineId));
    return { decisions: context.items.map(item => ({ lineId: item.lineId, action: 'ask', question: '¿Cuál prefieres?' })) };
  },
};
const tenantId = 'andina';
const waId = '573990000099';
const conversationId = 'basket-line-mutations';
const current = () => store.getState().conversations.find(c => c.id === conversationId).orderDraft;
function seed() {
  searches.length = 0;
  adjudications.length = 0;
  store.mutate(state => {
    state.productsByTenant[tenantId] = products;
    state.conversations = state.conversations.filter(c => c.id !== conversationId);
    state.conversations.unshift({ id: conversationId, tenantId, waId, status: 'live', messages: [], orderDraft: {
      delivery: true, items: structuredClone([...selected, unresolved]), subtotal: 50400,
      missingFields: [`product:${unresolved.catalogQuery}`],
      clarificationState: { version: 1, kind: 'catalog_ambiguity', status: 'open', attempts: 1,
        scopeKey: 'brownie mamai arequipe', unresolvedLineIds: ['L4'] },
    } });
  });
}
async function turn(text, order = {}, lineUpdates = []) {
  await runtime.handleOrderClarification({ tenantId, conversationId, normalized: { waId, text },
    customerProfile: { name: 'Cliente de prueba', defaultAddress: 'Dirección de prueba' },
    plan: { intent: 'order_clarification', order: { delivery: true, items: [], ...order }, lineUpdates, missingFields: [] },
  });
}
function assertSelectedIntact() {
  for (const original of selected) {
    const line = current().items.find(item => item.lineId === original.lineId);
    assert.equal(line?.product?.sku, original.product.sku, original.lineId);
    assert.equal(line?.quantity, original.quantity, original.lineId);
    assert.equal(line?.selectionStatus, 'selected', original.lineId);
    assert.equal(line?.lineTotal, original.lineTotal, original.lineId);
  }
  assert.equal(current().subtotal, 50400);
}
try {
  seed();
  await turn('entonces el brownie ya no', {}, [{ lineId: 'L4', operation: 'remove' }]);
  assert.equal(current().items.find(item => item.lineId === 'L4')?.selectionStatus, 'removed');
  assert.deepEqual(searches, [], 'Removing a line must not re-search the basket');
  assert.deepEqual(adjudications, []);
  assertSelectedIntact();
  assert.equal(current().missingFields.some(field => /brownie|L4/.test(field)), false);
  assert.equal(current().checkout.phase, 'review');
  await turn('Continuar pedido', { collectionComplete: true });
  assert.equal(current().checkout.phase, 'payment');
  assertSelectedIntact();
  await turn('Efectivo', { paymentMethod: 'cash' });
  assert.equal(current().checkout.phase, 'confirmation');
  await runtime.handleOrderConfirmation({ tenantId, conversationId, normalized: { waId, text: 'Confirmar pedido' },
    customerProfile: { name: 'Cliente de prueba', defaultAddress: 'Dirección de prueba' },
    plan: { intent: 'order_confirmation', order: {} },
  });
  assert.deepEqual(searches, [], 'Confirmation must not requote removed lines or reopen selected products');
  const confirmed = store.getState().ordersByTenant.andina.find(order => order.conversationId === conversationId);
  assert.equal(confirmed?.items.length, 4, 'Removed lines must not be written into the order');
  assert.equal(confirmed?.subtotal, 50400);
  assertSelectedIntact();

  seed();
  await turn('brownie de arequipe de marca Mamai', { items: [{ lineId: 'L4', rawName: 'Brownie de arequipe Mamai',
    catalogQuery: 'brownie arequipe Mamai', quantity: null, quantityExplicit: false }] }, [{ lineId: 'L4', operation: 'clarify' }]);
  assertSelectedIntact();
  assert.equal(searches.length, 1, 'Only the clarified line may be searched');
  assert.equal(current().items.filter(item => item.lineId === 'L4').length, 1);
  assert.equal(current().clarificationState.attempts, 2, 'Rewording must not reset the clarification counter');
  assert.equal(current().missingFields.includes('product:brownie mamai arequipe'), false);
  await turn('entonces el brownie ya no', {}, [{ lineId: 'L4', operation: 'remove' }]);
  assertSelectedIntact();
  assert.equal(searches.length, 1);
  assert.equal(current().missingFields.some(field => /brownie|L4/.test(field)), false);
  assert.equal(current().checkout.phase, 'review');
  seed();
  store.mutate(state => {
    const conversation = state.conversations.find(c => c.id === conversationId);
    const exhausted = { ...conversation.orderDraft.clarificationState, status: 'exhausted', attempts: 3, exhausted: true };
    conversation.clarificationState = exhausted;
    conversation.orderDraft.clarificationState = exhausted;
    conversation.orderDraft.manualProductReview = { version: 1, status: 'awaiting_customer',
      lines: [{ lineId: 'L4', catalogQuery: unresolved.catalogQuery, status: 'awaiting_customer' }] };
  });
  await turn('ya no quiero el brownie', {}, [{ lineId: 'L4', operation: 'remove' }]);
  assertSelectedIntact();
  assert.equal(current().manualProductReview?.lines?.length ?? 0, 0, 'Explicit withdrawal is not a pending manual lookup');
  assert.equal(store.getState().conversations.find(c => c.id === conversationId).clarificationState?.status, 'closed');
  seed();
  store.mutate(state => {
    const draft = state.conversations.find(c => c.id === conversationId).orderDraft;
    draft.items.push({ ...unresolved, lineId: 'L6', catalogQuery: 'otro pendiente' });
    draft.missingFields.push('product:otro pendiente');
    draft.clarificationState.unresolvedLineIds.push('L6');
  });
  await turn('el brownie es de arequipe Mamai', { items: [{ ...unresolved, catalogQuery: 'brownie arequipe Mamai' }] },
    [{ lineId: 'L4', operation: 'clarify' }]);
  assertSelectedIntact();
  assert.equal(searches.length, 1);
  assert.equal(current().clarificationState.attemptsByLineId.L4, 2);
  assert.equal(current().clarificationState.attemptsByLineId.L6, 1, 'An unrelated clarification is not an attempt on L6');
  await turn('retiro el brownie', {}, [{ lineId: 'L4', operation: 'remove' }]);
  assertSelectedIntact();
  assert.equal(searches.length, 1);
  assert.equal(current().clarificationState.attemptsByLineId.L6, 1);
  assert.deepEqual(current().clarificationState.unresolvedLineIds, ['L6']);

  seed();
  await turn('cambio el jugo por otro', { items: [{ lineId: 'L2', catalogQuery: 'jugo distinto', quantity: 1, quantityExplicit: false }] },
    [{ lineId: 'L2', operation: 'replace', quantity: 1, quantityExplicit: false }]);
  assert.equal(searches.length, 1);
  assert.equal(current().items.find(item => item.lineId === 'L2').product, null, 'A replacement cannot resurrect the former SKU');
  assert.equal(current().items.find(item => item.lineId === 'L2').quantity, 3);
  assert.equal(current().items.find(item => item.lineId === 'L1').product.sku, 'EGGS');
  assert.equal(current().subtotal, 42300);
  assert.equal(current().clarificationState.attemptsByLineId.L2, 1);
  console.log('Basket line mutations: removal, clarification, stable selections, gaps and checkout passed.');
} finally {
  runtime.stop(); integrationOutbox.stop(); await store.close?.();
  // This directory was created for this test and is never a production path.
  fs.rmSync(dir, { recursive: true, force: true });
}
