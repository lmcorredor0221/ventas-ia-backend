import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createAppAsync } from '../index.js';

// Doubles test execution boundaries, not language comprehension (real suite separate).
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'via-payment-notice-'));
let admin, schema, postgres = {};
if (process.argv.includes('--postgres')) {
  assert.ok(process.env.POSTGRES_TEST_DATABASE_URL, 'Explicit local test URL required');
  const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  schema = `payment_notice_${crypto.randomUUID().replaceAll('-', '')}`;
  admin = new pg.Pool({ connectionString: url.toString(), ssl: false });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  postgres = { storageDriver: 'postgres', databaseUrl: url.toString(), databaseSsl: 'disable' };
}
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(temporary, 'state.json'), ...postgres,
  whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true, authRequired: false, csrfRequired: false });
const failures = [];
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`); } }
let intent = 'payment_confirmation', relatedOrderId = null, facts;
app.runtime.planner = { async plan() { return { intent, semanticFrame: { items: [], customerDelta: {}, paymentReport: { relatedOrderId } } }; },
  async composeReply(input) { facts = input.facts; return { text: input.fallbackText }; } };
let counter = 0;
const send = (extra = {}) => app.runtime.processInbound({ tenantId: 'andina', waId: '573000009901',
  messageId: `payment-notice-${++counter}`, messageType: 'text', text: 'Ya hice la transferencia y te mando comprobante', ...extra });
try {
  await test('Payment declaration acknowledges without financial approval or invented attachment', async () => {
    const { conversation: c } = await send();
    assert.ok(c.messages.some(m => m.role === 'assistant' || m.role === 'agent'), 'Must reply');
    assert.ok(!app.store.getState().pendingRequests.some(p => p.conversationId === c.id));
    assert.equal(c.paymentNotices.length, 1);
    assert.equal(c.paymentNotices[0].kind, 'declaration');
    assert.equal(c.paymentNotices[0].attachment, null);
    assert.equal(facts.paymentVerified, false);
    assert.ok(!c.orderId);
  });
  await test('Receipt is persisted, visible, nonblocking and duplicate delivery is ignored', async () => {
    const input = { messageId: 'actual-receipt', messageType: 'image', mediaRef: 'media-receipt', text: 'Este es el soporte' };
    const { conversation: c } = await send(input);
    const receipt = c.paymentNotices.find(n => n.kind === 'receipt');
    assert.equal(receipt.attachment.mediaRef, 'media-receipt');
    assert.equal(c.messages.find(m => m.providerMessageId === 'actual-receipt').mediaRef, 'media-receipt');
    assert.ok(!['blocked', 'approval_required'].includes(c.status));
    const before = c.messages.length;
    assert.equal((await send(input)).duplicate, true);
    assert.equal((await app.runtime.getConversation(c.id)).messages.length, before);
    await send({ ...input, messageId: 'redelivered-media' });
    assert.equal((await app.runtime.getConversation(c.id)).paymentNotices.filter(n => n.attachment?.mediaRef === 'media-receipt').length, 1);
  });
  await test('Receipt preserves order, pending preparation, method and commercial conditions', async () => {
    const c = app.store.getState().conversations.find(c => c.waId === '573000009901');
    const order = { id: 'payment-order', tenantId: 'andina', conversationId: c.id, customerWaId: c.waId,
      status: 'pending_human_preparation', paymentMethod: 'cash', subtotal: 10000, items: [{ sku: 'fixture', quantity: 1, price: 10000 }] };
    const preparation = { id: 'fixture-prepare', tenantId: 'andina', conversationId: c.id, status: 'pending',
      type: 'human_handoff', action: 'prepare_delivery_order', title: 'Alistar pedido', contextSnapshot: { orderId: order.id } };
    app.store.mutate(s => { (s.ordersByTenant.andina ??= []).push(order); Object.assign(c, { orderId: order.id,
      stage: 'preparing', nextStep: 'Alistar pedido', orderDraft: { version: 5, paymentMethod: 'cash', items: [], pricing: { total: 10000 } } }); s.pendingRequests.push(preparation); });
    await app.store.persistConversation?.(c.id); await app.store.persistOrder?.('andina', order.id); await app.store.persistPendingRequest?.(preparation.id);
    const snapshot = structuredClone(order), draft = structuredClone(c.orderDraft);
    const taskSnapshot = structuredClone(preparation);
    relatedOrderId = order.id;
    const result = await send({ messageType: 'image', mediaRef: 'second-receipt', text: 'Mi comprobante' });
    assert.deepEqual(app.orders.findOrder(order.id, 'andina'), snapshot);
    assert.deepEqual(result.conversation.orderDraft, draft);
    assert.equal(result.conversation.stage, 'preparing');
    assert.equal(result.conversation.nextStep, 'Alistar pedido');
    assert.deepEqual(app.orders.pendingPreparationRequest(order), taskSnapshot);
    await app.runtime.resolveHumanRequest(preparation.id, { outcome: 'approved', approverId: 'test-owner', note: 'Marcar tomado' });
    assert.equal(app.orders.findOrder(order.id, 'andina').status, 'preparing');
    await app.orders.transition({ orderId: order.id, tenantId: 'andina', nextStatus: 'dispatched', actorId: 'test-owner' });
    assert.equal(app.orders.findOrder(order.id, 'andina').status, 'dispatched');
  });
  await test('Receipt after dispatch links only a contextual known order without reopening it', async () => {
    relatedOrderId = 'payment-order';
    const r = await send({ messageType: 'image', mediaRef: 'post-dispatch', text: 'Soporte del pedido anterior' });
    assert.equal(r.conversation.paymentNotices.at(-1).orderId, 'payment-order');
    assert.ok(!r.conversation.orderId);
    assert.equal(app.orders.findOrder('payment-order', 'andina').status, 'dispatched');
    assert.equal(app.store.getState().ordersByTenant.andina.filter(o => o.id === 'payment-order').length, 1);
  });
  await test('LLM cannot link another tenant or customer order', async () => {
    const other = { id: 'foreign-order', tenantId: 'otra', customerWaId: '573000009901' };
    app.store.mutate(s => { s.ordersByTenant.otra = [other]; }); relatedOrderId = other.id;
    const r = await send({ mediaRef: 'foreign-claim', messageType: 'image', text: 'Soporte' });
    assert.equal(r.conversation.paymentNotices.at(-1).orderId, null);
    assert.deepEqual(app.orders.findOrder(other.id, 'otra'), other);
    app.store.mutate(s => { s.ordersByTenant.andina.push({ id: 'other-customer', tenantId: 'andina', waId: '573000001111' }); });
    relatedOrderId = 'other-customer';
    const wrongCustomer = await send({ text: 'Mi soporte', mediaRef: 'wrong-customer-media', messageType: 'image' });
    assert.equal(wrongCustomer.conversation.paymentNotices.at(-1).orderId, null);
  });
  await test('Product photo keeps human identification, not a payment notice', async () => {
    intent = 'catalog_query'; relatedOrderId = null;
    const r = await send({ waId: '573000009902', messageType: 'image', mediaRef: 'product-photo', text: '¿Tienen este producto?' });
    assert.equal(r.conversation.paymentNotices?.length ?? 0, 0);
    assert.ok(app.store.getState().pendingRequests.some(p => p.conversationId === r.conversation.id && p.type === 'human_handoff'));
  });
  await test('Manual attention retains receipt notice without resuming automated replies', async () => {
    intent = 'payment_confirmation'; relatedOrderId = null;
    const c = await app.runtime.ensureConversation('andina', { waId: '573000009903', text: 'Atención manual' });
    await app.runtime.activateManualWhatsApp(c.id);
    const r = await send({ waId: c.waId, messageType: 'image', mediaRef: 'manual-receipt', text: 'Te envío el comprobante' });
    assert.equal(r.conversation.status, 'manual_active'); assert.equal(r.conversation.aiPaused, true);
    assert.equal(r.conversation.paymentNotices.length, 1);
    assert.ok(!r.conversation.messages.some(m => ['assistant', 'agent'].includes(m.role)));
  });
  await test('Overlapping notice writes preserve both attachments and deduplicate the same source', async () => {
    const c = await app.runtime.ensureConversation('andina', { waId: '573000009904', text: 'Comprobante' });
    const snapshot = structuredClone(c);
    const write = (id) => app.runtime.handlePaymentNotice({ tenantId: 'andina', conversationId: c.id,
      normalized: { messageId: id, messageType: 'image', mediaRef: id, waId: c.waId, text: 'Soporte' },
      plan: { semanticFrame: { paymentReport: { relatedOrderId: null } } }, currentConversation: snapshot,
      paymentOrderContext: [], silent: true });
    await Promise.all([write('receipt-a'), write('receipt-b'), write('receipt-a')]);
    const stored = await app.runtime.getConversation(c.id);
    assert.deepEqual(stored.paymentNotices.map(n => n.attachment.mediaRef).sort(), ['receipt-a', 'receipt-b']);
  });
  await test('Operator overview exposes notices only for the requested tenant, including history', async () => {
    const server = app.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/ops/overview`;
      const response = await fetch(`${url}?tenantId=andina`); assert.equal(response.status, 200);
      const overview = await response.json();
      assert.ok(overview.paymentNotices.some(n => n.attachment?.mediaRef === 'media-receipt'));
      assert.ok(overview.paymentNotices.every(n => n.tenantId === 'andina'));
      const otherTenant = app.store.getState().tenants.find(t => t.id !== 'andina').id;
      assert.equal((await (await fetch(`${url}?tenantId=${otherTenant}`)).json()).paymentNotices.length, 0);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await test('Receipt survives durable storage with attachment and no payment settlement', async () => {
    await app.store.flush?.();
    if (admin) {
      const result = await app.store.pool.query("SELECT payload FROM conversations WHERE payload->'paymentNotices' IS NOT NULL");
      const notices = result.rows.flatMap(r => r.payload.paymentNotices);
      assert.ok(notices.some(n => n.attachment?.mediaRef === 'media-receipt'));
      assert.ok(notices.every(n => n.paymentVerified === false));
    } else {
      const disk = JSON.parse(await fs.readFile(path.join(temporary, 'state.json'), 'utf8'));
      assert.ok(disk.conversations.flatMap(c => c.paymentNotices ?? []).some(n => n.attachment?.mediaRef === 'media-receipt'));
    }
  });
} finally {
  app.runtime.stop(); await app.store.close?.();
  if (admin) { assert.match(schema, /^payment_notice_[a-f0-9]{32}$/); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir())); await fs.rm(temporary, { recursive: true, force: true });
}
assert.deepEqual(failures, []);
