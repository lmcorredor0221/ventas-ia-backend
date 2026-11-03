import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

// Real planner normalization/runtime with a controlled provider response.
// Optional real DeepSeek mode still uses temporary JSON and mock WhatsApp.
const real = process.env.VIA_GREETING_REAL_LLM === '1';
if (real && !process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY required');
const previousFetch = globalThis.fetch;
const previousKey = process.env.VIA_GREETING_TEST_KEY;
const previousSimulator = process.env.LLM_SIMULATOR;
delete process.env.LLM_SIMULATOR;
process.env.VIA_GREETING_TEST_KEY = 'local-contract-only';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-greeting-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', dataFile: path.join(dir, 'store.json'), whatsappMode: 'mock',
  backgroundWorkersEnabled: false, integrationOutboxEnabled: false,
  llmResponseComposerEnabled: false, llmRequestTimeoutMs: 8000, llmMaxTokens: 600,
});
store.mutate(state => {
  state.platformSettings.llm = { provider: 'deepseek', model: 'deepseek-chat',
    apiKeyRef: real ? 'DEEPSEEK_API_KEY' : 'VIA_GREETING_TEST_KEY',
    baseUrl: 'https://api.deepseek.com', simulator: null, temperature: 0, maxTokens: 600 };
  state.tenants.find(t => t.id === 'andina').config.agentPolicy = { tone: 'tendero_colombiano' };
  state.productsByTenant.andina = [{ sku: 'COLA', name: 'Coca-Cola', presentation: '1.5 L', price: 7200, stock: 10 }];
  if (process.env.VIA_GREETING_CATALOG_300 === '1') state.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300);
});
let providerPlan;
let prompt;
let providerCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'No Meta/Google calls allowed');
  providerCalls++;
  prompt = JSON.parse(options.body).messages.map(m => m.content).join('\n');
  if (real) return previousFetch(url, options);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerPlan) } }],
    usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 } }), { status: 200 });
};
const calls = [];
const callTool = runtime.tools.call.bind(runtime.tools);
runtime.tools.call = async (name, ...args) => { calls.push(name); return callTool(name, ...args); };
const reports = [];
let seq = 0;
async function run(text, expectedIntent, extra = {}) {
  const waId = `57399000${String(++seq).padStart(3, '0')}`;
  providerPlan = { intent: expectedIntent, greetingReply: expectedIntent === 'greeting' ? '¡Hola, veci! ¿En qué te puedo ayudar?' : null,
    order: { delivery: false, items: [] }, ...extra };
  calls.length = 0;
  const before = providerCalls;
  const result = await runtime.processInbound({ tenantId: 'andina', waId,
    text, messageId: `greeting-${seq}`, messageType: 'text', provider: 'whatsapp' });
  const c = result.conversation;
  if (result.result.plan.executionMode !== 'provider_api') {
    console.log(store.getState().events.filter(e => e.type === 'llm.plan.fallback').map(e => e.detail));
  }
  assert.equal(result.result.plan.executionMode, 'provider_api', text);
  assert.equal(result.result.plan.intent, expectedIntent, text);
  const reply = c.messages.filter(m => m.role === 'agent').at(-1)?.text;
  assert.ok(reply, 'Every scenario must receive a reply');
  if (expectedIntent === 'greeting') {
    assert.equal(providerCalls - before, 1, 'Greeting uses the existing LLM call, no second composer request');
    assert.ok(!calls.includes('google_sheets_read_table'), 'Greetings must not search the catalog');
    assert.ok(!calls.includes('human_handoff'), 'Greetings must not create a human task');
    assert.ok(!c.orderDraft?.items?.length, 'Greeting must not create a cart');
    assert.doesNotMatch(reply, /no encontr|coincidencia|subtotal|\$\s*0/i);
    assert.equal(c.status, 'live');
  }
  const planning = store.getState().events.find(e => e.conversationId === c.id && e.type === 'llm.plan.created');
  reports.push({ text, intent: result.result.plan.intent, reply, calls: [...calls],
    durationMs: planning?.metadata?.providerMetadata?.durationMs,
    usage: planning?.metadata?.providerMetadata?.usage });
  return result;
}
try {
  await run('Buenas', 'greeting');
  assert.match(prompt, /greeting/);
  assert.match(prompt, /tendero_colombiano/);
  await run('Hola veci', 'greeting');
  await run('Muy buenas, ¿cómo va todo por allá?', 'greeting');
  await run('Hola veci, regálame una Coca-Cola de 1.5 L para domicilio', 'delivery_order', {
    order: { delivery: true, items: [{ rawName: 'Coca-Cola', catalogQuery: 'Coca-Cola', skuHint: 'COLA', quantity: 1 }] },
    missingFields: ['customer_name', 'delivery_address', 'payment_method'],
  });
  await run('Buenas noches para un domicilio', 'delivery_order', {
    order: { delivery: true, items: [] }, missingFields: ['order_items'],
  });
  const draft = { delivery: true, subtotal: 7200, paymentMethod: 'cash', missingFields: ['delivery_address'],
    items: [{ skuHint: 'COLA', catalogQuery: 'Coca-Cola', quantity: 1, lineTotal: 7200 }] };
  const conversationId = 'greeting-existing-order';
  store.mutate(state => state.conversations.unshift({ id: conversationId, tenantId: 'andina', waId: '573991111111',
    messages: [], status: 'live', stage: 'clarification', zone: 'agent', orderDraft: structuredClone(draft),
    progress: 60, nextStep: 'Esperar dirección' }));
  providerPlan = { intent: 'greeting', greetingReply: '¡Hola, veci! Aquí seguimos, ¿en qué te ayudo?', order: { items: [] } };
  calls.length = 0;
  const active = await runtime.processInbound({ tenantId: 'andina', waId: '573991111111', text: 'Hola veci',
    messageId: 'greeting-existing', messageType: 'text', provider: 'whatsapp' });
  assert.equal(active.result.plan.intent, 'greeting');
  assert.deepEqual(active.conversation.orderDraft, draft, 'Greeting must preserve prices, items, payment and missing fields');
  assert.equal(active.conversation.stage, 'clarification');
  assert.equal(active.conversation.nextStep, 'Esperar dirección');
  assert.ok(!calls.includes('google_sheets_read_table'));
  reports.push({ text: 'Hola veci (carrito activo)', intent: active.result.plan.intent,
    reply: active.conversation.messages.filter(m => m.role === 'agent').at(-1)?.text });
  if (!real) {
    await run('Buenas', 'greeting', { greetingReply: 'Promoción por $ 50.000' });
    // An inconsistent provider label must never silently discard product candidates.
    providerPlan = { intent: 'greeting', order: { delivery: true, items: [{ catalogQuery: 'Coca-Cola', quantity: 1 }] } };
    const guarded = await runtime.planner.plan({ tenantId: 'andina', conversationId: 'guard',
      normalized: { text: 'Hola, quiero una Coca-Cola', waId: '573991111110' } });
    assert.notEqual(guarded.intent, 'greeting');
    assert.equal(guarded.order.items.length, 1);
    // Real composer path must accept valid wording and reject invented amounts.
    runtime.planner.config.llmResponseComposerEnabled = true;
    providerPlan = { reply: '¡Hola, veci! ¿En qué te ayudo hoy?' };
    const composed = await runtime.planner.composeReply({ tenantId: 'andina', conversationId: 'composer',
      facts: {}, fallbackText: 'Texto de respaldo' });
    assert.equal(composed.executionMode, 'provider_api');
    assert.equal(composed.text, providerPlan.reply);
    providerPlan = { reply: 'El subtotal es $ 50.000' };
    const guardedReply = await runtime.planner.composeReply({ tenantId: 'andina', conversationId: 'composer-money',
      facts: { subtotal: 7200 }, fallbackText: 'El subtotal es $ 7.200' });
    assert.equal(guardedReply.text, 'El subtotal es $ 7.200');
  }
  console.log(JSON.stringify({ mode: real ? 'deepseek_real_whatsapp_mock' : 'provider_contract_whatsapp_mock',
    catalogSize: store.getState().productsByTenant.andina.length, reports }, null, 2));
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.VIA_GREETING_TEST_KEY; else process.env.VIA_GREETING_TEST_KEY = previousKey;
  if (previousSimulator === undefined) delete process.env.LLM_SIMULATOR; else process.env.LLM_SIMULATOR = previousSimulator;
  runtime.stop(); integrationOutbox.stop(); await store.close?.();
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('via-greeting-')) fs.rmSync(dir, { recursive: true, force: true });
}
