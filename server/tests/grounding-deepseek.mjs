import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

// Real linguistic/grounding integration. Meta is mocked; the separate 40-case
// runner exercises signed webhooks, PostgreSQL and the outbox with Graph capture.
assert.ok(process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required, no simulated fallback');
assert.ok(!process.env.LLM_SIMULATOR, 'Remove LLM_SIMULATOR');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-grounding-real-'));
const evidenceDir = path.resolve('test-results/grounding-semantic', new Date().toISOString().replace(/[:.]/g, '-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(dir, 'state.json'),
  whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true, llmGroundingTimeoutMs: 20000 });
const reports = [];
const originalFetch = global.fetch;
let requests = 0;
global.fetch = async (url, options) => {
  assert.equal(new URL(url).origin, new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').origin, 'Only DeepSeek may leave this test');
  assert.ok(++requests <= 90, 'DeepSeek request budget');
  return originalFetch(url, options);
};
const candidates = (conversation) => (conversation.catalogGrounding?.resolutions ?? [])
  .flatMap((resolution) => resolution.product ? [resolution.product] : resolution.options.map((option) => option.product));
const draftSkus = (conversation) => (conversation.orderDraft?.items ?? []).map((item) => item.product?.sku).filter(Boolean);
const scenarios = [
  { id: 'saludo', steps: ['Hola veci, buenas tardes'], check: (c, events) => {
    assert.equal(c.reasoningPlan.intent, 'greeting');
    assert.ok(!events.some((e) => e.type === 'catalog.grounding.started'));
  } },
  { id: 'coca_medida', steps: ['¿Tienes Coca Cola litro y medio?'], check: (c) => {
    const rows = candidates(c); assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => ['BOG-BEB-044', 'COL-102'].includes(r.sku)), 'Only requested size and brand');
  } },
  { id: 'ramo_tradicional', steps: ['¿Tienes Pon que Ramo tradicional?'], check: (c) => {
    const rows = candidates(c);
    assert.ok(rows.length > 0 || c.status === 'blocked', 'Clarify or escalate, never assert unrelated product');
    assert.ok(rows.every((r) => /ramo/i.test(`${r.brand} ${r.name}`)));
    assert.ok(!c.orderId);
  } },
  { id: 'brownie_ausente', steps: ['Me regalas un Browine Mamai de arequipe'], check: (c, events) => {
    assert.ok(!draftSkus(c).length, 'No substitute by shared word arequipe');
    assert.equal(c.status, 'blocked');
    assert.ok(events.some((e) => e.type === 'catalog.grounding.observed'), 'Absence must be grounded in a search');
  } },
  { id: 'atributo', steps: ['¿Tienes un vaso de acabado iridiscente?'], check: (c) => {
    assert.deepEqual(candidates(c).map((r) => r.sku), ['ATTR']);
  } },
  { id: 'memoria_adicion_retiro', steps: [
    'Quiero una Coca-Cola original de 1.5 L para domicilio, todavía voy a agregar más.',
    'Agrega también un Chocoramo de 65 gramos.',
    'Quita la gaseosa, deja solo el Chocoramo. Ya no quiero agregar más.',
  ], check: (c, events, turns) => {
    assert.ok(draftSkus(turns[1].conversation).includes('BOG-BEB-044'), 'Preserve prior product');
    assert.ok(draftSkus(turns[1].conversation).includes('BOG-PAN-019'), 'Add new product');
    assert.deepEqual(draftSkus(c), ['BOG-PAN-019'], 'Remove only requested product');
    assert.equal(c.orderDraft.subtotal, 2800);
  } },
  { id: 'datos_y_confirmacion', steps: [
    'Para domicilio: un Chocoramo de 65 gramos. Eso es todo.',
    'Soy Ana Prueba, dirección Calle 10 # 20-30. Pago en efectivo. Eso es todo.',
    'Sí, confirmo ese pedido.',
  ], check: (c) => {
    assert.ok(c.orderId, 'Confirmed order must be persisted');
    const order = app.orders.findOrder(c.orderId, 'andina');
    assert.equal(order.subtotal, 2800);
    assert.equal(c.orderDraft.customerName, 'Ana Prueba');
    assert.ok(c.orderDraft.deliveryAddress.includes('20-30'));
  } },
  { id: 'datos_sin_repetir_invitacion', steps: [
    'Me regalas 2 arepas boyacenses pa domicilio',
    'Soy Laura Prueba, dirección Carrera 7 # 20-10',
  ], check: (c, events, turns) => {
    for (const turn of turns) {
      const draft = turn.conversation.orderDraft;
      assert.ok(!turn.conversation.orderId, 'Two arepas never authorize two five-unit packages');
      assert.ok((draft?.items ?? []).some((item) => !item.product || item.resolution?.status !== 'resolved')
        || (draft?.missingFields ?? []).some((field) => /quantity|presentation/.test(field)), 'Unit of sale must remain unresolved until the buyer clarifies packages');
    }
    assert.equal(c.orderDraft.customerName, 'Laura Prueba');
    assert.ok(c.orderDraft.deliveryAddress.includes('20-10'));
    assert.ok(app.store.getState().customerProfilesByTenant.andina[c.waId]);
    const messages = c.messages.filter((m) => ['assistant', 'agent'].includes(m.role));
    assert.ok(messages.length >= 2);
    assert.notEqual(messages.at(-1).text, messages.at(-2).text, 'Do not replay the same invitation after customer data');
    assert.deepEqual(draftSkus(c), draftSkus(turns[0].conversation), 'Customer data must not change products');
  } },
  { id: 'hipotesis_contra_catalogo', steps: ['Veci, tiene savital en sobrecito?'], check: (c) => {
    const rows = candidates(c);
    assert.ok(rows.length > 0, 'Actual brand and sachet must override an unsupported inferred category');
    assert.ok(rows.every((r) => /savital/i.test(`${r.brand} ${r.name}`)));
    assert.ok(rows.some((r) => /shampoo|acondicionador/i.test(r.name)));
    assert.notEqual(c.status, 'blocked');
  } },
  { id: 'empaque_no_es_cantidad', steps: ['Necesito arroz, aceite y huevos AA x12'], check: (c) => {
    assert.equal(c.orderDraft.items.length, 3);
    assert.ok(c.orderDraft.items.every((item) => item.quantity === null), 'Do not invent a package quantity');
    assert.ok(!c.orderId);
  } },
];
try {
  app.store.mutate((state) => {
    state.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300);
    state.productsByTenant.andina.push({ sku: 'ATTR', name: 'Vaso Prisma', category: 'Hogar', price: 5000, stock: 4,
      active: true, presentation: '1 und', attributes: { acabado: 'iridiscente' } });
    state.platformSettings.llm = { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      apiKeyRef: 'DEEPSEEK_API_KEY', baseUrlRef: 'DEEPSEEK_BASE_URL', simulator: null, temperature: 0, maxTokens: 1600, timeoutMs: 15000 };
  });
  const selectedIds = (process.env.GROUNDING_CASE_IDS ?? '').split(',').filter(Boolean);
  assert.ok(selectedIds.every((id) => scenarios.some((scenario) => scenario.id === id)), 'Unknown GROUNDING_CASE_IDS');
  for (const [index, scenario] of scenarios.entries()) {
    if (selectedIds.length && !selectedIds.includes(scenario.id)) continue;
    const report = { id: scenario.id, status: 'passed', turns: [], failures: [] };
    let conversation;
    const started = Date.now();
    try {
      for (const [turnIndex, text] of scenario.steps.entries()) {
        const result = await app.runtime.processInbound({ tenantId: 'andina', waId: `57300008${String(index).padStart(4, '0')}`,
          messageId: `semantic-${scenario.id}-${turnIndex}`, messageType: 'text', text });
        conversation = result.conversation;
        report.turns.push({ text, conversation: structuredClone(conversation) });
        assert.equal(conversation.reasoningPlan.executionMode, 'provider_api');
      }
      const events = app.store.getState().events.filter((e) => e.conversationId === conversation.id);
      scenario.check(conversation, events, report.turns);
      assert.ok(!events.some((e) => e.type === 'llm.plan.fallback' || e.type === 'catalog.grounding.rejected'), 'No provider/guard fallback');
    } catch (error) { report.status = 'failed'; report.failures.push(error.message); }
    report.durationMs = Date.now() - started;
    report.events = app.store.getState().events.filter((e) => e.conversationId === conversation?.id);
    reports.push(report);
    console.log(`${report.id}: ${report.status} ${report.failures.join('; ')}`);
  }
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, 'report.json'), JSON.stringify({ requests, reports }, null, 2));
  console.log(`Evidence: ${evidenceDir}`);
  if (reports.some((r) => r.status !== 'passed')) process.exitCode = 1;
} finally {
  global.fetch = originalFetch;
  app.runtime.stop(); await app.store.close?.();
  await fs.rm(dir, { recursive: true, force: true });
}
