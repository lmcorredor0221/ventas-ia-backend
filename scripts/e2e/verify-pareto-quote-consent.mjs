import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAppAsync } from '../../server/index.js';
import { colombiaCatalogTestSeed300 } from '../../server/data/colombiaCatalogExpansion.js';

// Focused runtime integration replay of D/24: the buyer is scripted to reach
// the observed consent defect. Real DeepSeek; local storage and Meta/Google.
// This supplements, and does not replace, the full webhook/PostgreSQL campaign.
assert.ok(process.env.DEEPSEEK_API_KEY && !process.env.LLM_SIMULATOR, 'Real DeepSeek required');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'via-pareto-consent-'));
const evidence = path.resolve('test-results/pareto-consent-replay', new Date().toISOString().replace(/[:.]/g, '-'));
const codeFiles = ['agentRuntime', 'llmPlanner', 'llmReplyComposer', 'conversationGroundingCoordinator', 'groundedDecisionAgent', 'toolRegistry']
  .map(name => `server/services/${name}.js`);
const hashes = async () => Object.fromEntries(await Promise.all(codeFiles.map(async file => [file,
  createHash('sha256').update(await fs.readFile(file)).digest('hex')])));
const report = { status: 'running', before: await hashes(), turns: [], calls: [], failures: [] };
const fetchOriginal = global.fetch;
global.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, 'https://api.deepseek.com', 'No external integrations allowed');
  assert.ok(report.calls.length < 30, 'Bounded provider budget');
  const call = { startedAt: Date.now() }; report.calls.push(call);
  const response = await fetchOriginal(url, options);
  call.status = response.status; call.durationMs = Date.now() - call.startedAt;
  call.usage = (await response.clone().json().catch(() => ({}))).usage ?? null;
  return response;
};
let app;
try {
  app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(temporary, 'state.json'),
    whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true,
    llmResponseComposerEnabled: true, llmGroundingTimeoutMs: 15000, llmRequestTimeoutMs: 30000 });
  app.store.mutate(s => {
    s.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300);
    Object.assign(s.tenants.find(t => t.id === 'andina').config.orderPolicy, { deliveryFee: 0, deliveryMinimumSubtotal: 0 });
    s.platformSettings.llm = { provider: 'deepseek', model: 'deepseek-chat', apiKeyRef: 'DEEPSEEK_API_KEY',
      baseUrlRef: 'DEEPSEEK_BASE_URL', simulator: null, temperature: 0, maxTokens: 1600, timeoutMs: 30000 };
  });
  const turns = [
    'Me regala 1 yogurt alpina fresa y 1 galletas festival chocolate',
    'El yogurt Alpina en vaso de 150 g y las galletas Festival chocolate de 12 unidades, uno de cada uno.',
    'Eso es todo. Soy Laura Prueba. Es para domicilio en Calle E2E 100 # 10-20, Bogotá, y pago en efectivo. ¿Me confirmas el subtotal de productos, la tarifa de domicilio y el total final a pagar?',
    'Sí, confirmo ese pedido con ese total.',
  ];
  let conversation;
  for (const [index, text] of turns.entries()) {
    const before = conversation?.messages?.length ?? 0, start = Date.now();
    const result = await app.runtime.processInbound({ tenantId: 'andina', waId: '573000002024',
      messageId: `consent-replay-${index}`, messageType: 'text', text });
    conversation = result.conversation;
    const reply = conversation.messages.slice(before).filter(m => ['agent', 'assistant'].includes(m.role)).map(m => m.text).join('\n');
    report.turns.push({ input: text, reply, durationMs: Date.now() - start, plan: conversation.reasoningPlan,
      pendingQuestion: conversation.pendingQuestion, communicatedQuote: conversation.communicatedQuote,
      draft: structuredClone(conversation.orderDraft), orderId: conversation.orderId ?? null });
    assert.equal(conversation.reasoningPlan.executionMode, 'provider_api');
    assert.ok(reply, 'No silence');
    if (index < 3) assert.ok(!conversation.orderId, 'No purchase before consent');
    if (index === 2) assert.ok(conversation.communicatedQuote, 'The complete price answer was sent');
  }
  const order = app.orders.findOrder(conversation.orderId, 'andina');
  assert.ok(order, 'One contextual acceptance must create the order');
  assert.equal(order.pricing.total, 9700);
  assert.equal(order.paymentMethod, 'cash');
  assert.deepEqual(order.items.map(i => [i.sku, i.quantity]).sort(), [['BOG-LAC-004', 1], ['BOG-SNA-064', 1]]);
  report.order = order;
  report.events = app.store.getState().events.filter(e => e.conversationId === conversation.id);
  assert.ok(!report.events.some(e => ['llm.plan.fallback', 'llm.reply.fallback', 'agent.error'].includes(e.type)), 'No fallback accepted as semantic success');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failures.push(error.stack); process.exitCode = 1;
} finally {
  global.fetch = fetchOriginal;
  report.after = await hashes();
  report.sourcesUnchanged = JSON.stringify(report.before) === JSON.stringify(report.after);
  if (!report.sourcesUnchanged) { report.status = 'failed'; report.failures.push('Sources changed'); process.exitCode = 1; }
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  app?.runtime.stop(); await app?.store.close?.();
  const target = path.resolve(temporary);
  assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('via-pareto-consent-'));
  await fs.rm(target, { recursive: true, force: true });
  console.log(JSON.stringify({ status: report.status, turns: report.turns.length, calls: report.calls.length,
    failures: report.failures.map(f => f.split('\n')[0]), evidence }));
}
