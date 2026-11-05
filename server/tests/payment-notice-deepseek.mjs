import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

assert.ok(process.env.DEEPSEEK_API_KEY && !process.env.LLM_SIMULATOR, 'Real DeepSeek required');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'via-payment-real-'));
const evidence = path.resolve('test-results/payment-notice', new Date().toISOString().replace(/[:.]/g, '-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(temporary, 'state.json'),
  whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true, llmResponseComposerEnabled: true });
const originalFetch = global.fetch, calls = [], reports = [];
global.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').origin);
  assert.ok(calls.length < 60, 'Call budget');
  const call = { at: new Date().toISOString() }, start = Date.now(); calls.push(call);
  const response = await originalFetch(url, options);
  const body = await response.clone().json().catch(() => ({}));
  Object.assign(call, { durationMs: Date.now() - start, status: response.status, usage: body.usage });
  return response;
};
const scenarios = [
  { id: 'declaracion_imagen_y_gracias', steps: [
    { text: 'Ya hice la transferencia y te mando comprobante', intent: 'payment_confirmation', notices: 1 },
    { text: '', messageType: 'image', mediaRef: 'real-fixture-receipt', intent: 'payment_confirmation', notices: 2 },
    { text: 'Listo, muchas gracias veci', intent: 'general_query', notices: 2 },
  ] },
  { id: 'recibo_despues_del_envio', dispatched: true, steps: [
    { text: 'Te envío el comprobante del pedido anterior, el que ya viene en camino.', messageType: 'image', mediaRef: 'real-fixture-closed', intent: 'payment_confirmation', notices: 1 },
  ] },
  { id: 'foto_producto', steps: [
    { text: 'Te mando foto de la bolsa de leche que busco. ¿Tienen esta?', messageType: 'image', mediaRef: 'real-fixture-product', notices: 0, product: true },
  ] },
  { id: 'imagen_sin_contexto', steps: [
    { text: '', messageType: 'image', mediaRef: 'real-fixture-unknown', intent: 'general_query', notices: 0 },
  ] },
];
try {
  app.store.mutate(s => { s.platformSettings.llm = { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    apiKeyRef: 'DEEPSEEK_API_KEY', baseUrlRef: 'DEEPSEEK_BASE_URL', simulator: null, temperature: 0, maxTokens: 1800, timeoutMs: 30000 }; });
  for (const [index, scenario] of scenarios.entries()) {
    const waId = `57300000200${index}`, report = { id: scenario.id, status: 'passed', turns: [] }; let c;
    try {
      if (scenario.dispatched) {
        const previous = await app.runtime.ensureConversation('andina', { waId, text: 'Pedido de prueba' });
        app.store.mutate(s => {
          Object.assign(previous, { orderId: 'known-dispatched', status: 'completed', caseStatus: 'completed', stage: 'closed' });
          (s.ordersByTenant.andina ??= []).push({ id: 'known-dispatched', tenantId: 'andina', customerWaId: waId,
            conversationId: previous.id, status: 'dispatched', paymentMethod: 'bre_b', subtotal: 10000 });
        });
      }
      for (const [i, step] of scenario.steps.entries()) {
        const result = await app.runtime.processInbound({ tenantId: 'andina', waId, messageId: `payment-real-${index}-${i}`,
          messageType: 'text', ...step });
        c = result.conversation;
        report.turns.push({ input: step, reply: c.messages.filter(m => m.role === 'assistant' || m.role === 'agent').at(-1)?.text,
          plan: c.reasoningPlan, notices: structuredClone(c.paymentNotices ?? []), status: c.status });
        assert.equal(c.reasoningPlan.executionMode, 'provider_api');
        if (step.intent) assert.equal(c.reasoningPlan.intent, step.intent);
        assert.equal(c.paymentNotices?.length ?? 0, step.notices);
        assert.ok(report.turns.at(-1).reply, 'Customer acknowledgment required');
        assert.ok(!c.orderId, 'Receipt/declaration must never create an order');
        if (!step.product) assert.ok(!app.store.getState().pendingRequests.some(p => p.conversationId === c.id));
        if (step.notices) assert.ok(c.paymentNotices.every(n => n.paymentVerified === false && n.informational));
        if (scenario.dispatched) {
          assert.equal(c.paymentNotices.at(-1).orderId, 'known-dispatched');
          assert.equal(app.orders.findOrder('known-dispatched', 'andina').status, 'dispatched');
        }
      }
      const events = app.store.getState().events.filter(e => e.conversationId === c.id);
      assert.ok(!events.some(e => ['llm.plan.fallback', 'llm.reply.fallback'].includes(e.type)), 'No fallback success');
      report.events = events;
    } catch (error) { report.status = 'failed'; report.error = error.stack; }
    reports.push(report); console.log(`${report.status.toUpperCase()} ${report.id}${report.error ? `: ${report.error.split('\n')[0]}` : ''}`);
  }
  const manualReport = { id: 'comprobante_durante_atencion_manual', status: 'passed' };
  try {
    const c = await app.runtime.ensureConversation('andina', { waId: '573000002099', text: 'Atención manual' });
    await app.runtime.activateManualWhatsApp(c.id);
    const r = await app.runtime.processInbound({ tenantId: 'andina', waId: c.waId, messageId: 'real-manual-receipt',
      messageType: 'image', mediaRef: 'real-fixture-manual', text: 'Este es el comprobante de la transferencia que hice' });
    manualReport.notices = r.conversation.paymentNotices;
    manualReport.events = app.store.getState().events.filter(e => e.conversationId === c.id);
    assert.equal(r.conversation.status, 'manual_active'); assert.equal(r.conversation.aiPaused, true);
    assert.equal(r.conversation.paymentNotices.length, 1);
    assert.ok(!r.conversation.messages.some(m => ['assistant', 'agent'].includes(m.role)));
    assert.ok(!manualReport.events.some(e => ['llm.plan.fallback', 'payment.notice.classification_failed'].includes(e.type)));
  } catch (error) { manualReport.status = 'failed'; manualReport.error = error.stack; }
  reports.push(manualReport); console.log(`${manualReport.status.toUpperCase()} ${manualReport.id}`);
  // Real interpretation of a store-configured custom method and contraentrega.
  for (const text of ['Lo pago en efectivo cuando me lo traigan', 'Con tarjeta débito al recibir', 'Voy a usar la billetera de la tienda, al recibirlo']) {
    const report = { id: text, status: 'passed' };
    try {
      app.store.mutate(s => { s.tenants.find(t => t.id === 'andina').config.orderPolicy.paymentMethods = [
        { id: 'cash', label: 'Efectivo' }, { id: 'card_terminal', label: 'Tarjeta' }, { id: 'store_wallet', label: 'Billetera de la tienda' }]; });
      const plan = await app.runtime.planner.plan({ tenantId: 'andina', conversationId: 'payment-preference',
        normalized: { text, messageType: 'text' }, conversation: { orderDraft: { items: [], paymentMethod: null },
          messages: [{ role: 'assistant', text: '¿Cómo prefieres pagar: Efectivo, Tarjeta o Billetera de la tienda?' }], pendingQuestion: { kind: 'payment' } } });
      report.plan = plan;
      assert.equal(plan.executionMode, 'provider_api'); assert.equal(plan.intent, 'order_clarification');
      assert.equal(plan.semanticFrame.customerDelta.paymentPreference, text.includes('efectivo') ? 'cash' : text.includes('débito') ? 'card_terminal' : 'store_wallet');
    } catch (error) { report.status = 'failed'; report.error = error.stack; }
    reports.push(report); console.log(`${report.status.toUpperCase()} ${report.id}`);
  }
} finally {
  await fs.mkdir(evidence, { recursive: true });
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ reports, calls }, null, 2));
  global.fetch = originalFetch; app.runtime.stop(); await app.store.close?.();
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir())); await fs.rm(temporary, { recursive: true, force: true });
  console.log(`Evidence: ${evidence}`);
}
assert.ok(reports.every(r => r.status === 'passed'), 'See payment evidence');
