import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { evaluateDeliveryPolicy } from '../domain/deliveryPolicy.js';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-delivery-runtime-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(dir, 'state.json'), whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true });
const failures = [];
const test = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.stack}`); } };
try {
  const product = { sku: 'DELIVERY-TEST', name: 'Pan de prueba', price: 10000, stock: 50, active: true, presentation: '1 paquete' };
  app.store.mutate(s => { s.productsByTenant.andina = [product]; const tenant = s.tenants.find(t => t.id === 'andina'); Object.assign(tenant.config.orderPolicy, { deliveryFee: 3000, deliveryMinimumSubtotal: 15000 }); });
  let intent = 'delivery_order', nextAction = 'invite_additions', frameItems = [{ rawItemId: 'line', rawText: 'un pan', productHypothesis: 'Pan de prueba', quantity: 1 }], customerDelta = { name: 'Cliente', address: 'Calle Prueba 1', paymentPreference: 'cash' };
  let lastReplyFacts;
  app.runtime.planner = { async plan() { return { intent, semanticFrame: { items: frameItems, delivery: true, customerDelta, cartMutation: { mode: 'delta' }, collectionComplete: true }, order: { delivery: true, items: frameItems }, missingFields: [] }; }, async composeReply({ fallbackText, facts }) { lastReplyFacts = facts; return { text: fallbackText }; } };
  app.runtime.grounding.agent = { async decide({ observations }) { return { nextAction, decisions: observations.map(({ item }) => ({ rawItemId: item.rawItemId, action: 'resolved', sku: product.sku })) }; } };
  let sequence = 0, conversation;
  const send = async text => { const r = await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001001', messageId: `delivery-${++sequence}`, messageType: 'text', text }); conversation = r.conversation; return conversation; };
  await test('Below minimum blocks confirmation without automatically escalating', async () => {
    await send('Un pan para domicilio, eso es todo');
    assert.ok(lastReplyFacts.requiredTerms.some(term => term.includes('Pan de prueba')));
    assert.equal(conversation.orderDraft.pricing.status, 'below_minimum');
    assert.equal(conversation.orderDraft.pricing.total, 13000);
    assert.ok(!conversation.orderId);
    assert.ok(!app.store.getState().pendingRequests.some(r => r.conversationId === conversation.id));
    assert.equal(await app.runtime.createConfirmationOffer({ tenantId: 'andina', conversationId: conversation.id, draftVersion: conversation.orderDraft.version }), null);
  });
  await test('LLM-requested review preserves basket and does not duplicate human tasks', async () => {
    frameItems = []; customerDelta = {}; intent = 'order_clarification'; nextAction = 'human_review';
    await send('No puedo agregar, que la tienda me ayude');
    await send('Por favor que lo revise la tienda');
    const requests = app.store.getState().pendingRequests.filter(r => r.conversationId === conversation.id && r.action === 'delivery_policy_review');
    assert.equal(requests.length, 1); assert.equal(requests[0].contextSnapshot.pricing.shortfall, 5000);
  });
  await test('Explicit human exception produces a new quote, never a confirmed order', async () => {
    const request = app.store.getState().pendingRequests.find(r => r.conversationId === conversation.id && r.action === 'delivery_policy_review');
    await assert.rejects(app.runtime.resolveHumanRequest(request.id, { outcome: 'approved', approverId: 'owner', note: 'Aprobado' }), /explícitamente/);
    nextAction = 'confirm_order';
    await app.runtime.resolveHumanRequest(request.id, { outcome: 'approved', approverId: 'owner', note: 'Cliente cercano; autorizo esta excepción', deliveryResolution: { minimumException: true, deliveryFee: null, minimumSubtotal: null } });
    conversation = await app.runtime.getConversation(conversation.id);
    assert.equal(conversation.orderDraft.pricing.status, 'exception_approved');
    assert.equal(conversation.orderDraft.pricing.total, 13000); assert.ok(!conversation.orderId);
    assert.equal(conversation.pendingQuestion.kind, 'confirmation');
    assert.deepEqual(lastReplyFacts.requiredTerms, [], 'An unchanged basket does not force repetition after review');
    await assert.rejects(app.runtime.resolveHumanRequest(request.id, { outcome: 'approved', approverId: 'owner', note: 'repetido' }), /atendida/);
  });
  await test('Changing policy invalidates an old quote and its exception', async () => {
    app.store.mutate(s => { const p = s.tenants.find(t => t.id === 'andina').config.orderPolicy; p.deliveryFee = 4000; p.deliveryMinimumSubtotal = 0; });
    intent = 'order_confirmation';
    await send('Confirmo');
    assert.ok(!conversation.orderId, 'Old consent cannot accept a changed total');
    assert.equal(conversation.orderDraft.pricing.total, 14000);
    assert.equal(conversation.orderDraft.pricing.resolution, null);
    await send('Acepto ahora el total de 14000');
    assert.ok(conversation.orderId);
    const order = app.orders.findOrder(conversation.orderId, 'andina');
    assert.equal(order.pricing.total, 14000); assert.equal(order.subtotal, 10000);
    assert.equal(order.items[0].presentation, '1 paquete');
    assert.match(conversation.messages.at(-1).text, /1 x Pan de prueba \(1 paquete\)/);
  });
  await test('Historical pending fields cannot conceal missing delivery configuration', async () => {
    const tenant = { id: 'x', config: { orderPolicy: {} } };
    assert.equal(evaluateDeliveryPolicy({ tenant, items: [{ quantity: 1, product }], delivery: true }).canConfirm, false);
  });
  await test('A policy update during composition discards the old quote before sending', async () => {
    let changed = false;
    app.runtime.planner.composeReply = async ({ fallbackText }) => {
      if (!changed) { changed = true; app.store.mutate(s => { s.tenants.find(t => t.id === 'andina').config.orderPolicy.deliveryFee = 6000; }); }
      return { text: fallbackText };
    };
    intent = 'delivery_order'; nextAction = 'confirm_order';
    frameItems = [{ rawItemId: null, rawText: 'un pan', productHypothesis: 'Pan de prueba', quantity: 1 }];
    customerDelta = { name: 'Cliente Dos', address: 'Calle Dos 2', paymentPreference: 'cash' };
    const result = await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001002', messageId: 'delivery-policy-race', messageType: 'text', text: 'Un pan, eso es todo' });
    assert.equal(result.conversation.orderDraft.pricing.total, 16000);
    assert.ok(!result.conversation.orderId);
    const replies = result.conversation.messages.filter(m => ['assistant', 'agent'].includes(m.role));
    assert.equal(replies.length, 1); assert.match(replies[0].text, /16\.000/);
    assert.ok(app.store.getState().events.some(e => e.conversationId === result.conversation.id && e.type === 'delivery.policy.quote_invalidated'));
  });
  await test('A rejected exception informs the buyer; concurrent resolution is rejected', async () => {
    app.store.mutate(s => { s.tenants.find(t => t.id === 'andina').config.orderPolicy.deliveryMinimumSubtotal = 15000; });
    nextAction = 'human_review';
    const result = await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001003', messageId: 'delivery-denial', messageType: 'text', text: 'Un pan y no puedo agregar más' });
    const request = app.store.getState().pendingRequests.find(r => r.conversationId === result.conversation.id && r.action === 'delivery_policy_review');
    const args = { outcome: 'denied', approverId: 'owner', note: 'No podemos hacer excepción para esta dirección' };
    const outcomes = await Promise.allSettled([app.runtime.resolveHumanRequest(request.id, args), app.runtime.resolveHumanRequest(request.id, args)]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(o => o.status === 'rejected').reason.statusCode, 409);
    const after = await app.runtime.getConversation(result.conversation.id);
    assert.ok(!after.orderId); assert.equal(after.deliveryResolution, null);
    assert.match(after.messages.at(-1).text, /no autorizó/);
    assert.equal(app.store.getState().pendingRequests.find(r => r.id === request.id).status, 'denied');
  });
  await test('A general query is not rejected for omitting the assistant introduction', async () => {
    app.store.mutate(s => { s.tenants.find(t => t.id === 'andina').config.agentPolicy.assistantName = 'Rocío'; });
    let composedFacts;
    app.runtime.planner.composeReply = async ({ facts }) => { composedFacts = facts; return { text: 'La tienda puede ayudarte con esa consulta.' }; };
    intent = 'general_query'; frameItems = []; customerDelta = {};
    await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001004', messageId: 'general-query', messageType: 'text', text: '¿Cuál es la tarifa de entrega?' });
    assert.deepEqual(composedFacts.requiredTerms, []);
    intent = 'greeting';
    await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001005', messageId: 'greeting', messageType: 'text', text: 'Buenas' });
    assert.deepEqual(composedFacts.requiredTerms, ['Rocío']);
  });
  await test('An incomplete basket escalates as product help, not a delivery exception', async () => {
    app.runtime.planner.composeReply = async ({ fallbackText }) => ({ text: fallbackText });
    intent = 'delivery_order'; nextAction = 'ask_clarification';
    frameItems = [{ rawItemId: 'incomplete', rawText: 'pan', productHypothesis: product.name, quantity: null }];
    customerDelta = { name: 'Cliente Tres', address: 'Calle Tres', paymentPreference: 'cash' };
    const waId = '573000001006';
    const first = await app.runtime.processInbound({ tenantId: 'andina', waId, messageId: 'incomplete-basket', messageType: 'text', text: 'Quiero pan a domicilio' });
    assert.equal(first.conversation.orderDraft.pricing.status, 'basket_incomplete');
    intent = 'human_handoff'; frameItems = []; customerDelta = {};
    await app.runtime.processInbound({ tenantId: 'andina', waId, messageId: 'incomplete-help', messageType: 'text', text: 'Prefiero que la tienda me ayude a elegir' });
    const tasks = app.store.getState().pendingRequests.filter(r => r.conversationId === first.conversation.id);
    assert.ok(tasks.length > 0);
    assert.ok(tasks.every(r => r.action !== 'delivery_policy_review'));
  });
  await test('A committed order without delivery does not invent an explicit pickup choice', async () => {
    const id = 'no-delivery-choice';
    const items = [{ rawItemId: 'bread', quantity: 1, product, lineTotal: 10000 }];
    const tenant = app.store.getState().tenants.find(t => t.id === 'andina');
    const pricing = evaluateDeliveryPolicy({ tenant, items, delivery: false, draftVersion: 1 });
    app.store.mutate(s => s.conversations.push({ id, tenantId: 'andina', waId: '573000001007', messages: [],
      pendingQuestion: { kind: 'confirmation' }, orderDraft: { version: 1, items, delivery: false,
        customerName: 'Cliente', paymentMethod: 'cash', subtotal: 10000, pricing, missingFields: [] } }));
    await app.runtime.handleOrderConfirmation({ tenantId: 'andina', conversationId: id,
      normalized: { waId: '573000001007', text: 'Confirmo', messageType: 'text' },
      plan: { intent: 'order_confirmation', semanticFrame: { items: [] } }, customerProfile: {} });
    const saved = await app.runtime.getConversation(id);
    assert.ok(saved.orderId);
    assert.doesNotMatch(saved.messages.at(-1).text, /retiro en tienda|para recoger/i);
    assert.match(saved.messages.at(-1).text, /No incluye servicio de domicilio/);
    const task = app.store.getState().pendingRequests.find(r => r.conversationId === id);
    assert.doesNotMatch(task.contextSnapshot.summary, /retiro en tienda|para recoger/i);
  });
  await test('Contextual acceptance of a communicated complete quote does not ask for acceptance twice', async () => {
    app.store.mutate(s => Object.assign(s.tenants.find(t => t.id === 'andina').config.orderPolicy,
      { deliveryMinimumSubtotal: 0, deliveryFee: 3000 }));
    intent = 'delivery_order'; nextAction = 'answer_question';
    frameItems = [{ rawItemId: 'bread', rawText: 'un pan', productHypothesis: product.name, quantity: 1 }];
    customerDelta = { name: 'Cliente', address: 'Calle Prueba 8', paymentPreference: 'cash' };
    app.runtime.planner.composeReply = async () => ({ text: 'Subtotal de productos: $ 10.000. Domicilio: $ 3.000. Total: $ 13.000. ¿Algo más?' });
    const input = { tenantId: 'andina', waId: '573000001008', messageType: 'text' };
    const quoted = await app.runtime.processInbound({ ...input, messageId: 'quote-before-accept', text: 'Un pan, ¿cuánto queda con domicilio?' });
    assert.equal(quoted.conversation.pendingQuestion.kind, 'customer_question');
    assert.ok(!quoted.conversation.orderId);
    intent = 'order_confirmation'; frameItems = []; customerDelta = {};
    const accepted = await app.runtime.processInbound({ ...input, messageId: 'accept-complete-quote', text: 'Sí, acepto ese pedido y ese total' });
    assert.ok(accepted.conversation.orderId, 'The LLM acceptance is sufficient for the unchanged, communicated quote');
    assert.equal(app.orders.findOrder(accepted.conversation.orderId, 'andina').pricing.total, 13000);
  });
  await test('A partial answer does not authorize confirmation of an unseen complete quote', async () => {
    intent = 'delivery_order'; nextAction = 'answer_question';
    frameItems = [{ rawItemId: 'bread', rawText: 'un pan', productHypothesis: product.name, quantity: 1 }];
    customerDelta = { name: 'Cliente', address: 'Calle Prueba 9', paymentPreference: 'cash' };
    app.runtime.planner.composeReply = async () => ({ text: 'Subtotal de productos: $ 10.000.' });
    const input = { tenantId: 'andina', waId: '573000001009', messageType: 'text' };
    const quoted = await app.runtime.processInbound({ ...input, messageId: 'partial-quote', text: 'Un pan para domicilio' });
    assert.ok(!quoted.conversation.communicatedQuote);
    intent = 'order_confirmation'; frameItems = []; customerDelta = {}; nextAction = 'confirm_order';
    const accepted = await app.runtime.processInbound({ ...input, messageId: 'accept-partial', text: 'Sí, confirmo' });
    assert.ok(!accepted.conversation.orderId, 'First communicate fee and total');
  });
  await test('A suppressed price answer is never recorded as a communicated quote', async () => {
    intent = 'delivery_order'; nextAction = 'answer_question';
    frameItems = [{ rawItemId: 'bread', rawText: 'un pan', productHypothesis: product.name, quantity: 1 }];
    customerDelta = { name: 'Cliente', address: 'Calle Prueba 10', paymentPreference: 'cash' };
    app.runtime.planner.composeReply = async () => ({ text: 'Subtotal de productos: $ 10.000. Domicilio: $ 3.000. Total: $ 13.000.' });
    const send = app.runtime.sendCustomerMessage;
    app.runtime.sendCustomerMessage = async () => ({ suppressed: true, reason: 'newer_inbound_message' });
    try {
      const result = await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001010',
        messageId: 'suppressed-quote', messageType: 'text', text: 'Un pan para domicilio' });
      assert.ok(!result.conversation.communicatedQuote);
    } finally { app.runtime.sendCustomerMessage = send; }
  });
  await test('A communicated quote cannot authorize a later tariff change', async () => {
    intent = 'delivery_order'; nextAction = 'answer_question';
    frameItems = [{ rawItemId: 'bread', rawText: 'un pan', productHypothesis: product.name, quantity: 1 }];
    customerDelta = { name: 'Cliente', address: 'Calle Prueba 11', paymentPreference: 'cash' };
    const input = { tenantId: 'andina', waId: '573000001011', messageType: 'text' };
    const quoted = await app.runtime.processInbound({ ...input, messageId: 'communicated-old-tariff', text: 'Un pan para domicilio' });
    assert.ok(quoted.conversation.communicatedQuote);
    app.store.mutate(s => { s.tenants.find(t => t.id === 'andina').config.orderPolicy.deliveryFee = 4000; });
    intent = 'order_confirmation'; frameItems = []; customerDelta = {}; nextAction = 'confirm_order';
    app.runtime.planner.composeReply = async ({ fallbackText }) => ({ text: fallbackText });
    const result = await app.runtime.processInbound({ ...input, messageId: 'accept-old-tariff', text: 'Acepto ese total' });
    assert.ok(!result.conversation.orderId);
    assert.equal(result.conversation.orderDraft.pricing.total, 14000);
  });
} finally { app.runtime.stop(); await app.store.close?.(); await fs.rm(dir, { recursive: true, force: true }); }
assert.deepEqual(failures, []);
