import assert from 'node:assert/strict';
import { SemanticInterpreter } from '../services/semanticInterpreter.js';
import { semanticFrameFromPlan } from '../domain/semanticContracts.js';

const events = [];
const interpreter = new SemanticInterpreter({
  provider: async () => ({
    plan: {
      intent: 'greeting',
      items: [],
      sku: 'MUST-NOT-CROSS-BOUNDARY',
      price: 999999,
      stock: 100,
      toolPlan: [{ tool: 'google_sheets_order_write' }],
      confidence: 0.98,
    },
    executionMode: 'provider_api',
    providerMetadata: { provider: 'deepseek', usage: { total_tokens: 11 } },
  }),
  fallback: async () => {
    throw new Error('fallback should not run');
  },
  normalize: (plan, context) => semanticFrameFromPlan(plan, context),
  clock: (() => {
    let value = 100;
    return () => value += 5;
  })(),
});

const result = await interpreter.interpret({
  tenantId: 'demo',
  conversationId: 'conversation-1',
  text: 'Buenas veci',
  normalized: {
    messageId: 'wamid.interpreter.1',
    batchMessageIds: ['wamid.interpreter.0', 'wamid.interpreter.1'],
    text: 'Buenas veci',
  },
  conversation: null,
});

assert.equal(result.semanticFrame.intent, 'greeting');
assert.equal(result.semanticFrame.schemaVersion, 'semantic-frame.v2');
assert.equal('sku' in result.semanticFrame, false);
assert.equal('price' in result.semanticFrame, false);
assert.equal('stock' in result.semanticFrame, false);
assert.equal('toolPlan' in result.semanticFrame, false);
assert.equal(result.providerMetadata.usage.total_tokens, 11);
assert.equal(result.executionMode, 'provider_api');
assert.deepEqual(result.semanticFrame.replyTo, ['wamid.interpreter.0', 'wamid.interpreter.1']);
assert.equal(result.semanticFrame.cartMutation.mode, 'delta');
assert.equal(result.semanticFrame.proposedAction, 'answer');

const fallback = new SemanticInterpreter({
  provider: async () => { throw new Error('provider unavailable'); },
  fallback: async () => ({ plan: { intent: 'general_query', items: [] }, executionMode: 'mock_structured_fallback' }),
  normalize: (plan, context) => semanticFrameFromPlan(plan, context),
  onFallback: async ({ error }) => events.push(error.message),
});
const fallbackResult = await fallback.interpret({ text: 'Cual es el horario?' });
assert.equal(fallbackResult.semanticFrame.intent, 'general_query');
assert.deepEqual(events, ['provider unavailable']);
assert.ok(fallbackResult.fallbackError instanceof Error);

console.log('Semantic interpreter boundary contract passed.');
