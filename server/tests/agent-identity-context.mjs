import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { LLMPlanner } from '../services/llmPlanner.js';
import { agentDisplayNameForTenant, normalizeAgentDisplayName } from '../domain/agentIdentity.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

const real = process.env.VIA_IDENTITY_REAL_LLM === '1';
if (real && !process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY required');
const previousFetch = globalThis.fetch;
const previousKey = process.env.VIA_IDENTITY_TEST_KEY;
const previousSimulator = process.env.LLM_SIMULATOR;
delete process.env.LLM_SIMULATOR;
process.env.VIA_IDENTITY_TEST_KEY = 'contract-only';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-identity-context-'));
const store = new JsonStore(path.join(dir, 'store.json'));
store.load();
const events = [];
const reports = [];
let testCase;
let capturedPrompt;
let turnPrompts = [];
const planner = new LLMPlanner({ store, events: { emit: e => events.push(e) },
  config: { llmRequestTimeoutMs: 8000, llmMaxTokens: 600, llmResponseComposerEnabled: true } });
const cart = { delivery: true, items: [{ rawName: 'Coca-Cola', catalogQuery: 'Coca-Cola original', quantity: 1 }],
  missingFields: ['presentation:Coca-Cola'] };
const cases = [
  ...['Quiubo', 'Q hubo veci', 'Qué más pues', 'Buenas, sumercé', 'Hola, ¿bien o qué?', 'Muy buenos días'].map(text => ({ text, intent: 'greeting', introduction: true })),
  { text: 'Hola Rocio', intent: 'greeting', introduction: true },
  { text: '¿Cómo se llama el asistente?', intent: 'greeting', introduction: true },
  { text: 'Quiubo, regálame una Coca-Cola de litro y medio para domicilio', intent: 'delivery_order', items: true },
  { text: 'Buenas, para un domicilio', intent: 'delivery_order' },
  { text: '¿Qué más tienes de gaseosas?', intent: 'catalog_query' },
  { text: '¿Qué hubo con mi pedido? No ha llegado', intent: 'human_handoff' },
  { text: 'De litro y medio, veci', intent: 'order_clarification', conversation: { orderDraft: cart,
    messages: [{ role: 'user', text: 'Quiero una Coca-Cola para domicilio' }, { role: 'agent', text: '¿Qué presentación prefieres?' }] } },
  { text: 'Hola veci', intent: 'greeting', conversation: { orderDraft: cart,
    messages: [{ role: 'agent', text: 'Soy Rocío, tu asistente virtual. ¿Qué presentación prefieres?' }] } },
  { text: '¿Qué más tienes?', intent: 'catalog_query', conversation: { messages: [
    { role: 'user', text: '¿Qué gaseosas tienes?' }, { role: 'agent', text: 'Encontré Coca-Cola y Sprite. ¿Quieres revisar otras opciones?' }] } },
  { text: 'Hola, ¿cómo te llamas?', intent: 'greeting', tenantId: 'norte', name: 'Lucía', introduction: true },
  { text: 'Hola', intent: 'greeting', introduction: true },
];

try {
  assert.equal(agentDisplayNameForTenant({}), 'Rocío');
  assert.equal(normalizeAgentDisplayName('  María José  '), 'María José');
  assert.throws(() => normalizeAgentDisplayName({ name: 'Rocío' }), /nombre/);
  store.mutate(state => {
    state.platformSettings.llm = { provider: 'deepseek', model: 'deepseek-chat', simulator: null,
      apiKeyRef: real ? 'DEEPSEEK_API_KEY' : 'VIA_IDENTITY_TEST_KEY', baseUrl: 'https://api.deepseek.com',
      temperature: 0, maxTokens: 600, timeoutMs: 8000 };
    state.tenants.find(t => t.id === 'andina').config.agentPolicy = { tone: 'tendero_colombiano' };
    state.tenants.find(t => t.id === 'norte').config.agentPolicy = { displayName: 'Lucía', tone: 'formal' };
    for (const id of ['andina', 'norte']) state.productsByTenant[id] = structuredClone(colombiaCatalogTestSeed300);
  });
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions', 'Only DeepSeek may receive test requests');
    const requestMessages = JSON.parse(options.body).messages;
    capturedPrompt = requestMessages.map(m => m.content).join('\n');
    turnPrompts.push(capturedPrompt);
    if (real) return previousFetch(url, options);
    const name = testCase.name ?? 'Rocío';
    const isProductStage = capturedPrompt.includes('intérprete de productos');
    const content = isProductStage
      ? { items: cart.items, customerDetails: { name: null, deliveryAddress: null }, orderSignals: {}, missingInfo: [], confidence: 0.9 }
      : { intent: testCase.intent, greetingReply: testCase.introduction
        ? `Hola, soy ${name}, tu asistente virtual. ¿Qué necesitas?` : 'Hola, aquí estoy. ¿En qué te ayudo?',
        customerDetails: { name: null, deliveryAddress: null }, order: testCase.items ? cart : { items: [] } };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100 } }), { status: 200 });
  };
  for (const [i, scenario] of cases.entries()) {
    testCase = scenario;
    turnPrompts = [];
    const result = await planner.plan({ tenantId: scenario.tenantId ?? 'andina', conversationId: `context-${i}`,
      normalized: { text: scenario.text, waId: 'synthetic-buyer' }, conversation: scenario.conversation ?? null });
    const event = events.findLast(e => e.type === 'llm.plan.created');
    const expectedMode = ['greeting', 'human_handoff'].includes(scenario.intent)
      ? 'provider_api_context_only'
      : 'provider_api_two_stage';
    assert.equal(result.executionMode, expectedMode, `${scenario.text}: ${events.findLast(e => e.type === 'llm.plan.fallback')?.detail}`);
    assert.equal(result.intent, scenario.intent, scenario.text);
    assert.ok(turnPrompts.some(prompt => prompt.includes(`"name":"${scenario.name ?? 'Rocío'}"`)));
    assert.ok(turnPrompts.some(prompt => prompt.includes('recentMessages')));
    if (scenario.conversation?.messages?.length) assert.ok(turnPrompts.some(prompt => prompt.includes(scenario.conversation.messages[0].text)));
    if (scenario.intent === 'greeting') {
      assert.equal(result.order.items.length, 0, 'Vocatives/greetings must not become products');
      assert.equal(result.customerDetails.name, null, 'Agent/vocative is not the buyer name');
      if (scenario.introduction) {
        assert.ok(result.greetingReply.includes(scenario.name ?? 'Rocío'), result.greetingReply);
        assert.match(result.greetingReply, /asistente|virtual/i);
      } else assert.doesNotMatch(result.greetingReply, /soy Rocío|me llamo|asistente virtual/i, 'Do not introduce again');
    }
    if (scenario.items) assert.ok(result.order.items.some(item => /coca/i.test(item.catalogQuery ?? item.rawName)));
    reports.push({ text: scenario.text, tenantId: scenario.tenantId ?? 'andina', intent: result.intent,
      reply: result.greetingReply, durationMs: event.metadata.providerMetadata?.durationMs });
    console.log(JSON.stringify(reports.at(-1)));
  }
  console.log(JSON.stringify({ passed: reports.length, mode: real ? 'DeepSeek real, no WhatsApp' : 'provider contract', catalogSize: 300 }));
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.VIA_IDENTITY_TEST_KEY; else process.env.VIA_IDENTITY_TEST_KEY = previousKey;
  if (previousSimulator === undefined) delete process.env.LLM_SIMULATOR; else process.env.LLM_SIMULATOR = previousSimulator;
  await store.close?.();
  if (path.dirname(dir) === os.tmpdir() && path.basename(dir).startsWith('via-identity-context-')) fs.rmSync(dir, { recursive: true, force: true });
}
