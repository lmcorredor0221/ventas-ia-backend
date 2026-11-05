import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { orderDataRevision } from '../domain/orderDataAudit.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-audit-runtime-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(dir, 'state.json'),
  whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true, llmOrderAuditEnabled: true });
const originalFetch = global.fetch;
global.fetch = () => { throw new Error('Network disabled'); };
const product = { sku: 'SAL', name: 'Salchichón', price: 9000, stock: 40, active: true, allowsSaleByAmount: true };
let intent = 'delivery_order', items = [{ rawItemId: 'sal', catalogQuery: 'Salchichón', rawText: '5000 de salchichón', quantity: 2 }];
let delta = { name: 'Ana', address: 'Calle Uno 1', paymentPreference: 'cash' }, auditCalls = 0, stale = false;
try {
  app.store.mutate(s => { s.productsByTenant.andina = [product];
    Object.assign(s.tenants.find(t => t.id === 'andina').config.orderPolicy, { deliveryFee: 2000, deliveryMinimumSubtotal: 0 }); });
  app.runtime.planner = { async plan() { return { intent, semanticFrame: { items, delivery: true, customerDelta: delta, cartMutation: { mode: 'delta' }, collectionComplete: true },
    order: { delivery: true, items }, missingFields: [] }; }, async composeReply({ fallbackText }) { return { text: fallbackText }; } };
  app.runtime.grounding.agent = { async decide({ observations }) { return { nextAction: 'confirm_order',
    decisions: observations.map(o => ({ rawItemId: o.item.rawItemId, action: 'resolved', sku: 'SAL' })) }; } };
  app.runtime.orderAuditor.getContext = async () => ({ config: { provider: 'mock' } });
  app.runtime.orderAuditor.gateway = { async request({ prompt }) {
    auditCalls++; const input = JSON.parse(prompt.split('\n').at(-1));
    if (stale) await app.runtime.addMessage(input.messages[0].conversationId ?? currentId,
      { role: 'user', text: 'Mejor lo cambio', providerMessageId: 'new-concurrent' });
    return { plan: { purchaseIntent: 'purchase', verdict: 'correct', reason: 'Importe solicitado', corrections: [{ op: 'update_line',
      rawItemId: input.draft.items[0].rawItemId, changes: { saleMode: 'amount', requestedAmount: 5000, quantity: null },
      evidence: [{ messageId: input.messages[0].id, quote: '5000 de salchichón' }], reason: 'Compra por importe, no dos unidades' }] } };
  } };
  let currentId;
  const send = (text, id, waId = '573000099010') => app.runtime.processInbound({ tenantId: 'andina', waId, messageId: id, messageType: 'text', text });
  const r = await send('5000 de salchichón, para domicilio. Ana, Calle Uno 1, pago efectivo.', 'audit-one');
  const c = r.conversation; currentId = c.id;
  assert.equal(c.orderDraft.items[0].quantity, null); assert.equal(c.orderDraft.items[0].lineTotal, 5000);
  assert.equal(c.orderDraft.pricing.total, 7000); assert.equal(c.pendingQuestion.kind, 'confirmation');
  assert.equal(c.orderDraft.dataAudit.revision, orderDataRevision(c.orderDraft, app.store.getState().tenants.find(t => t.id === 'andina')));
  assert.ok(!c.orderId, 'Correction must precede consent');
  const payload = { delivery: true, pricing: c.orderDraft.pricing, subtotal: 5000,
    items: [{ sku: 'SAL', saleMode: 'amount', requestedAmount: 5000, quantity: null, unitPrice: 9000, allowsSaleByAmount: true, lineTotal: 5000 }] };
  app.store.mutate(s => { s.productsByTenant.andina[0].allowsSaleByAmount = false; });
  await assert.rejects(app.tools.validateOrderPricing('andina', c.id, payload), /autorización vigente/);
  await assert.rejects(app.tools.googleSheetsOrderWrite('andina', 'no-draft', { ...payload, delivery: false, pricing: undefined }), /cotización/);
  app.store.mutate(s => { s.productsByTenant.andina[0].allowsSaleByAmount = true; });
  intent = 'order_confirmation'; items = []; delta = {};
  const confirmed = await send('Confirmo el total de 7000', 'audit-two');
  assert.ok(confirmed.conversation.orderId); assert.equal(auditCalls, 1, 'No repeat audit for acceptance of unchanged data');
  const persisted = app.orders.findOrder(confirmed.conversation.orderId, 'andina');
  assert.equal(persisted.items[0].quantity, null); assert.equal(persisted.items[0].requestedAmount, 5000);
  assert.match(confirmed.conversation.messages.at(-1).text, /por valor/);
  // A new inbound arrives while the audit is running: its patch cannot be sent/applied.
  intent = 'delivery_order'; items = [{ rawItemId: 'sal-new', catalogQuery: 'Salchichón', productHypothesis: 'Salchichón', rawText: '5000 de salchichón', quantity: 2 }];
  delta = { name: 'Ana', address: 'Calle Uno 1', paymentPreference: 'cash' };
  const conv = await app.runtime.ensureConversation('andina', { waId: '573000099011', text: 'inicio' });
  currentId = conv.id; stale = true;
  const race = await send('5000 de salchichón, eso es todo', 'audit-race', '573000099011');
  assert.ok(!race.conversation.orderDraft); assert.ok(!race.conversation.messages.some(m => m.role === 'assistant'));
  stale = false;
  app.runtime.orderAuditor.gateway = { async request() { throw new Error('Injected provider timeout'); } };
  const blocked = await send('5000 de salchichón, eso es todo', 'audit-failure', '573000099012');
  assert.ok(!blocked.conversation.orderId); assert.equal(blocked.conversation.orderDraft.dataAudit, null);
  assert.notEqual(blocked.conversation.pendingQuestion?.kind, 'confirmation');
  assert.ok(app.store.getState().events.some(e => e.conversationId === blocked.conversation.id && e.type === 'order.data.audit.human_review'));
  console.log('PASS auditor runtime: repair before consent, persistence, forbidden sale, unchanged-confirmation reuse and stale audit discarded');
} finally { global.fetch = originalFetch; app.runtime.stop(); await app.store.close?.(); }
