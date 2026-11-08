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
const { store, runtime, integrationOutbox, tools } = await createAppAsync({
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
  { sku: 'COKE-350', name: 'Coca-Cola original', brand: 'Coca-Cola', presentation: '350 ml', description: 'Gaseosa original', price: 3200, stock: 10, category: 'Bebidas', aliases: ['coca 350', 'coca cola 350'] },
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
  const standaloneChocorramo = await tools.googleSheetsReadTable('andina', { query: 'chocorramo', filters: {} });
  assert.deepEqual(standaloneChocorramo.rows.map((item) => item.sku).sort(), ['CHOCORAMO-35', 'CHOCORAMO-65']);

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
            // The interpreter may preserve the customer's phrasing. Retrieval
            // must treat it as semantic evidence, not as a literal database
            // predicate that removes the 1.5 L alternatives.
            requestedPresentation: 'litro y medio',
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
      // Reproduce the plan produced by the interpreter: attributes are useful
      // retrieval evidence, but must not become exact database predicates.
      toolPlan: [
        {
          tool: 'google_sheets_read_table',
          candidateIndex: 0,
          candidate: 'Coca-Cola litro y medio',
          filters: { presentation: 'litro y medio', attributes: { formato: 'familiar' } },
        },
        {
          tool: 'google_sheets_read_table',
          candidateIndex: 1,
          candidate: 'chocorramo',
          filters: {},
        },
      ],
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

  // A compact numeric presentation is common in WhatsApp ("coca 350").
  // The LLM may omit the unit in its structured item. The resolver may use
  // catalog evidence to ground that number, but it must not turn it into a
  // retrieval filter or confuse it with the order quantity.
  const numericConversationId = 'catalog-numeric-presentation-regression';
  store.mutate((state) => {
    state.conversations.unshift({ id: numericConversationId, tenantId: 'andina', waId: '573000000890', messages: [], status: 'live' });
  });
  await runtime.handleDeliveryOrder({
    tenantId: 'andina',
    conversationId: numericConversationId,
    normalized: { waId: '573000000890', text: 'Para domicilio una coca cola 350', traceId: 'trace-catalog-numeric-presentation-regression' },
    customerProfile: { name: 'Cliente local', defaultAddress: 'Calle de prueba 10' },
    plan: {
      intent: 'delivery_order',
      order: {
        delivery: true,
        paymentMethod: 'efectivo',
        items: [{ lineId: 'coca-350', rawName: 'coca cola 350', catalogQuery: 'coca cola 350', quantity: 1 }],
      },
      missingFields: [],
      toolPlan: [{ tool: 'google_sheets_read_table', candidateIndex: 0, candidate: 'coca cola 350', filters: {} }],
    },
  });
  const numericDraft = store.getState().conversations.find((item) => item.id === numericConversationId)?.orderDraft;
  const numericCoke = numericDraft?.items.find((item) => item.lineId === 'coca-350');
  assert.equal(numericCoke?.product?.sku, 'COKE-350', 'Debe resolver la presentación numérica que el cliente expresó');
  assert.ok(!numericDraft?.missingFields?.includes('selection:coca-350'), 'No debe pedir elegir entre presentaciones incompatibles');
  console.log('Catalog ambiguity regression passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
