import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-partial-order-review-'));
const { store, runtime, integrationOutbox, tools } = await createAppAsync({
  storageDriver: 'json',
  dataFile: path.join(dir, 'store.json'),
  whatsappMode: 'mock',
  allowLocalCatalogFallback: false,
  contextualProductSelectionV2: true,
  clarificationMaxAttempts: 2,
  backgroundWorkersEnabled: false,
});

const tenantId = 'andina';
const conversationId = 'partial-order-after-exhausted-product';
const waId = '573000009020';
const coke = {
  sku: 'COKE-15',
  name: 'Coca-Cola original',
  brand: 'Coca-Cola',
  presentation: '1.5 L',
  price: 7200,
  stock: 10,
  category: 'Bebidas',
};
const scopeKey = 'brownie mamai arequipe';
const outbound = [];
const handoffs = [];
const originalToolCall = tools.call.bind(tools);

tools.call = async (toolName, currentTenantId, currentConversationId, payload) => {
  if (toolName === 'google_sheets_read_table') return { rows: [], source_refs: [], status: 'not_applicable' };
  if (toolName === 'google_sheets_customer_profile_lookup') {
    return { profile: { waId, name: 'Luis', defaultAddress: 'Calle 1' } };
  }
  if (toolName === 'whatsapp_business_messaging') {
    outbound.push(payload);
    return { status: 'sent' };
  }
  if (toolName === 'human_handoff') handoffs.push(payload);
  return originalToolCall(toolName, currentTenantId, currentConversationId, payload);
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
      clarificationState: {
        version: 1,
        status: 'open',
        kind: 'catalog_ambiguity',
        scopeKey,
        attempts: 2,
        maxAttempts: 2,
        exhausted: false,
        unresolvedLineIds: ['L2'],
      },
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
        clarificationState: {
          version: 1,
          status: 'open',
          kind: 'catalog_ambiguity',
          scopeKey,
          attempts: 2,
          maxAttempts: 2,
          exhausted: false,
          unresolvedLineIds: ['L2'],
        },
      },
    });
  });

  const exhausted = await runtime.handleOrderClarification({
    tenantId,
    conversationId,
    normalized: { waId, text: 'No tengo más datos', traceId: 'trace-partial-order' },
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

  let conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(exhausted.summary, 'Structured order awaiting partial decision');
  assert.equal(conversation.status, 'live');
  assert.equal(handoffs.length, 0, 'Exhausting product clarification must not force an immediate human takeover');
  assert.equal(conversation.orderDraft.items.find((item) => item.lineId === 'L1')?.product?.sku, coke.sku);
  assert.equal(conversation.orderDraft.manualProductReview.status, 'awaiting_customer');
  assert.match(outbound.at(-1)?.text ?? '', /continuar con los productos encontrados/i);

  const offer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.purpose === 'partial_order_decision' && item.status === 'active');
  assert.ok(offer, 'The customer must receive a persisted partial-order decision');
  const continueOption = offer.options.find((item) => item.action === 'continue_partial_order');
  assert.ok(continueOption);

  await runtime.handleInteractiveReply({
    tenantId,
    conversationId,
    normalized: {
      waId,
      text: continueOption.title,
      traceId: 'trace-continue-partial-order',
      interactive: { optionId: continueOption.id },
    },
  });

  conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.deepEqual(conversation.orderDraft.items.map((item) => item.product?.sku), [coke.sku]);
  assert.equal(conversation.orderDraft.subtotal, 7200);
  assert.equal(conversation.orderDraft.manualProductReview.status, 'pending');
  assert.equal(conversation.orderDraft.manualProductReview.lines[0].catalogQuery, 'brownie mamai arequipe');
  assert.equal(conversation.orderDraft.manualProductReview.lines[0].status, 'pending');
  assert.ok(!conversation.orderDraft.missingFields.some((field) => field.startsWith('product:')));
  assert.equal(handoffs.length, 0);

  const paymentOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.purpose === 'payment_method' && item.status === 'active');
  assert.ok(paymentOffer, 'The partial basket must continue through the normal checkout.');
  const cashOption = paymentOffer.options.find((item) => item.value === 'cash');
  await runtime.handleInteractiveReply({
    tenantId,
    conversationId,
    normalized: { waId, text: cashOption.title, interactive: { optionId: cashOption.id } },
  });
  const confirmationOffer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.purpose === 'order_confirmation' && item.status === 'active');
  assert.ok(confirmationOffer);
  const confirmationOption = confirmationOffer.options.find((item) => item.action === 'confirm_order');
  await runtime.handleInteractiveReply({
    tenantId,
    conversationId,
    normalized: { waId, text: confirmationOption.title, interactive: { optionId: confirmationOption.id } },
  });
  const savedOrder = store.getState().ordersByTenant[tenantId]
    .find((item) => item.conversationId === conversationId);
  assert.ok(savedOrder);
  assert.equal(savedOrder.manualProductReview.status, 'pending');
  assert.equal(savedOrder.manualProductReview.lines[0].catalogQuery, 'brownie mamai arequipe');
  assert.equal(savedOrder.items.length, 1, 'The partial order must not invent the missing product.');

  console.log('Partial order decision preserves the basket and records the missing product for manual review.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
