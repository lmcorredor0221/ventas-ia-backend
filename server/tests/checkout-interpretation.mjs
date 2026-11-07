import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { LLMPlanner } from '../services/llmPlanner.js';

// Opt-in uses the real provider, but never creates an app, DB connection or message.
const real = process.env.VIA_CHECKOUT_REAL_LLM === '1';
if (real && !process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY required');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-checkout-interpretation-'));
const store = new JsonStore(path.join(dir, 'store.json'));
store.load();
const events = [];
const fetchBefore = globalThis.fetch;
const keyBefore = process.env.VIA_CHECKOUT_TEST_KEY;
const simulatorBefore = process.env.LLM_SIMULATOR;
delete process.env.LLM_SIMULATOR;
process.env.VIA_CHECKOUT_TEST_KEY = 'local-contract-only';
store.mutate(state => {
  state.productsByTenant.andina = [
    { sku: 'MILK-A', name: 'Leche entera Alqueria', presentation: '1 L', price: 4700, stock: 20 },
    { sku: 'MILK-C', name: 'Leche entera Colanta', presentation: '1 L', price: 4800, stock: 20 },
    { sku: 'BREAD', name: 'Pan tajado', presentation: '500 g', price: 6000, stock: 20 },
  ];
  state.platformSettings.llm = { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com',
    apiKeyRef: real ? 'DEEPSEEK_API_KEY' : 'VIA_CHECKOUT_TEST_KEY', temperature: 0, maxTokens: 900, simulator: null };
});
const planner = new LLMPlanner({ store, events: { emit: e => events.push(e) },
  // This contract suite validates legacy planner normalization and checkout
  // continuity. The staged provider contract is covered by llm-provider.mjs.
  config: { llmRequestTimeoutMs: 8000, llmMaxTokens: 900, llmJsonRetryMaxTokens: 1800, allowLocalCatalogFallback: false, whatsappMode: 'live', llmTwoStageInterpretationEnabled: false } });
const cart = { delivery: true, items: [{ skuHint: 'MILK-C', catalogQuery: 'Leche entera Colanta', quantity: 1 }], missingFields: ['payment_method'],
  checkout: { phase: 'review' } };
const cases = [
  { text: 'una leche entera', prior: '¿Qué productos quieres pedir?', draft: null },
  { text: 'Colanta', prior: 'Tengo leche entera Alqueria y Colanta de un litro. ¿Cuál prefieres?', draft: { ...cart, missingFields: ['presentation:leche entera', 'payment_method'] } },
  { text: 'en efectivo, y también un pan tajado', prior: '¿Quieres agregar algo más o continuar?', draft: cart, bread: true },
  { text: 'en efectivo', prior: '¿Cómo prefieres pagar?', draft: { ...cart, checkout: { phase: 'payment' } }, neutral: true },
  { text: 'con eso quedamos veci, no me agregue nada más', prior: '¿Quieres agregar algo más o continuar con este pedido?', draft: cart, complete: true },
];
try {
  for (const test of cases) {
    let prompt;
    globalThis.fetch = async (url, options) => {
      prompt = JSON.parse(options.body).messages.map(m => m.content).join('\n');
      if (real) return fetchBefore(url, options);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: test.draft ? 'order_clarification' : 'delivery_order',
        order: { delivery: true, items: [...cart.items, ...(test.bread ? [{ skuHint: 'BREAD', catalogQuery: 'Pan tajado', quantity: 1 }] : [])], collectionComplete: test.complete ? true : null }, confidence: 0.9 }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
    };
    const plan = await planner.plan({ tenantId: 'andina', conversationId: 'local-only', normalized: { text: test.text },
      customerProfile: { name: 'Cliente', defaultAddress: 'Calle de prueba' }, conversation: { orderDraft: test.draft, messages: [{ role: 'agent', text: test.prior }] } });
    assert.equal(plan.executionMode, 'provider_api');
    assert.match(prompt, /order.collectionComplete:true/);
    assert.equal(plan.order?.collectionComplete === true, test.complete === true, test.text);
    if (test.neutral) assert.notEqual(plan.order?.collectionComplete, false, 'Selecting payment must not reopen an already reviewed basket');
    if (test.bread) assert.ok(plan.order.items.some(i => /pan/i.test(i.catalogQuery ?? i.rawName)), 'Volunteered payment must not discard the added product');
    if (test.complete) assert.equal(plan.intent, 'order_clarification', 'Finishing the basket does not place an order');
    console.log(JSON.stringify({ text: test.text, intent: plan.intent, collectionComplete: plan.order?.collectionComplete ?? null, mode: plan.executionMode }));
  }
  console.log(`Checkout interpretation passed: ${cases.length} cases; ${real ? 'real DeepSeek; no WhatsApp' : 'provider contract'}.`);
} finally {
  globalThis.fetch = fetchBefore;
  if (keyBefore === undefined) delete process.env.VIA_CHECKOUT_TEST_KEY; else process.env.VIA_CHECKOUT_TEST_KEY = keyBefore;
  if (simulatorBefore === undefined) delete process.env.LLM_SIMULATOR; else process.env.LLM_SIMULATOR = simulatorBefore;
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('via-checkout-interpretation-')) fs.rmSync(dir, { recursive: true, force: true });
}
