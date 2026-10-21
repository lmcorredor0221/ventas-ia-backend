import assert from 'node:assert/strict';
import { UsageService } from '../services/usageService.js';

const state = {
  tenants: [{ id: 'tenant-e2e', config: { saas: { includedInteractions: 400, includedDeliveries: 400 } } }],
  usageCountersByTenant: {},
  usageBudgetAlertsByTenant: {},
};
const store = {
  getState: () => state,
  mutate: (callback) => callback(state),
};
const usage = new UsageService({ store, events: { emit: () => {} } });

usage.recordLlmPlan('tenant-e2e', {
  providerMetadata: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
  },
  inputText: 'necesito una Coca familiar',
  outputPlan: { intent: 'delivery_order' },
  executionMode: 'provider_api',
  conversationId: 'conv-e2e',
  stage: 'planner',
  durationMs: 145,
});

usage.recordLlmPlan('tenant-e2e', {
  providerMetadata: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { prompt_tokens: 45, completion_tokens: 30, total_tokens: 75 },
  },
  inputText: 'sobre de hechos validado',
  outputPlan: { reply: 'Claro, veci.' },
  executionMode: 'provider_api',
  conversationId: 'conv-e2e',
  stage: 'composer',
  durationMs: 95,
});

const summary = await usage.summary('tenant-e2e');
assert.equal(summary.metrics.llm_calls, 2);
assert.equal(summary.metrics.llm_total_tokens, 275);
assert.equal(summary.metrics.llm_planner_calls, 1);
assert.equal(summary.metrics.llm_composer_calls, 1);
assert.equal(summary.metrics.llm_planner_tokens, 200);
assert.equal(summary.metrics.llm_composer_tokens, 75);
assert.equal(summary.metrics.llm_planner_duration_ms, 145);
assert.equal(summary.metrics.llm_composer_duration_ms, 95);

console.log('LLM observability contract checks passed');
