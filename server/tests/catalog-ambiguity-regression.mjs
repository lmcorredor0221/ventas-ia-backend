import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

// Regression contract: a planner SKU hint inferred from a generic alias must
// not suppress compatible alternatives. Explicit presentation constraints are
// preserved, incompatible presentations are excluded, and the basket remains
// pending until the customer chooses.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-catalog-ambiguity-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  allowLocalCatalogFallback: true,
  contextualProductSelectionV2: true,
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});

const conversationId = 'catalog-ambiguity-regression';
const waId = '573000000889';
const products = [
  { sku: 'COKE-400', name: 'Coca-Cola original', brand: 'Coca-Cola', presentation: '400 ml', description: 'Gaseosa original', price: 3300, stock: 10, category: 'Bebidas', aliases: ['coca', 'coca cola'] },
  { sku: 'COKE-ORIGINAL-15', name: 'Coca-Cola original', brand: 'Coca-Cola', presentation: '1.5 L', description: 'Gaseosa original', price: 7200, stock: 10, category: 'Bebidas', aliases: ['coca cola litro y medio'] },
  { sku: 'COKE-ZERO-15', name: 'Coca-Cola Zero', brand: 'Coca-Cola', presentation: '1.5 L', description: 'Gaseosa sin azúcar', price: 7500, stock: 10, category: 'Bebidas', aliases: ['coca zero litro y medio'] },
  { sku: 'COKE-3000', name: 'Coca-Cola familiar', brand: 'Coca-Cola', presentation: '3 L', description: 'Gaseosa familiar', price: 13500, stock: 10, category: 'Bebidas', aliases: ['coca familiar', 'coca grande'] },
  { sku: 'CHOCORAMO-65', name: 'Ponqué Chocorramo', brand: 'Ramo', presentation: '65 g', description: 'Ponqué cubierto de chocolate', price: 2800, stock: 12, category: 'Panadería', aliases: ['chocorramo', 'chocorramo grande'] },
  { sku: 'CHOCORAMO-35', name: 'Chocorramo mini', brand: 'Ramo', presentation: '35 g', description: 'Ponqué pequeño cubierto de chocolate', price: 1600, stock: 12, category: 'Snacks', aliases: ['chocorramo pequeño', 'chocorramo mini'] },
];

store.mutate((state) => {
  state.productsByTenant.andina = structuredClone(products);
  state.conversations.unshift({ id: conversationId, tenantId: 'andina', waId, messages: [], status: 'live' });
});

try {
  await runtime.handleDeliveryOrder({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: 'Para domicilio, una Coca-Cola litro y medio y un chocorramo', traceId: 'trace-catalog-ambiguity-regression' },
    customerProfile: { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' },
    plan: {
      intent: 'delivery_order',
      order: {
        delivery: true,
        items: [
          {
            lineId: 'coca-1',
            rawName: 'Coca-Cola litro y medio',
            catalogQuery: 'Coca-Cola litro y medio',
            requestedPresentation: '1.5 L',
            quantity: 1,
            skuHint: 'COKE-400',
            skuHintSource: 'inferred',
          },
          {
            lineId: 'chocorramo-1',
            rawName: 'chocorramo',
            catalogQuery: 'chocorramo',
            quantity: 1,
            skuHint: 'CHOCORAMO-65',
            skuHintSource: 'inferred',
          },
        ],
      },
      missingFields: [],
    },
  });

  const conversation = store.getState().conversations.find((item) => item.id === conversationId);
  const draft = conversation?.orderDraft;
  assert.ok(draft, 'Debe conservarse una canasta de trabajo');
  assert.equal(draft.checkout.phase, 'collecting');

  const coca = draft.items.find((item) => item.lineId === 'coca-1');
  const chocorramo = draft.items.find((item) => item.lineId === 'chocorramo-1');
  assert.equal(coca.product, null, 'Coca-Cola no debe seleccionarse antes de resolver Original/Zero');
  assert.deepEqual(coca.catalogCandidates.map((item) => item.sku).sort(), ['COKE-ORIGINAL-15', 'COKE-ZERO-15']);
  assert.equal(chocorramo.product, null, 'Chocorramo no debe fijarse en la primera presentación');
  assert.deepEqual(chocorramo.catalogCandidates.map((item) => item.sku).sort(), ['CHOCORAMO-35', 'CHOCORAMO-65']);
  assert.ok(draft.missingFields.some((field) => field === 'selection:coca-1'));
  assert.ok(draft.missingFields.some((field) => field === 'selection:chocorramo-1'));
  assert.equal(store.getState().ordersByTenant?.andina?.length ?? 0, 0, 'No debe crearse pedido con selecciones pendientes');

  const offer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === conversationId && item.purpose === 'catalog_selection' && item.status === 'active');
  assert.ok(offer, 'Debe ofrecer alternativas al cliente');
  const latestReply = conversation.messages.filter((message) => message.role === 'agent').at(-1)?.text ?? '';
  assert.match(latestReply, /1\.5\s*L/);
  assert.match(latestReply, /35\s*g/);
  assert.match(latestReply, /65\s*g/);
  console.log('Catalog ambiguity regression passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
