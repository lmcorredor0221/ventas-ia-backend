import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

// Local contract: catalog evidence is searched by the existing tool, then one
// contextual adjudication chooses/asks among real candidates. No provider or
// WhatsApp traffic is used by this test.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-catalog-selection-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  allowLocalCatalogFallback: true,
  contextualProductSelectionV2: true,
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});
const conversationId = 'catalog-selection';
const waId = '573000000888';
const products = [
  { sku: 'COKE-ORIGINAL-15', name: 'Coca-Cola original', brand: 'Coca-Cola', presentation: '1.5 L', description: 'Gaseosa original', price: 7200, stock: 10, category: 'Bebidas' },
  { sku: 'COKE-ZERO-15', name: 'Coca-Cola Zero', brand: 'Coca-Cola', presentation: '1.5 L', description: 'Gaseosa sin azúcar', price: 7500, stock: 10, category: 'Bebidas' },
  { sku: 'CHOCORAMO', name: 'Chocorramo', brand: 'Ramo', presentation: '65 g', description: 'Ponqué cubierto de chocolate', price: 2800, stock: 12, category: 'Snacks' },
];
store.mutate((state) => {
  state.productsByTenant.andina = structuredClone(products);
  state.conversations.unshift({ id: conversationId, tenantId: 'andina', waId, messages: [], status: 'live' });
});
runtime.planner = {
  async adjudicateCatalogCandidates({ context }) {
    const item = context.items.find((candidate) => candidate.candidates.length > 1);
    return {
      decisions: [{
        lineId: item.lineId,
        action: 'ask',
        confidence: 0.82,
        reason: 'Hay dos presentaciones/marcas razonables para la misma solicitud.',
        question: '¿Cuál Coca-Cola prefieres?',
      }],
      collectionStatus: 'pending',
      executionMode: 'test_adjudicator',
    };
  },
  async composeReply({ fallbackText }) {
    return { text: fallbackText };
  },
};

const args = {
  tenantId: 'andina',
  conversationId,
  normalized: { waId, text: 'Para domicilio, una Coca-Cola y un Chocorramo', traceId: 'trace-catalog-selection' },
  customerProfile: { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' },
  plan: {
    intent: 'delivery_order',
    customerDetails: { name: 'Cliente local', deliveryAddress: 'Calle de prueba 10' },
    order: {
      delivery: true,
      paymentMethod: 'cash',
      collectionComplete: true,
      items: [
        { rawName: 'Coca-Cola', catalogQuery: 'coca cola', quantity: 1 },
        { rawName: 'Chocorramo', catalogQuery: 'chocorramo', quantity: 1 },
      ],
    },
    // A provider can return narrative explanations in its free-form
    // `missingFields` output. They must never become state-machine gaps.
    // This reproduces the production selection callback that previously
    // remained in `collecting` after the final product was selected.
    missingFields: [
      "Confirmación de la dirección de entrega (perfil sugiere 'Calle de prueba 10', sin verificar)",
      'Método de pago',
    ],
  },
};

try {
  await runtime.handleDeliveryOrder(args);
  const conversation = () => store.getState().conversations.find((item) => item.id === conversationId);
  const draft = conversation().orderDraft;
  assert.equal(draft.items[0].selectionStatus, 'pending');
  assert.equal(draft.items[0].product, null);
  assert.equal(draft.items[0].catalogCandidates.length, 2);
  assert.equal(draft.items[1].product.sku, 'CHOCORAMO');
  assert.ok(draft.missingFields.some((field) => field.startsWith('selection:')));
  assert.equal(draft.checkout.phase, 'collecting');

  const offer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === conversationId && item.purpose === 'catalog_selection' && item.status === 'active');
  assert.ok(offer, 'The ambiguous line should expose a product-selection offer');
  const choice = offer.options.find((item) => item.value.includes('COKE-ORIGINAL-15'));
  assert.ok(choice);
  await runtime.handleInteractiveReply({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: choice.title, interactive: { optionId: choice.id }, traceId: 'trace-catalog-selection-choice' },
  });

  const resolved = conversation().orderDraft;
  assert.equal(resolved.items[0].product.sku, 'COKE-ORIGINAL-15');
  assert.equal(resolved.items[0].lineTotal, 7200);
  assert.equal(resolved.items[1].lineTotal, 2800);
  assert.equal(resolved.subtotal, 10000);
  assert.equal(resolved.checkout.phase, 'review', 'Resolved catalog selections must proactively advance to basket review');
  const reviewOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === conversationId && item.purpose === 'cart_review' && item.status === 'active');
  assert.ok(reviewOffer, 'The completed basket must offer the next customer actions automatically');
  assert.deepEqual(reviewOffer.options.map((item) => item.title), ['Continuar pedido', 'Agregar productos', 'Hablar con la tienda']);
  const outboundReview = conversation().messages.filter((message) => message.role === 'agent').at(-1);
  assert.match(outboundReview.text, /¿Quieres agregar algo más o continuar con este pedido\?/);
  assert.deepEqual(outboundReview.interactive?.buttons?.map((button) => button.title), ['Continuar pedido', 'Agregar productos', 'Hablar con la tienda']);
  assert.match(conversation().messages.filter((message) => message.role === 'agent').at(-1).text, /Resumen del pedido|Resumen final del pedido/);
  assert.match(conversation().messages.filter((message) => message.role === 'agent').at(-1).text, /Coca-Cola original/);
  assert.match(conversation().messages.filter((message) => message.role === 'agent').at(-1).text, /7\.200/);
  console.log('Catalog selection reconciliation passed: contextual ambiguity, offer, selection and structured summary.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
