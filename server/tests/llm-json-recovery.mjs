import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { LLMPlanner } from '../services/llmPlanner.js';
import { UsageService } from '../services/usageService.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-json-recovery-'));
const previousFetch = globalThis.fetch;
const previousKey = process.env.VIA_JSON_TEST_KEY;
const previousSimulator = process.env.LLM_SIMULATOR;
const store = new JsonStore(path.join(dir, 'store.json'));
const events = [];
const eventBus = { emit: event => events.push(event) };
delete process.env.LLM_SIMULATOR;
process.env.VIA_JSON_TEST_KEY = 'test-only';
try {
  store.load();
  store.mutate(state => { state.platformSettings.llm = {
    provider: 'deepseek', model: 'deepseek-chat', apiKeyRef: 'VIA_JSON_TEST_KEY',
    baseUrl: 'https://api.deepseek.com', temperature: 0, maxTokens: 600, simulator: null,
  }; });
  const usage = new UsageService({ store, events: eventBus });
  const planner = new LLMPlanner({ store, events: eventBus, usage, config: {
    whatsappMode: 'live', allowLocalCatalogFallback: false, llmRequestTimeoutMs: 8000,
    llmMaxTokens: 600, llmJsonRetryMaxTokens: 1800,
    // This file validates bounded recovery of the legacy single-call
    // structured contract; staged context/product interpretation is covered
    // by llm-provider.mjs.
    llmTwoStageInterpretationEnabled: false,
  } });
  const valid = { intent: 'delivery_order', order: { delivery: true, items: [
    { rawName: 'leche entera', catalogQuery: 'leche entera', quantity: 1 },
    { rawName: 'un panta tajado', catalogQuery: 'pan tajado', quantity: 1 },
  ] }, confidence: 0.8 };
  const run = id => planner.plan({ tenantId: 'andina', conversationId: id,
    normalized: { text: 'un panta tajado', waId: '573001112233' },
    customerProfile: null, conversation: { orderDraft: { delivery: true, items: [
      { rawName: 'leche entera', catalogQuery: 'leche entera', quantity: 1 },
    ] } } });
  let calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.deepseek.com/chat/completions');
    calls.push(JSON.parse(options.body));
    const first = calls.length === 1;
    return Response.json({ choices: [{ finish_reason: first ? 'length' : 'stop',
      message: { content: first ? '{"intent":"delivery_order","order":{"items":[' : JSON.stringify(valid) } }],
      usage: { prompt_tokens: 100, completion_tokens: first ? 600 : 200,
        total_tokens: first ? 700 : 300, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60 } });
  };
  const plan = await run('retry-success');
  assert.equal(plan.executionMode, 'provider_api', 'A truncated provider response must recover before handoff');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].max_tokens, 600);
  assert.equal(calls[1].max_tokens, 1800);
  assert.ok(calls[1].messages.some(m => m.content.includes('un panta tajado')));
  assert.deepEqual(plan.order.items.map(i => i.catalogQuery), ['leche entera', 'pan tajado']);
  const meta = events.find(e => e.conversationId === 'retry-success' && e.type === 'llm.plan.created').metadata.providerMetadata;
  assert.equal(meta.attempts.length, 2);
  assert.equal(meta.attempts[0].finishReason, 'length');
  assert.equal(meta.usage.total_tokens, 1000, 'Count both paid attempts');
  assert.equal(meta.usage.prompt_cache_hit_tokens, 80);
  assert.equal((await usage.summary('andina')).metrics.llm_calls, 2);

  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"order":' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  };
  const failed = await run('retry-exhausted');
  assert.equal(calls.length, 2, 'Invalid JSON retries once only');
  assert.equal(failed.executionMode, 'provider_unavailable');
  assert.equal(failed.intent, 'provider_unavailable');
  assert.equal(failed.order.items[0].catalogQuery, 'leche entera', 'Keep the existing cart on failure');
  const failure = events.find(e => e.conversationId === 'retry-exhausted' && e.type === 'llm.plan.fallback');
  assert.equal(failure.metadata.providerMetadata.usage.total_tokens, 60);

  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response('Unauthorized', { status: 401 });
  };
  const unauthorized = await run('no-auth-retry');
  assert.equal(unauthorized.executionMode, 'provider_unavailable');
  assert.equal(calls.length, 1, 'Do not retry invalid credentials as JSON errors');

  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(valid) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  };
  assert.equal((await run('normal-response')).executionMode, 'provider_api');
  assert.equal(calls.length, 1, 'Valid replies retain the single-call fast path');

  // The two-stage path must have the same bounded JSON recovery as the
  // legacy full-plan path. A malformed product-inference response cannot
  // turn a correct semantic correction into a mock/handoff fallback.
  const twoStagePlanner = new LLMPlanner({ store, events: eventBus, usage, config: {
    whatsappMode: 'live', allowLocalCatalogFallback: false, llmRequestTimeoutMs: 8000,
    llmMaxTokens: 600, llmJsonRetryMaxTokens: 1800,
  } });
  calls = [];
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    const productStage = request.messages.some((message) => String(message.content).includes('intérprete de productos'));
    const isFirstProductAttempt = productStage && calls.filter((item) => item.messages.some((message) => String(message.content).includes('intérprete de productos'))).length === 1;
    const content = !productStage
      ? JSON.stringify({ intent: 'delivery_order', productRequestDetected: true, pendingAction: null, customerUnderstanding: { delivery: true }, customerDetails: {}, confidence: 0.9 })
      : isFirstProductAttempt
        ? '{"items":[{"rawName":"pan tajado"'
        : JSON.stringify({ items: [{ rawName: 'pan tajado', catalogQuery: 'pan tajado', productHypothesis: "pan tajado (posible corrección de 'pantajado')", quantity: 1 }], customerDetails: {}, confidence: 0.9 });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } });
  };
  const twoStage = await twoStagePlanner.plan({ tenantId: 'andina', conversationId: 'two-stage-json-retry',
    normalized: { text: 'un pantajado', waId: '573001112234' }, customerProfile: null, conversation: { messages: [] } });
  assert.equal(twoStage.executionMode, 'provider_api_two_stage');
  assert.equal(twoStage.order.items[0].catalogQuery, 'pan tajado');
  assert.equal(calls.length, 3, 'Context once; malformed product inference retries once');

  const originalNow = Date.now;
  let elapsed = 0;
  const base = originalNow();
  calls = [];
  Date.now = () => base + elapsed;
  try {
    globalThis.fetch = async (url, options) => {
      calls.push(JSON.parse(options.body));
      elapsed = 8001;
      return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] });
    };
    assert.equal((await run('deadline-exhausted')).executionMode, 'provider_unavailable');
    assert.equal(calls.length, 1, 'Never start a retry after the original request deadline');
  } finally { Date.now = originalNow; }
  console.log('LLM JSON recovery passed: bounded retry, cart preserved, accurate usage, safe handoff');
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.VIA_JSON_TEST_KEY; else process.env.VIA_JSON_TEST_KEY = previousKey;
  if (previousSimulator === undefined) delete process.env.LLM_SIMULATOR; else process.env.LLM_SIMULATOR = previousSimulator;
  store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
