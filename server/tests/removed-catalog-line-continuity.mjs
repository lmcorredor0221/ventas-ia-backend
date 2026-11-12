import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { CatalogResolutionService } from '../services/catalogResolutionService.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-removed-line-'));
const dataFile = path.join(dir, 'store.json');
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  dataFile,
  whatsappMode: 'mock',
  allowLocalCatalogFallback: true,
  contextualProductSelectionV2: true,
  contextualProductSelectionTenants: ['andina'],
  backgroundWorkersEnabled: false,
});

const product = {
  sku: 'COKE-15', name: 'Coca-Cola original', brand: 'Coca-Cola', presentation: '1.5 L',
  price: 7200, stock: 10, category: 'Bebidas', description: 'Gaseosa Coca-Cola 1.5 L',
};
let adjudications = 0;
runtime.planner = {
  async adjudicateCatalogCandidates() {
    adjudications += 1;
    throw new Error('A customer-removed line must not reach catalog adjudication');
  },
  async composeReply({ fallbackText }) { return { text: fallbackText }; },
};

const conversationId = 'removed-line-continuity';
const waId = '573000009001';
try {
  store.mutate((state) => {
    state.productsByTenant.andina = [product];
    state.conversations.unshift({
      id: conversationId,
      tenantId: 'andina',
      waId,
      status: 'live',
      messages: [
        { role: 'agent', text: 'El brownie no está disponible. ¿Lo reemplazamos o lo dejamos fuera?' },
        { role: 'user', text: 'Déjalo así' },
      ],
      orderDraft: {
        delivery: true,
        items: [
          { lineId: 'L1', catalogQuery: 'coca cola 1.5', quantity: 1, product, lineTotal: 7200, available: true, selectionStatus: 'selected' },
          { lineId: 'L2', catalogQuery: 'brownie mamai arequipe', quantity: 1, product: null, lineTotal: null, available: false, selectionStatus: 'removed', removedByCustomer: true, catalogCandidates: [] },
        ],
        missingFields: ['product:brownie mamai arequipe'],
        subtotal: 7200,
      },
    });
  });

  await runtime.handleOrderClarification({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: 'Continuar pedido', traceId: 'removed-line-regression' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle 1' },
    plan: { intent: 'order_clarification', order: { delivery: true, collectionComplete: true, items: [] }, missingFields: [] },
  });

  const conversation = store.getState().conversations.find((item) => item.id === conversationId);
  const removed = conversation.orderDraft.items.find((item) => item.lineId === 'L2');
  assert.equal(adjudications, 0, 'Continuing a basket must not resolve a product the customer removed');
  assert.equal(removed.selectionStatus, 'removed');
  assert.equal(removed.removedByCustomer, true);
  assert.equal(conversation.orderDraft.missingFields.includes('product:brownie mamai arequipe'), false);
  assert.equal(conversation.orderDraft.subtotal, 7200);
  assert.equal(conversation.status, 'live');
  assert.notEqual(conversation.stage, 'handoff');

  const resolver = new CatalogResolutionService({
    enabled: true,
    getPlanner: () => runtime.planner,
  });
  const resolved = await resolver.resolve({
    tenantId: 'andina',
    conversationId,
    normalized: { text: 'Continuar pedido' },
    conversation,
    items: [{
      lineId: 'L2', catalogQuery: 'brownie mamai arequipe', product: null,
      selectionStatus: 'removed', removedByCustomer: true, catalogCandidates: [product, { ...product, sku: 'COKE-ZERO' }],
    }],
  });
  assert.equal(adjudications, 0, 'The catalog resolver must skip terminal removed lines');
  assert.equal(resolved.items[0].selectionStatus, 'removed');
  assert.equal(resolved.items[0].removedByCustomer, true);
  console.log('Removed catalog line continuity passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
