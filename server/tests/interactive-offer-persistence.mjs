import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

// Reproduces an interactive offer created before a process restart. The
// persisted checkout key is the contract of the offer; the hydrated draft can
// contain JSON normalization differences that make a fresh basketKey() differ.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-interactive-offer-persistence-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});

const tenantId = 'andina';
const conversationId = 'interactive-offer-after-restart';
const waId = '573000000777';
const product = {
  sku: 'CIFRUT-GRANADILLA-1500',
  name: 'Cifrut granadilla',
  brand: 'Cifrut',
  presentation: '1.5 L',
  price: 2700,
  stock: 50,
};
const persistedBasket = 'basket-persisted-before-restart';

store.mutate((state) => {
  state.conversations.unshift({
    id: conversationId,
    tenantId,
    waId,
    messages: [],
    status: 'live',
    orderDraft: {
      items: [{
        lineId: 'L1',
        rawName: 'Cifrut granadilla',
        catalogQuery: 'cifrut granadilla',
        quantity: 1,
        product: null,
        catalogCandidates: [product],
        selectionStatus: 'pending',
        lineTotal: null,
      }],
      subtotal: 0,
      delivery: false,
      missingFields: ['selection:L1'],
      // This is the key persisted with the offer before the process restart.
      checkout: { phase: 'collecting', basketKey: persistedBasket, reviewedKey: null },
    },
  });
});
await store.createInteractionOffer({
  id: 'io-persistedafterrestart',
  tenantId,
  conversationId,
  purpose: 'catalog_selection',
  options: [{
    id: 'vi:io-persistedafterrestart:1',
    title: 'Cifrut granadilla · 1,5 L — COP 2.700',
    action: 'select_catalog_product',
    value: JSON.stringify({ basketKey: persistedBasket, lineId: 'L1', sku: product.sku }),
  }],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

const originalHandleOrderClarification = runtime.handleOrderClarification;
runtime.handleOrderClarification = async () => ({ summary: 'selection accepted after restart' });
try {
  const result = await runtime.handleInteractiveReply({
    tenantId,
    conversationId,
    normalized: {
      waId,
      text: 'Cifrut granadilla · 1,5 L — COP 2.700',
      traceId: 'trace-interactive-offer-persistence',
      interactive: { optionId: 'vi:io-persistedafterrestart:1' },
    },
  });
  assert.equal(result.summary, 'selection accepted after restart');
  assert.equal(store.getInteractionOffer('io-persistedafterrestart').status, 'consumed');
  console.log('Interactive offer persistence passed: persisted checkout basket key survives process restart.');
} finally {
  runtime.handleOrderClarification = originalHandleOrderClarification;
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
