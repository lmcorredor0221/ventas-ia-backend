import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LLMPlanner } from '../../server/services/llmPlanner.js';

// Fault-injection integration: the failed transport is injected, subsequent
// interpretation uses real DeepSeek. No Meta, Google or database operations.
assert.ok(process.env.DEEPSEEK_API_KEY, 'Supply DEEPSEEK_API_KEY without printing it');
assert.ok(!process.env.LLM_SIMULATOR, 'A simulator is not allowed');
const originalFetch = global.fetch;
const reports = [], usage = [];
let calls = 0;
global.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, 'https://api.deepseek.com');
  assert.ok(++calls <= 6, 'Bounded real provider calls');
  return originalFetch(url, options);
};
try {
  for (const scenario of [
    { id: 'addition_after_timeout', text: 'Y agrégame 1 queso campesino Colanta de 250 g', bread: true },
    { id: 'replacement_after_timeout', text: 'Olvida el pan, mejor solo 1 queso campesino Colanta de 250 g', bread: false },
  ]) {
    const planner = new LLMPlanner({ store: { getState: () => ({}) }, events: { emit() {} },
      usage: { recordLlmPlan(_tenant, value) { usage.push(value.providerMetadata?.usage ?? null); } }, config: { llmGroundingEnabled: true } });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek', model: 'deepseek-chat',
      apiKeyRef: 'DEEPSEEK_API_KEY', temperature: 0, maxTokens: 1400, timeoutMs: 30000 } });
    const transport = planner.gateway.request.bind(planner.gateway);
    planner.gateway.request = async () => { throw new Error('Injected provider timeout'); };
    const original = 'Me regalas 1 pan tajado Bimbo blanco de 500 g para domicilio';
    const failed = await planner.plan({ tenantId: 'local-test', conversationId: scenario.id,
      normalized: { messageId: 'failed-turn', text: original } });
    assert.equal(failed.executionMode, 'safe_handoff_fallback');
    planner.gateway.request = transport;
    const result = await planner.plan({ tenantId: 'local-test', conversationId: scenario.id,
      normalized: { messageId: 'recovery-turn', text: scenario.text }, conversation: { reasoningPlan: failed,
        messages: [{ role: 'customer', text: original }, { role: 'assistant', text: 'La tienda revisará tu solicitud.' }] } });
    const items = result.semanticFrame.items;
    const bread = items.filter(i => /bimbo/i.test(i.productHypothesis ?? ''));
    const cheese = items.filter(i => /queso/i.test(i.productHypothesis ?? ''));
    const passed = result.executionMode === 'provider_api' && bread.length === Number(scenario.bread)
      && cheese.length === 1 && items.length === 1 + Number(scenario.bread) && items.every(i => i.quantity === 1);
    reports.push({ id: scenario.id, passed, input: scenario.text, executionMode: result.executionMode, frame: result.semanticFrame });
  }
} finally { global.fetch = originalFetch; }
const evidence = path.resolve('test-results/interpreter-recovery', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(evidence, { recursive: true });
await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ scope: 'Injected timeout + real interpreter; not a full order E2E',
  calls, usage, reports }, null, 2));
console.log(JSON.stringify({ cases: reports.map(({ id, passed }) => ({ id, passed })), calls, evidence }));
assert.ok(reports.every(r => r.passed), 'Recovery must preserve an addition and respect an explicit replacement');
