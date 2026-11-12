import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-selected-basket-continuity-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  dataFile: path.join(dir, 'store.json'),
  whatsappMode: 'mock',
  allowLocalCatalogFallback: true,
  contextualProductSelectionV2: true,
  contextualProductSelectionTenants: ['andina'],
  backgroundWorkersEnabled: false,
});

const tenantId = 'andina';
const conversationId = 'selected-basket-with-product-gap';
const waId = '573000009010';
const coke = {
  sku: 'COKE-15',
  name: 'Coca-Cola original',
  brand: 'Coca-Cola',
  presentation: '1.5 L',
  price: 7200,
  stock: 10,
  category: 'Bebidas',
};

try {
  runtime.planner = {
    async composeReply({ fallbackText }) { return { text: fallbackText }; },
  };
  store.mutate((state) => {
    state.productsByTenant[tenantId] = [coke];
    state.conversations.unshift({
      id: conversationId,
      tenantId,
      waId,
      status: 'live',
      messages: [],
      orderDraft: {
        delivery: true,
        items: [
          {
            lineId: 'L1',
            rawName: 'Coca-Cola litro y medio',
            catalogQuery: 'coca cola 1.5',
            quantity: 1,
            product: coke,
            lineTotal: 7200,
            available: true,
            selectionStatus: 'selected',
          },
          {
            lineId: 'L2',
            rawName: 'Brownie Mamai de arequipe',
            catalogQuery: 'brownie mamai arequipe',
            quantity: 1,
            product: null,
            lineTotal: null,
            available: false,
            selectionStatus: 'handoff',
          },
        ],
        missingFields: ['product:brownie mamai arequipe'],
        subtotal: 7200,
      },
    });
  });

  // Reproduces the production turn in which the interpreter only returns the
  // still-unresolved line. The verified Coca-Cola line must remain untouched.
  await runtime.handleOrderClarification({
    tenantId,
    conversationId,
    normalized: {
      waId,
      text: 'Déjalo así',
      traceId: 'trace-selected-basket-continuity',
    },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle 1' },
    plan: {
      intent: 'order_clarification',
      order: {
        delivery: true,
        items: [{
          lineId: 'L2',
          rawName: 'Brownie Mamai de arequipe',
          catalogQuery: 'brownie mamai arequipe',
          quantity: 1,
        }],
      },
      missingFields: ['product:brownie mamai arequipe'],
    },
  });

  const draft = store.getState().conversations.find((item) => item.id === conversationId).orderDraft;
  assert.equal(draft.items.find((item) => item.lineId === 'L1')?.product?.sku, coke.sku,
    'Clarifying one unresolved product must preserve every verified basket line');
  assert.equal(draft.items.find((item) => item.lineId === 'L1')?.lineTotal, 7200);
  assert.equal(draft.subtotal, 7200);
  assert.equal(draft.items.find((item) => item.lineId === 'L2')?.product ?? null, null);
  console.log('Selected basket continuity during product clarification passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
