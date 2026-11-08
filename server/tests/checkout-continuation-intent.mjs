import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { LLMPlanner } from '../services/llmPlanner.js';

// Sanitized reproduction of the production checkpoint: the basket is already
// resolved, the customer sees its summary, then writes a natural acceptance.
// No production store, customer data, provider credential or external request
// is used. The mocked provider only represents the contextual LLM decision.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-checkout-continuation-'));
const store = new JsonStore(path.join(dir, 'store.json'));
const fetchBefore = globalThis.fetch;
const keyBefore = process.env.VIA_CHECKOUT_CONTINUATION_TEST_KEY;
process.env.VIA_CHECKOUT_CONTINUATION_TEST_KEY = 'local-contract-only';

try {
  store.load();
  store.mutate((state) => {
    state.platformSettings.llm = {
      ...state.platformSettings.llm,
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
      apiKeyRef: 'VIA_CHECKOUT_CONTINUATION_TEST_KEY',
      simulator: null,
      temperature: 0,
      maxTokens: 600,
    };
  });
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    const prompt = JSON.parse(options.body).messages.map((message) => String(message.content ?? '')).join('\n');
    prompts.push(prompt);
    assert.match(prompt, /pendingAction/);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        intent: 'order_clarification',
        dialogueAct: 'accept_current_basket',
        productRequestDetected: false,
        respondsToPendingQuestion: true,
        addsToExistingCart: false,
        modifiesExistingCart: false,
        explicitHumanRequest: false,
        handoffRequested: false,
        customerDetails: {},
        pendingAction: 'continue_checkout',
        customerUnderstanding: { rawNeed: 'Confirmado', delivery: true },
        confidence: 0.94,
      }) } }],
      usage: { prompt_tokens: 110, completion_tokens: 45, total_tokens: 155 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const planner = new LLMPlanner({
    store,
    events: { emit() {} },
    config: { llmRequestTimeoutMs: 5000, llmMaxTokens: 600 },
  });
  const conversation = {
    id: 'checkout-continuation',
    stage: 'clarification',
    orderDraft: {
      delivery: true,
      subtotal: 10000,
      missingFields: ['payment_method'],
      checkout: { phase: 'review', reviewedKey: null },
      items: [
        { catalogQuery: 'Coca-Cola original', quantity: 1, lineTotal: 7200, available: true, product: { sku: 'COLA-15', name: 'Coca-Cola original', price: 7200 } },
        { catalogQuery: 'Ponque Chocoramo', quantity: 1, lineTotal: 2800, available: true, product: { sku: 'CHOC-65', name: 'Ponque Chocoramo', price: 2800 } },
      ],
    },
    messages: [{ role: 'agent', text: 'Resumen del pedido. ¿Quieres agregar algo más o continuar con este pedido?' }],
  };
  const plan = await planner.plan({
    tenantId: 'andina',
    conversationId: conversation.id,
    normalized: { text: 'Confirmado', waId: '573000000000' },
    customerProfile: { name: 'Cliente local', defaultAddress: 'Dirección de prueba' },
    conversation,
  });
  assert.equal(prompts.length, 1, 'A pure continuation needs only contextual interpretation, not product inference');
  assert.equal(plan.executionMode, 'provider_api_context_only');
  assert.equal(plan.intent, 'order_clarification');
  assert.equal(plan.order.collectionComplete, true, 'A contextual acceptance of the review must advance to payment');
  assert.match(prompts[0], /continue_checkout/);
  console.log('Checkout continuation intent passed: contextual acceptance advances the resolved basket to payment.');
} finally {
  globalThis.fetch = fetchBefore;
  if (keyBefore === undefined) delete process.env.VIA_CHECKOUT_CONTINUATION_TEST_KEY;
  else process.env.VIA_CHECKOUT_CONTINUATION_TEST_KEY = keyBefore;
  store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
