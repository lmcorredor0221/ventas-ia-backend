import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { semanticFrameFromPlan } from '../domain/semanticContracts.js';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-pareto-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(dir, 'state.json'),
  whatsappMode: 'mock', backgroundWorkersEnabled: false, authRequired: false, csrfRequired: false,
  llmGroundingEnabled: true });
const failures = [];
let seq = 0;
const conversation = () => {
  const c = { id: `pareto-${++seq}`, tenantId: 'andina', waId: `57300000${seq}`, messages: [], status: 'live' };
  app.store.mutate(s => s.conversations.push(c)); return c;
};
async function test(name, run) { try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); } }
try {
  await test('A later human request retains the earlier photo without treating it as payment', async () => {
    const c = conversation();
    app.store.mutate(s => {
      s.conversations.find(x => x.id === c.id).messages.push({ role: 'customer', messageType: 'image', mediaRef: 'earlier-photo', providerMessageId: 'photo-1' });
      s.conversations.push({ id: c.id, tenantId: 'other', messages: [{ mediaRef: 'other-tenant-photo' }] });
    });
    const a = await app.tools.humanHandoff('andina', c.id, { context_snapshot: { normalized: { messageType: 'text', text: 'Que revisen esa foto', mediaRef: null } } });
    await app.tools.humanHandoff('andina', c.id, { context_snapshot: { normalized: { messageType: 'text', text: 'Gracias', mediaRef: null } } });
    const task = app.store.getState().pendingRequests.find(r => r.id === a.handoff_id);
    assert.deepEqual(task.contextSnapshot.attachments, [{ mediaRef: 'earlier-photo', messageType: 'image', providerMessageId: 'photo-1' }]);
    assert.equal(task.contextSnapshot.normalized.text, 'Gracias');
    assert.equal(app.store.getState().paymentNotices?.filter(n => n.conversationId === c.id).length ?? 0, 0);
  });
  await test('The contextual frame preserves closure and missing search scope decided by the LLM', async () => {
    assert.equal(semanticFrameFromPlan({ intent: 'general_query', conversationAct: 'close' }).conversationAct, 'close');
    assert.equal(semanticFrameFromPlan({ intent: 'catalog_query', catalogSearchReady: false }).catalogSearchReady, false);
  });
  await test('Missing search scope asks a contextual clarification without tools or handoff', async () => {
    const c = conversation(); let searches = 0, composerFacts;
    app.runtime.grounding = { async resolve() { searches++; throw new Error('No search subject yet'); } };
    app.runtime.planner = { async composeReply({facts, fallbackText}) { composerFacts = facts; return {text: fallbackText}; } };
    await app.runtime.handleGroundedCatalogQuery({ tenantId: 'andina', conversationId: c.id, normalized: { text: '¿Qué sabores tienen?', waId: c.waId },
      plan: { intent: 'catalog_query', order: { items: [{ rawText: 'sabores' }] }, semanticFrame: { catalogSearchReady: false, proposedAction: 'ask_clarification', ambiguities: [{ detail: 'Falta producto o categoría' }] } } });
    assert.equal(searches, 0); assert.equal(composerFacts.contextualDecision.proposedAction, 'ask_clarification');
    assert.equal(app.store.getState().pendingRequests.filter(r => r.conversationId === c.id).length, 0);
  });
  await test('Closing a query keeps the open human workflow and task identity', async () => {
    const c = conversation(); const task = await app.tools.humanHandoff('andina', c.id, { reason: 'Consulta pendiente' });
    app.runtime.planner = { async composeReply({fallbackText}) { return {text: fallbackText}; } };
    await app.runtime.handleContextualConversation({ tenantId: 'andina', conversationId: c.id, normalized: {text: 'Gracias', waId: c.waId}, plan: {intent:'general_query',semanticFrame:{conversationAct:'close'}} });
    const saved = await app.runtime.getConversation(c.id);
    assert.equal(saved.zone, 'approval'); assert.equal(saved.status, 'blocked');
    assert.match(saved.nextStep, /checkpoint/);
    assert.equal(app.store.getState().pendingRequests.find(r => r.id === task.handoff_id).status, 'pending');
  });
  await test('Same unresolved need updates one human task despite different titles', async () => {
    const c = conversation();
    const a = await app.tools.humanHandoff('andina', c.id, { reason: 'No se encontró producto', context_snapshot: { summary: 'Buscaba salmón', items: ['salmon'] } });
    const b = await app.tools.humanHandoff('andina', c.id, { reason: 'Quiere asesor', context_snapshot: { summary: 'Quiere ayuda con ese producto', normalized: { mediaRef: 'foto' } } });
    assert.equal(a.handoff_id, b.handoff_id);
    const tasks = app.store.getState().pendingRequests.filter(r => r.conversationId === c.id);
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0].contextSnapshot.items, ['salmon']);
    assert.equal(tasks[0].contextSnapshot.normalized.mediaRef, 'foto');
  });
  await test('New contextual need, another tenant and resolved task remain distinct', async () => {
    const c = conversation();
    const a = await app.tools.humanHandoff('andina', c.id, { reason: 'Primera' });
    const b = await app.tools.humanHandoff('andina', c.id, { reason: 'Otra necesidad', context_snapshot: { plan: { semanticFrame: { humanTask: { newNeed: true } } } } });
    assert.notEqual(a.handoff_id, b.handoff_id);
    const d = await app.tools.humanHandoff('otra', c.id, { reason: 'Otro tenant' });
    assert.notEqual(d.handoff_id, a.handoff_id);
    app.store.mutate(s => { for (const r of s.pendingRequests.filter(r => r.conversationId === c.id)) r.status = 'resolved'; });
    const e = await app.tools.humanHandoff('andina', c.id, { reason: 'Posterior' });
    assert.notEqual(e.handoff_id, b.handoff_id);
  });
  await test('Preparation is unique per committed order, separate from catalog assistance', async () => {
    const c = conversation();
    const a = await app.tools.humanHandoff('andina', c.id, { reason: 'Catálogo' });
    const payload = { context_snapshot: { action: 'prepare_delivery_order', orderId: 'ord-1' } };
    const b = await app.tools.humanHandoff('andina', c.id, payload);
    const again = await app.tools.humanHandoff('andina', c.id, payload);
    const other = await app.tools.humanHandoff('andina', c.id, { context_snapshot: { action: 'prepare_delivery_order', orderId: 'ord-2' } });
    assert.notEqual(a.handoff_id, b.handoff_id); assert.equal(b.handoff_id, again.handoff_id); assert.notEqual(other.handoff_id, b.handoff_id);
  });
  await test('Discount repetition preserves structured context in one approval', async () => {
    const c = conversation();
    const a = await app.tools.approvalGate('andina', c.id, { gate_key: 'discount_exception', payload_summary: { reason: 'Descuento' }, context_snapshot: { customerMessage: '¿Me baja algo?', items: ['pan'] } });
    const b = await app.tools.approvalGate('andina', c.id, { gate_key: 'discount_exception', payload_summary: { reason: 'Seguimiento' }, context_snapshot: { customerMessage: 'Gracias' } });
    assert.equal(a.request_id, b.request_id);
    const r = app.store.getState().pendingRequests.find(r => r.id === a.request_id);
    assert.deepEqual(r.contextSnapshot.items, ['pan']); assert.equal(r.contextSnapshot.customerMessage, 'Gracias');
  });
  await test('Catalog frame without search subjects never fabricates a search from a farewell', async () => {
    const c = conversation(); let searches = 0;
    app.runtime.grounding = { async resolve() { searches++; throw new Error('No interpreted product'); } };
    app.runtime.planner = { async composeReply({fallbackText}) { return {text: fallbackText}; } };
    await app.runtime.handleGroundedCatalogQuery({ tenantId:'andina', conversationId:c.id,
      normalized:{text:'Gracias, solo era consulta', waId:c.waId}, plan:{intent:'catalog_query', order:{items:[]}, semanticFrame:{items:[], reasoningSummary:'Termina consulta'} } });
    assert.equal(searches, 0); assert.equal(app.store.getState().pendingRequests.filter(r => r.conversationId===c.id).length, 0);
  });
  await test('Interactive reply preserves the complete long response before buttons', async () => {
    const c = conversation(); const text = `${'Información de las opciones. '.repeat(45)}Pan tajado 500 g: $ 7.600.`;
    const offer = await app.runtime.createPaymentOffer({tenantId:'andina', conversationId:c.id, body:text, paymentMethods:[{id:'cash',label:'Efectivo'}]});
    await app.runtime.sendCustomerMessage({tenantId:'andina',conversationId:c.id,normalized:{waId:c.waId},payload:{action:'send_session_message',wa_id:c.waId,interactive:offer.interactive}});
    const messages = (await app.runtime.getConversation(c.id)).messages;
    assert.ok(messages.some(m => m.text === text), 'No discarded price or product');
    assert.ok(messages.at(-1).text.length <= 1024); assert.equal(messages.length, 2);
  });
  await test('Resolved products do not discard the LLM decision to consult the shopkeeper', async () => {
    const c = conversation(); let receivedFacts;
    const product = { sku: 'soup', name: 'Sopa', presentation: '64 g', price: 3900, stock: 10,
      description: 'Sopa de pollo', attributes: { flavor: 'pollo' } };
    app.runtime.grounding = { async resolve() { return { nextAction: 'human_review',
      observations: [{ searched: ['sopa'], rows: [product] }], resolutions: [{ status: 'resolved',
        reason: 'Producto identificado; confirmar IVA con la tienda', product, options: [], candidateSet: { candidates: [{ product }] } }] }; } };
    app.runtime.planner = { async composeReply({facts, fallbackText}) { receivedFacts = facts; return {text: fallbackText}; } };
    await app.runtime.handleGroundedCatalogQuery({ tenantId: 'andina', conversationId: c.id, normalized: { text: 'Consulta si incluye IVA', waId: c.waId },
      plan: { intent: 'catalog_query', order: { items: [{ rawItemId: 'soup', rawText: 'sopa' }] }, semanticFrame: { items: [] } } });
    assert.equal(receivedFacts.nextAction, 'human_review');
    const tasks = app.store.getState().pendingRequests.filter(r => r.conversationId === c.id);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].contextSnapshot.customerMessage, 'Consulta si incluye IVA');
    assert.equal(receivedFacts.catalogEvidence[0].resolution.candidateSet, undefined, 'Do not repeat candidate payload in resolution');
    assert.deepEqual(receivedFacts.catalogEvidence[0].candidates[0].attributes, product.attributes);
    assert.equal(receivedFacts.catalogEvidence[0].candidates[0].description, product.description);
  });
  await test('Commercial human review keeps the identified product and creates a task even if continuation conflicts', async () => {
    const c = conversation();
    const product = { sku: 'portion', name: 'Producto porcionado', presentation: 'porción al peso', price: 5000, stock: 10 };
    app.runtime.grounding = { async resolve() { return { nextAction: 'answer_question', observations: [{ rows: [product], searched: ['porcionado'] }],
      resolutions: [{ status: 'human_review', product, options: [], reason: 'Cantidad comercial pendiente', candidateSet: { candidates: [{ product }] } }] }; } };
    let facts;
    app.runtime.planner = { async composeReply(input) { facts = input.facts; return { text: input.fallbackText }; } };
    await app.runtime.handleDeliveryOrder({ tenantId: 'andina', conversationId: c.id, normalized: { text: 'Por ese valor', waId: c.waId },
      plan: { semanticFrame: { items: [] }, order: { delivery: true, items: [{ rawItemId: 'budget', catalogQuery: 'porcionado', quantity: null, budgetAmount: 5000 }] }, missingFields: [] } });
    assert.equal(facts.nextAction, 'human_review'); assert.equal(facts.canConfirm, false);
    const tasks = app.store.getState().pendingRequests.filter(r => r.conversationId === c.id);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].contextSnapshot.orderItems[0].product.sku, 'portion');
    assert.equal(tasks[0].contextSnapshot.orderItems[0].budgetAmount, 5000);
    assert.equal(tasks[0].contextSnapshot.orderItems[0].quantity, null);
  });
  await test('Product buttons do not contain a price that the transport would truncate', async () => {
    const c = conversation();
    const offer = await app.runtime.createProductSelectionOffer({ tenantId: 'andina', conversationId: c.id,
      draftVersion: 1, body: 'Arroz Diana 500 g: $ 3.200. ¿Cuál prefieres?',
      item: { rawItemId: 'rice', quantity: 1, presentationOptions: [
        { sku: 'rice', name: 'Arroz Diana', presentation: '500 g', price: 3200, stock: 10 } ] } });
    assert.ok(!offer.interactive.buttons[0].title.includes('$'), 'Keep complete monetary amounts in the body');
    assert.match(offer.interactive.body, /3\.200/);
    assert.equal(offer.offer.options[0].value, 'rice');
  });
} finally {
  await app.store.close?.(); await fs.rm(dir, {recursive:true,force:true});
}
if (failures.length) process.exitCode = 1;
