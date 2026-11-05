import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OrderDataAuditor } from '../services/orderDataAuditor.js';
import { LlmReplyComposer } from '../services/llmReplyComposer.js';
import { createAppAsync } from '../index.js';
import { validateGroundingDecision } from '../domain/groundingContracts.js';

// Boundary regressions from cases 29/33/50. Real contextual inference is
// verified separately with DeepSeek; these doubles inspect evidence/transport.
const failures = [];
const test = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.stack}`); } };
const originalFetch = global.fetch;
global.fetch = () => { throw new Error('Network disabled in contract regression'); };
const product = { sku: 'YOG150', name: 'Yogurt fresa', presentation: '150 g', price: 2900, stock: 10, active: true };
const tenant = { id: 'andina', config: { orderPolicy: { deliveryFee: 2500, deliveryMinimumSubtotal: 0 } } };
const selection = { action: 'select_product_variant', value: product.sku, rawItemId: 'yog', product: { sku: product.sku, name: product.name, presentation: product.presentation } };
await test('Auditor retains server-validated selection and full variant behind truncated title', async () => {
  let input;
  const auditor = new OrderDataAuditor({ getContext: async () => ({ config: {} }), config: {}, events: { emit() {} },
    gateway: { async request({ prompt }) { input = JSON.parse(prompt.split('\n').at(-1));
      return { plan: { purchaseIntent: 'purchase', verdict: 'approve', corrections: [], reason: 'Selected 150 g' } }; } } });
  await auditor.audit({ tenant, conversation: { messages: [{ id: 'm1', role: 'user', text: 'Yogurt fresa', messageType: 'interactive', validatedSelection: selection }] },
    draft: { items: [{ rawItemId: 'yog', product, quantity: 1 }], delivery: true }, catalog: [{ ...product, tenantId: tenant.id }], paymentMethods: [] });
  assert.deepEqual(input.messages[0].validatedSelection, selection);
  assert.equal(input.messages[0].messageType, 'interactive');
});
await test('Pickup zero charge is not evidence that the store offers free delivery', async () => {
  let input;
  const composer = new LlmReplyComposer({ config: { llmGroundingEnabled: true, llmResponseComposerEnabled: true },
    store: { getState: () => ({ platformSettings: { llm: { provider: 'deepseek', simulator: null } } }) },
    getTenant: async () => tenant, events: { emit() {} }, gateway: { async request({ prompt }) {
      if (prompt.startsWith('Revisa una respuesta')) return { plan: { decision: 'supported', reason: 'Tarifa informativa, no cargo de recogida.' } };
      input = JSON.parse(prompt.split('\n').at(-1));
      return { plan: { reply: 'La tarifa para solicitar entrega es {{commercial:deliveryPolicy.deliveryFee}}. ¿Quieres domicilio?',
        commercialClaims: [{ field: 'deliveryPolicy.deliveryFee', amount: 2500 }], requestsConfirmation: false } };
    } } });
  const response = await composer.composeReply({ tenantId: tenant.id, conversationId: 'c', facts: { kind: 'order_quote',
    nextAction: 'answer_question', canConfirm: false, subtotal: 2900,
    pricing: { delivery: false, status: 'not_applicable', deliveryFee: 0, minimumSubtotal: 0, total: 2900, canConfirm: true },
    deliveryPolicy: { deliveryFee: 2500, deliveryMinimumSubtotal: 0 } }, fallbackText: '' });
  assert.ok(!input.commercialFacts.some(f => f.field === 'pricing.deliveryFee'));
  assert.equal(input.commercialFacts.find(f => f.field === 'deliveryPolicy.deliveryFee')?.amount, 2500);
  assert.equal(response.executionMode, 'provider_api');
  assert.match(response.text, /2\.500/);
});
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-audit-coherence-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(dir, 'state.json'), whatsappMode: 'mock',
  backgroundWorkersEnabled: false, llmGroundingEnabled: true, llmOrderAuditEnabled: true });
try {
  app.store.mutate(s => { s.productsByTenant.andina = [product];
    Object.assign(s.tenants.find(t => t.id === tenant.id).config.orderPolicy, tenant.config.orderPolicy); });
  let capturedFacts, payment = null, auditCalls = 0;
  app.runtime.planner = { async plan() { return { intent: 'delivery_order',
    semanticFrame: { items: [{ rawItemId: 'yog', catalogQuery: 'Yogurt fresa', rawText: 'Un yogurt', productHypothesis: 'Yogurt fresa', quantity: 1 }], delivery: true,
      customerDelta: { name: 'Ana', address: 'Calle 1', paymentPreference: payment }, cartMutation: { mode: 'delta' }, collectionComplete: true },
    order: { delivery: true, items: [{ rawItemId: 'yog', catalogQuery: 'Yogurt fresa', rawText: 'Un yogurt', productHypothesis: 'Yogurt fresa', quantity: 1 }] }, missingFields: [] }; },
    async composeReply({ facts }) { capturedFacts = facts; return { text: '¿Deseas la presentación individual o la grande?' }; } };
  app.runtime.grounding.agent = { async decide({ observations }) { return { nextAction: 'continue_order',
    decisions: observations.map(o => ({ rawItemId: o.item.rawItemId, action: 'resolved', sku: product.sku })) }; } };
  app.runtime.orderAuditor.audit = async ({ draft }) => { auditCalls++; return { draft, verdict: 'clarify', reason: 'Aclarar la presentación', corrections: [] }; };
  await test('Do not audit an incomplete summary before collecting payment', async () => {
    await app.runtime.processInbound({ tenantId: tenant.id, waId: '573000099209', messageId: 'audit-not-ready', messageType: 'text', text: 'Un yogurt, Ana, Calle 1, eso es todo.' });
    assert.equal(auditCalls, 0);
    assert.deepEqual(capturedFacts.missingFields, ['payment_method']);
    assert.equal(capturedFacts.replyInteraction.kind, 'payment_method');
  });
  await test('Audit clarification cannot attach payment buttons or ask for unrelated customer fields', async () => {
    payment = 'cash';
    const result = await app.runtime.processInbound({ tenantId: tenant.id, waId: '573000099210', messageId: 'audit-clarify', messageType: 'text', text: 'Un yogurt, Ana, Calle 1, eso es todo.' });
    assert.deepEqual(capturedFacts.missingFields, ['order_data_review']);
    assert.equal(capturedFacts.replyInteraction.kind, 'none');
    assert.ok(!app.store.getState().interactionOffers?.some(o => o.conversationId === result.conversation.id && o.purpose === 'payment_method'));
    assert.notEqual(result.conversation.pendingQuestion?.kind, 'confirmation');
  });
  await test('Unauthorized amount sale retains chosen identity but cannot confirm it', async () => {
    const result = validateGroundingDecision({ action: 'resolved', sku: product.sku },
      { item: { rawItemId: 'yog', saleMode: 'amount', requestedAmount: 5000, quantity: null }, rows: [product], tenantId: tenant.id });
    assert.equal(result.status, 'human_review'); assert.equal(result.reason, 'amount_sale_not_authorized');
    assert.equal(result.product.sku, product.sku);
    assert.equal(validateGroundingDecision({ action: 'resolved', sku: product.sku },
      { item: { saleMode: 'amount', requestedAmount: 5000 }, rows: [{ ...product, tenantId: 'foreign' }], tenantId: tenant.id }).product, undefined);
  });
  await test('Validated choice survives to later turns, with provenance linked to inbound message', async () => {
    const c = await app.runtime.ensureConversation(tenant.id, { waId: '573000099211', text: 'inicio' });
    await app.runtime.addMessage(c.id, { role: 'user', text: 'Yogurt fresa', messageType: 'interactive', providerMessageId: 'choice-1' });
    const original = app.runtime.handleDeliveryOrder;
    app.runtime.handleDeliveryOrder = async () => ({});
    try { await app.runtime.continueGroundedSelection({ tenantId: tenant.id, conversationId: c.id,
      normalized: { messageId: 'choice-1', waId: '573000099211' }, interaction: { ...selection, product } }); }
    finally { app.runtime.handleDeliveryOrder = original; }
    const stored = await app.runtime.getConversation(c.id);
    assert.equal(stored.messages[0].validatedSelection?.value, product.sku);
    assert.equal(stored.messages[0].validatedSelection?.product.presentation, '150 g');
  });
} finally { app.runtime.stop(); await app.store.close?.(); global.fetch = originalFetch; }
if (failures.length) process.exitCode = 1;
