import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAppAsync } from '../index.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';
import { amounts } from './helpers/businessOutcomeAssertions.js';

// Real interpreter, retrieval, resolver and composer. Only Meta/Google and the
// storage transport are local fixtures. PostgreSQL is tested separately.
assert.ok(process.env.DEEPSEEK_API_KEY && !process.env.LLM_SIMULATOR, 'Real DeepSeek credentials required');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'via-delivery-commerce-'));
const evidence = path.resolve('test-results/delivery-commerce', new Date().toISOString().replace(/[:.]/g, '-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(temporary, 'state.json'),
  whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true, llmGroundingTimeoutMs: 20000 });
const originalFetch = global.fetch;
const calls = [], reports = [];
global.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').origin, 'Only DeepSeek network access allowed');
  assert.ok(calls.length < Number(process.env.DELIVERY_MAX_CALLS ?? 180), 'Provider call budget');
  const call = { startedAt: new Date().toISOString() }; calls.push(call);
  const start = Date.now();
  const response = await originalFetch(url, options);
  call.durationMs = Date.now() - start; call.status = response.status;
  const result = await response.clone().json().catch(() => ({}));
  call.usage = result.usage ?? null;
  // Synthetic local scenarios only: retain model output to diagnose contract
  // rejection without storing request headers, credentials or private reasoning.
  call.output = result.choices?.[0]?.message?.content ?? null;
  return response;
};
const codeFiles = ['server/services/agentRuntime.js', 'server/services/llmPlanner.js', 'server/services/llmReplyComposer.js',
  'server/services/groundedDecisionAgent.js', 'server/services/conversationGroundingCoordinator.js', 'server/services/toolRegistry.js',
  'server/domain/deliveryPolicy.js', 'server/domain/paymentMethods.js'];
const hashes = async () => Object.fromEntries(await Promise.all(codeFiles.map(async f => [f, createHash('sha256').update(await fs.readFile(f)).digest('hex')])));
const startHashes = await hashes();
const basketText = 'Para domicilio, una Coca-Cola original de 1.5 litros y un Chocoramo de 65 gramos. Soy Ana Prueba, Calle 10 # 20-30.';
const scenarios = [
  { id: 'precio_domicilio_pago_texto', policy: { deliveryFee: 3000, deliveryMinimumSubtotal: 10000 }, steps: [
    `${basketText} Eso es todo.`,
    'Antes de seguir, ¿cuánto vale cada producto y cuánto cuesta el domicilio?',
    'Pago con tarjeta débito. No necesito nada más.',
    'Confirmo el pedido completo por 13000 pesos con el domicilio incluido.',
  ], verify(r, c) {
    const query = r.turns[1]; for (const n of [7200, 2800, 3000]) assert.ok(amounts(query.reply).includes(n), `Price answer must include ${n}`);
    assert.equal(r.turns[2].draft.paymentMethod, 'card_terminal');
    assert.ok(!r.turns[2].orderId, 'Choosing payment does not confirm');
    const order = app.orders.findOrder(c.orderId, 'andina'); assert.ok(order, 'Expected confirmed order');
    assert.equal(order.subtotal, 10000); assert.equal(order.pricing.deliveryFee, 3000); assert.equal(order.pricing.total, 13000);
  } },
  { id: 'minimo_y_adicion', policy: { deliveryFee: 3000, deliveryMinimumSubtotal: 15000 }, steps: [
    `${basketText} Quiero pagar en efectivo y todavía voy a agregar algo.`,
    '¿Cuánto me falta para el mínimo? ¿El envío cuenta para completarlo?',
    'Agrega dos Chocoramos más de 65 gramos, para que queden tres Chocoramos en total y la Coca-Cola que ya pedí. Eso es todo.',
    'Confirmo esos productos por 18600 pesos incluyendo el domicilio.',
  ], verify(r, c) {
    assert.equal(r.turns[0].draft.pricing.status, 'below_minimum');
    assert.equal(r.turns[0].draft.pricing.shortfall, 5000);
    assert.ok(!r.turns[0].confirmationOffered && !r.turns[1].confirmationOffered);
    assert.ok(amounts(r.turns[1].reply).includes(5000), 'Explain exact remaining product amount');
    const order = app.orders.findOrder(c.orderId, 'andina'); assert.ok(order, 'Expected completed enlarged order');
    assert.equal(order.subtotal, 15600); assert.equal(order.pricing.total, 18600);
    assert.equal(order.items.find(i => i.sku === 'BOG-PAN-019').quantity, 3);
  } },
  { id: 'excepcion_humana', policy: { deliveryFee: 3000, deliveryMinimumSubtotal: 15000 }, steps: [
    `${basketText} Pago en efectivo, por ahora no quiero más productos.`,
    'No puedo agregar nada más. Por favor consulta con la tienda si puede hacerme el domicilio así.',
    { human: { minimumException: true, deliveryFee: null, minimumSubtotal: null } },
    'Acepto la excepción de la tienda y confirmo mi pedido por 13000 pesos con domicilio.',
  ], verify(r, c) {
    const h = r.turns.find(t => t.human); assert.ok(h && !h.orderId, 'Human exception must only re-quote');
    const order = app.orders.findOrder(c.orderId, 'andina'); assert.ok(order, 'Buyer must be able to accept human exception');
    assert.equal(order.pricing.total, 13000); assert.equal(order.pricing.status, 'exception_approved');
    assert.ok(order.pricing.resolution.actorId && order.pricing.resolution.requestId);
  } },
  { id: 'condiciones_desconocidas', policy: { deliveryFee: null, deliveryMinimumSubtotal: null }, steps: [
    'Buenas, ¿cuánto cuesta el domicilio y cuál es el pedido mínimo?',
    `${basketText} Pago en efectivo. No voy a pedir nada más.`,
    'Entonces por favor que la tienda me confirme la tarifa y el mínimo antes de comprar.',
  ], verify(r, c) {
    assert.equal(c.orderDraft.pricing.status, 'configuration_incomplete'); assert.equal(c.orderDraft.pricing.total, null);
    assert.ok(r.turns.every(t => !t.orderId && !t.confirmationOffered));
    assert.ok(app.store.getState().pendingRequests.some(p => p.conversationId === c.id && p.action === 'delivery_policy_review'));
    assert.ok(!amounts(r.turns[0].reply).includes(0), 'Unknown delivery cannot be advertised as free');
  } },
  { id: 'pago_personalizado_no_admitido', policy: { deliveryFee: 0, deliveryMinimumSubtotal: 0,
    paymentMethods: [{ id: 'local_transfer', label: 'Transferencia Nequi', enabled: true }, { id: 'cash', label: 'Efectivo', enabled: true }] }, steps: [
    `${basketText} Pago con Nequi y eso es todo.`,
    '¿Mejor podría pagar con tarjeta de crédito?',
    'Entonces mantengamos Nequi, con transferencia. Eso es todo.',
    'Confirmo el pedido por 10000 pesos con domicilio gratis.',
  ], verify(r, c) {
    assert.equal(r.turns[0].draft.paymentMethod, 'local_transfer');
    assert.equal(r.turns[1].draft.paymentMethod, null, 'Unsupported change must not silently keep prior method');
    assert.ok(!r.turns[1].confirmationOffered);
    assert.equal(r.turns[2].draft.paymentMethod, 'local_transfer');
    const order = app.orders.findOrder(c.orderId, 'andina'); assert.ok(order); assert.equal(order.paymentMethod, 'local_transfer');
  } },
];
// The same business assertions run against alternate natural-language requests;
// these variations affect only the local buyer fixture, never production rules.
const languageVariant = Number(process.env.DELIVERY_LANGUAGE_VARIANT ?? 1);
assert.ok([1, 2, 3].includes(languageVariant), 'Supported language variants: 1, 2, 3');
const variations = {
  2: {
    precio_domicilio_pago_texto: { 1: 'Veci, antes del pago dime el valor de la gaseosa, el del ponqué y el envío por separado.', 2: 'Con débito, porfa. La lista queda así.' },
    minimo_y_adicion: { 1: '¿Cuánto tendría que sumar en productos para que me traigan eso? ¿Lo del envío ayuda a llegar al mínimo?', 2: 'Súmale otros dos Chocoramos de 65 g. Quedamos con tres y una Coca-Cola original de litro y medio. Ya no agrego más.' },
    excepcion_humana: { 1: 'Veci, no me alcanza para más productos. ¿Le preguntas al dueño si me puede enviar lo que llevo con una excepción?' },
    condiciones_desconocidas: { 2: 'Antes de aceptar, necesito que una persona de la tienda me aclare cuánto cobran por llevarlo y cuánto debo comprar.' },
    pago_personalizado_no_admitido: { 1: '¿Y si uso mi tarjeta de crédito en vez de Nequi?', 2: 'Bueno, sigo con la transferencia a Nequi; los productos quedan como están.' },
  },
  3: {
    precio_domicilio_pago_texto: { 1: 'Para revisar mi cuenta: ¿a cómo está cada uno y cuánto me cobran por traerlo?', 2: 'Lo voy a cancelar con tarjeta débito cuando llegue. No añadas más productos.' },
    minimo_y_adicion: { 1: 'Estoy corto para el domicilio, ¿de cuánto es la diferencia? ¿Se suma el transporte al mínimo o solo la compra?', 2: 'Entonces que sean tres Chocoramos de 65 gramos en total, son dos adicionales, y conserva la Coca-Cola original de 1.5 L. Cierro el pedido ahí.' },
    excepcion_humana: { 1: 'No deseo subir la compra. Prefiero que me atienda la tienda y autorice traerme estos productos aunque no alcancen el mínimo.' },
    condiciones_desconocidas: { 2: 'Que un encargado revise por favor la tarifa y el valor mínimo de compra; no voy a confirmar mientras eso esté pendiente.' },
    pago_personalizado_no_admitido: { 1: 'Me gustaría cambiar la transferencia por crédito, ¿reciben esa tarjeta?', 2: 'Me quedo pagando con Nequi. La compra ya está completa.' },
  },
};
for (const scenario of scenarios) {
  for (const [index, text] of Object.entries(variations[languageVariant]?.[scenario.id] ?? {})) scenario.steps[Number(index)] = text;
}
try {
  app.store.mutate(s => { s.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300);
    s.platformSettings.llm = { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat', apiKeyRef: 'DEEPSEEK_API_KEY',
      baseUrlRef: 'DEEPSEEK_BASE_URL', simulator: null, temperature: 0, maxTokens: 1600, timeoutMs: 15000 }; });
  const selected = (process.env.DELIVERY_CASE_IDS ?? '').split(',').filter(Boolean);
  for (const [index, scenario] of scenarios.entries()) {
    if (selected.length && !selected.includes(scenario.id)) continue;
    app.store.mutate(s => { const p = s.tenants.find(t => t.id === 'andina').config.orderPolicy;
      delete p.paymentMethods; Object.assign(p, scenario.policy); });
    const report = { id: scenario.id, languageVariant, policy: scenario.policy, status: 'passed', turns: [], failures: [] };
    const start = Date.now(); let c;
    try {
      for (const [turn, step] of scenario.steps.entries()) {
        const turnStarted = Date.now();
        const before = c?.messages?.length ?? 0;
        if (step.human) {
          const request = app.store.getState().pendingRequests.find(p => p.conversationId === c.id && p.action === 'delivery_policy_review' && p.status === 'pending');
          assert.ok(request, 'Expected structured delivery review');
          await app.runtime.resolveHumanRequest(request.id, { outcome: 'approved', note: 'Autorizo excepción para cliente cercano en esta canasta', approverId: 'fixture-owner', deliveryResolution: step.human });
          c = await app.runtime.getConversation(c.id);
        } else {
          const result = await app.runtime.processInbound({ tenantId: 'andina', waId: `57300888${String(index).padStart(4, '0')}`,
            messageId: `delivery-real-${index}-${turn}`, messageType: 'text', text: step }); c = result.conversation;
          assert.equal(c.reasoningPlan?.executionMode, 'provider_api', 'Real LLM interpreter must run');
        }
        const messages = (c.messages ?? []).slice(before).filter(m => ['assistant', 'agent'].includes(m.role));
        const draft = structuredClone(c.orderDraft ?? null);
        const confirmationOffered = c.pendingQuestion?.kind === 'confirmation';
        report.turns.push({ input: step, human: Boolean(step.human), reply: messages.map(m => m.text).join('\n'),
          draft, plan: structuredClone(c.reasoningPlan), durationMs: Date.now() - turnStarted,
          orderId: c.orderId ?? null, confirmationOffered });
        assert.ok(messages.length, 'Each turn must produce an answer');
        if (confirmationOffered) assert.ok(draft?.pricing?.canConfirm && !draft.missingFields?.length, 'Never offer invalid confirmation');
        if (typeof step === 'string' && !step.startsWith('Confirmo') && !step.startsWith('Acepto')) assert.ok(!c.orderId, 'No premature order');
      }
      scenario.verify(report, c);
    } catch (error) { report.status = 'failed'; report.failures.push(error.stack); }
    report.durationMs = Date.now() - start;
    report.events = app.store.getState().events.filter(e => e.conversationId === c?.id);
    const infrastructure = report.events.filter(e => ['llm.plan.fallback', 'llm.reply.fallback', 'catalog.grounding.rejected', 'agent.error'].includes(e.type));
    if (infrastructure.length) { report.status = 'failed'; report.failures.push(`Infrastructure/semantic fallback: ${JSON.stringify(infrastructure.map(e => ({ type: e.type, detail: e.detail })))}`); }
    reports.push(report);
    await fs.mkdir(evidence, { recursive: true });
    await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ startHashes, calls, reports }, null, 2));
    console.log(`${report.id}: ${report.status}; ${report.durationMs}ms; ${report.failures.map(f => f.split('\n')[0]).join('; ')}`);
  }
  const endHashes = await hashes(); assert.deepEqual(endHashes, startHashes, 'Code changed during campaign');
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify({ startHashes, endHashes, calls, reports }, null, 2));
  console.log(`Evidence: ${evidence}`);
  if (reports.some(r => r.status !== 'passed')) process.exitCode = 1;
} finally {
  global.fetch = originalFetch; app.runtime.stop(); await app.store.close?.();
  const target = path.resolve(temporary); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('via-delivery-commerce-'));
  await fs.rm(target, { recursive: true, force: true });
}
