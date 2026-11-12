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
  contextualProductSelectionV2: false,
  contextualProductSelectionTenants: ['andina'],
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});
const conversationId = 'catalog-selection';
const waId = '573000000888';
const products = [
  { sku: 'COKE-ORIGINAL-15', name: 'Coca-Cola original', brand: 'Coca-Cola', presentation: '1.5 L', description: 'Gaseosa original', price: 7200, stock: 10, category: 'Bebidas' },
  { sku: 'COKE-ZERO-15', name: 'Coca-Cola Zero', brand: 'Coca-Cola', presentation: '1.5 L', description: 'Gaseosa sin azúcar', price: 7500, stock: 10, category: 'Bebidas' },
  { sku: 'CHOCORAMO', name: 'Chocorramo', brand: 'Ramo', presentation: '65 g', description: 'Ponqué cubierto de chocolate', price: 2800, stock: 12, category: 'Snacks' },
  { sku: 'PAN-TAJADO-BLANCO', name: 'Pan tajado blanco', brand: 'Bimbo', presentation: '500 g', description: 'Pan de sándwich tajado', price: 7600, stock: 18, category: 'Panadería', aliases: ['pan tajado', 'pan bimbo'] },
  { sku: 'PAN-TAJADO-INTEGRAL', name: 'Pan tajado integral', brand: 'Bimbo', presentation: '500 g', description: 'Pan integral tajado', price: 8400, stock: 14, category: 'Panadería', aliases: ['pan tajado integral', 'pan integral'] },
  { sku: 'MANZANA-400', name: 'Manzana Postobon', brand: 'Postobon', presentation: '400 ml', description: 'Gaseosa sabor manzana', price: 3000, stock: 18, category: 'Bebidas', aliases: ['gaseosa manzana'] },
  { sku: 'MANZANA-600', name: 'Manzana Postobon', brand: 'Postobon', presentation: '600 ml', description: 'Gaseosa sabor manzana', price: 4200, stock: 18, category: 'Bebidas', aliases: ['gaseosa manzana'] },
  { sku: 'MARGARITA-25', name: 'Papas Margarita natural', brand: 'Margarita', presentation: '25 g', description: 'Papas naturales', price: 1000, stock: 18, category: 'Snacks', aliases: ['papas margarita natural'] },
  { sku: 'MARGARITA-105', name: 'Papas Margarita natural', brand: 'Margarita', presentation: '105 g', description: 'Papas naturales', price: 5200, stock: 18, category: 'Snacks', aliases: ['papas margarita natural'] },
  { sku: 'LIMON-500G', name: 'Limón Tahití', brand: 'Campo', presentation: '500 g', description: 'Limón fresco', price: 5000, stock: 12, category: 'Frutas', productFamily: 'Limón Tahití', allowsSaleByAmount: true },
  { sku: 'LIMON-1KG', name: 'Limón Tahití', brand: 'Campo', presentation: '1 kg', description: 'Limón fresco', price: 10000, stock: 12, category: 'Frutas', productFamily: 'Limón Tahití', allowsSaleByAmount: true },
];
store.mutate((state) => {
  state.productsByTenant.andina = structuredClone(products);
  state.conversations.unshift({ id: conversationId, tenantId: 'andina', waId, messages: [], status: 'live' });
});
const composedReplyFacts = [];
runtime.planner = {
  async adjudicateCatalogCandidates({ context }) {
    const item = context.items.find((candidate) => candidate.candidates.length > 1);
    if (item.budgetAmount) {
      return {
        decisions: [{
          lineId: item.lineId,
          // The model may correctly understand an amount request but still
          // ask because the catalog has several physical presentations. The
          // resolver must bind the one commercial identity without asking for
          // grams or a package.
          action: 'ask',
          customerSelected: false,
          confidence: 0.9,
          reason: 'Los candidatos son la misma variedad de limón con presentaciones físicas distintas.',
        }],
        collectionStatus: 'ready',
        executionMode: 'test_adjudicator',
      };
    }
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
  async composeReply({ fallbackText, facts }) {
    composedReplyFacts.push(structuredClone(facts));
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
      collectionComplete: false,
      items: [
        // DeepSeek puede expresar atributos inferidos como lista de evidencia
        // semántica. No son predicados literales del catálogo: "cantidad 1"
        // no existe dentro de la ficha del producto y no puede eliminar una
        // coincidencia real encontrada por la búsqueda.
        { rawName: 'Coca-Cola', catalogQuery: 'coca cola', quantity: 1, requestedAttributes: ['sabor cola', 'cantidad 1'] },
        { rawName: 'Chocorramo', catalogQuery: 'chocorramo', quantity: 1, requestedAttributes: ['ponqué de chocolate', 'cantidad 1'] },
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
  assert.equal(runtime.contextualProductSelectionEnabled('andina'), true);
  assert.equal(runtime.contextualProductSelectionEnabled('otro-tenant'), false);
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
  const catalogSelectionMessage = conversation().messages.filter((message) => message.role === 'agent').at(-1);
  assert.equal(catalogSelectionMessage.interactive?.kind, 'list', 'Catalog variants use a native WhatsApp list, not ambiguous reply buttons');
  assert.equal(catalogSelectionMessage.interactive?.rows?.length, 2);
  assert.ok(catalogSelectionMessage.interactive.rows.every((row) => row.title.length <= 24 && row.description?.includes('$')),
    'Every catalog row exposes a readable product/presentation title and price description');
  assert.notEqual(catalogSelectionMessage.interactive.rows[0].title, catalogSelectionMessage.interactive.rows[1].title,
    'Variants must remain distinguishable to the customer');
  const choice = offer.options.find((item) => item.value.includes('COKE-ORIGINAL-15'));
  assert.ok(choice);
  await runtime.handleInteractiveReply({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: choice.title, interactive: { optionId: choice.id }, traceId: 'trace-catalog-selection-choice' },
  });

  const resolved = conversation().orderDraft;
  assert.equal(resolved.items[0].product.sku, 'COKE-ORIGINAL-15');
  assert.deepEqual(resolved.items[0].catalogCandidates, [],
    'A customer-selected line must not retain stale alternatives as pending evidence');
  assert.deepEqual(resolved.items[0].presentationOptions, [],
    'A customer-selected line must not re-expose its prior presentation alternatives');
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
  const composedReviewFacts = composedReplyFacts.at(-1);
  assert.ok(composedReviewFacts, 'The completed selection must reach the reply composer');
  assert.ok(composedReviewFacts.products.every((item) => !Object.hasOwn(item, 'selectionEvidence')),
    'Historic selection questions must remain in persisted audit state, not in the reply-composer facts');

  await runtime.handleInteractiveReply({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: 'Continuar pedido', interactive: { optionId: reviewOffer.options[0].id }, traceId: 'trace-catalog-review' },
  });
  const paymentOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === conversationId && item.purpose === 'payment_method' && item.status === 'active');
  assert.ok(paymentOffer, 'Continuing a reviewed basket must proactively offer payment methods');
  assert.deepEqual(paymentOffer.options.map((item) => item.title), ['Efectivo', 'Tarjeta', 'Bre-B']);

  await runtime.handleInteractiveReply({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: 'Efectivo', interactive: { optionId: paymentOffer.options[0].id }, traceId: 'trace-catalog-payment' },
  });
  const confirmationOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === conversationId && item.purpose === 'order_confirmation' && item.status === 'active');
  assert.ok(confirmationOffer, 'Selecting payment must proactively offer final order actions');
  assert.deepEqual(confirmationOffer.options.map((item) => item.title), ['Confirmar pedido', 'Ajustar pedido', 'Hablar con la tienda']);

  const amountConversationId = 'catalog-amount-selection';
  store.mutate((state) => {
    state.conversations.unshift({ id: amountConversationId, tenantId: 'andina', waId: '573000000889', messages: [], status: 'live' });
  });
  await runtime.handleDeliveryOrder({
    tenantId: 'andina',
    conversationId: amountConversationId,
    normalized: { waId: '573000000889', text: 'Regálame cinco mil de limón', traceId: 'trace-catalog-amount' },
    customerProfile: { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' },
    plan: {
      intent: 'delivery_order',
      customerDetails: { name: 'Cliente local', deliveryAddress: 'Calle de prueba 10' },
      order: {
        delivery: true,
        // Reproduces the real DeepSeek interpretation. Commercial metadata
        // such as "por valor de 5000 COP" is useful to preserve the sale
        // mode, but it must not become a product-identity predicate that
        // removes Limón Tahití from the retrieved catalog evidence.
        items: [{
          rawName: '5000 de limón',
          catalogQuery: 'limón',
          productHypothesis: 'limón por valor de 5000 COP',
          quantity: null,
          budgetAmount: 5000,
          budgetAmountExplicit: true,
          requestedAttributes: ['monto 5000 COP'],
        }],
      },
      // Reproduces stale fallbacks left by a prior planner pass. They must not
      // force a physical presentation or quantity for a sale by amount.
      missingFields: ['quantity:limón', 'stock:limón'],
    },
  });
  const amountDraft = store.getState().conversations.find((item) => item.id === amountConversationId).orderDraft;
  assert.equal(amountDraft.items[0].product.sku, 'LIMON-500G', 'A single amount-sale commercial identity binds a supporting catalog reference even when the LLM asks about package variants');
  assert.equal(amountDraft.items[0].quantity, null, 'A monetary request never becomes a physical quantity');
  assert.equal(amountDraft.items[0].budgetAmount, 5000);
  assert.equal(amountDraft.items[0].lineTotal, 5000, 'The requested amount stays as the quoted line total');
  assert.equal(amountDraft.missingFields.some((field) => /^(quantity|presentation|stock):limón$/.test(field)), false,
    'Stale physical gaps cannot block an amount sale after the catalog has resolved it');
  assert.equal(amountDraft.checkout.phase, 'review', 'An amount-sale line advances to the normal cart review without asking for grams or a package');

  // The product hypothesis is the interpreter's explanatory note, not an
  // additional customer constraint. A spelling-correction note must never
  // make real catalog evidence for the corrected request disappear.
  const correctionConversationId = 'catalog-correction-evidence';
  store.mutate((state) => {
    state.conversations.unshift({
      id: correctionConversationId,
      tenantId: 'andina',
      waId: '573000000890',
      messages: [],
      status: 'live',
      orderDraft: {
        delivery: true,
        items: [
          { lineId: 'chocorramo:1', rawName: 'Chocorramo', catalogQuery: 'chocorramo', quantity: 1, product: products.find((item) => item.sku === 'CHOCORAMO'), selectionStatus: 'selected' },
          { lineId: 'pantajado:1', rawName: 'pantajado', catalogQuery: 'pantajado', quantity: 1, product: null, selectionStatus: 'pending' },
        ],
        missingFields: ['selection:pantajado:1'],
      },
    });
  });
  await runtime.handleOrderClarification({
    tenantId: 'andina',
    conversationId: correctionConversationId,
    normalized: { waId: '573000000890', text: 'pan tajado', traceId: 'trace-catalog-correction' },
    customerProfile: { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' },
    plan: {
      intent: 'order_clarification',
      customerDetails: { name: 'Cliente local', deliveryAddress: 'Calle de prueba 10' },
      order: {
        delivery: true,
        items: [{
          lineId: 'pantajado:1',
          rawName: 'pan tajado',
          catalogQuery: 'pan tajado',
          // This mirrors the DeepSeek explanation captured in the incident.
          // It must help observability but cannot become a catalog predicate.
          productHypothesis: "pan tajado (posible corrección de 'pantajado')",
          requestedAttributes: { producto: 'pan tajado' },
          quantity: 1,
        }],
      },
      missingFields: [],
    },
  });
  const correctionDraft = store.getState().conversations.find((item) => item.id === correctionConversationId).orderDraft;
  const correctedPan = correctionDraft.items.find((item) => item.lineId === 'pantajado:1');
  assert.equal(correctedPan.selectionStatus, 'pending');
  assert.deepEqual(correctedPan.catalogCandidates.map((item) => item.sku).sort(), ['PAN-TAJADO-BLANCO', 'PAN-TAJADO-INTEGRAL']);
  assert.ok(correctionDraft.missingFields.includes('selection:pantajado:1'));
  assert.equal(correctionDraft.items.find((item) => item.lineId === 'chocorramo:1')?.product?.sku, 'CHOCORAMO',
    'Resolving one pending line must preserve an already selected basket line');
  const correctionOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === correctionConversationId && item.purpose === 'catalog_selection' && item.status === 'active');
  assert.ok(correctionOffer, 'The corrected pan line should expose its real catalog variants');
  assert.match(correctionOffer.options[0].title, /Bimbo/, 'Catalog option labels must include the catalog brand');

  // Typos and conversational qualifiers are soft retrieval evidence. They
  // must not erase the actual catalog alternatives after the search has found
  // them; the contextual adjudicator decides which pending line to present.
  const softAttributesConversationId = 'soft-attributes-evidence';
  store.mutate((state) => {
    state.conversations.unshift({ id: softAttributesConversationId, tenantId: 'andina', waId: '573000000891', messages: [], status: 'live' });
  });
  await runtime.handleDeliveryOrder({
    tenantId: 'andina',
    conversationId: softAttributesConversationId,
    normalized: { waId: '573000000891', text: 'Dos gaseosas de manaza y dos paquetes de papas Margarita natural', traceId: 'trace-soft-attributes' },
    customerProfile: { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' },
    plan: {
      intent: 'delivery_order',
      customerDetails: { name: 'Cliente local', deliveryAddress: 'Calle de prueba 10' },
      order: {
        delivery: true,
        items: [
          { rawName: 'gaseosa de manaza', catalogQuery: 'gaseosa manzana', quantity: 2, quantityExplicit: true, requestedAttributes: { sabor: 'manaza', cantidad: '2 paquetes' } },
          { rawName: 'papas Margarita natural', catalogQuery: 'papas margarita natural', quantity: 2, quantityExplicit: true, requestedAttributes: { marca: 'Margarita', variante: 'natural', cantidad: '2 paquetes' } },
        ],
      },
      missingFields: [],
    },
  });
  const softDraft = store.getState().conversations.find((item) => item.id === softAttributesConversationId).orderDraft;
  assert.ok(softDraft.items.every((item) => item.catalogCandidates?.length >= 2),
    'Soft inferred attributes must preserve compatible catalog candidates for contextual selection');
  assert.ok(softDraft.items.every((item) => item.selectionStatus === 'pending'),
    'Ambiguous catalog variants must remain pending rather than being escalated or discarded');

  // WhatsApp permits only 24 title characters. Labels must retain the
  // differentiating catalog data (here, presentation) instead of truncating
  // every alternative to the same visible prefix.
  const compactList = await runtime.createCatalogSelectionOffer({
    tenantId: 'andina',
    conversationId: softAttributesConversationId,
    checkout: { phase: 'collecting', basketKey: 'compact-title-test' },
    items: [{
      lineId: 'margarita:1',
      rawName: 'papas Margarita natural',
      selectionStatus: 'pending',
      catalogCandidates: products.filter((product) => product.sku.startsWith('MARGARITA-')),
    }],
  });
  const compactTitles = compactList.interactive.rows.map((row) => row.title);
  assert.deepEqual(compactTitles, ['Margarita · 25 g', 'Margarita · 105 g']);
  assert.ok(compactTitles.every((title) => title.length <= 24));
  assert.equal(new Set(compactTitles).size, compactTitles.length,
    'Every catalog option must remain visibly distinguishable in WhatsApp');
  console.log('Catalog selection reconciliation passed: contextual ambiguity, offer, selection and structured summary.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
