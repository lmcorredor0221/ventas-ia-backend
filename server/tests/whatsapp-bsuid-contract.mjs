import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { normalizeWhatsAppEvents } from '../routes/whatsapp.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-bsuid-'));
const originalFetch = global.fetch;
const originalToken = process.env.WHATSAPP_ACCESS_TOKEN_REF;
process.env.WHATSAPP_ACCESS_TOKEN_REF = 'local-test-token';
const { store, tools, runtime } = await createAppAsync({ dataFile: path.join(dir, 'state.json'), storageDriver: 'json', whatsappMode: 'live', backgroundWorkersEnabled: false });
const bsuid = 'CO.DemoBuyer001';
const other = 'CO.DemoBuyer002';
const envelope = (messages, contacts = [], statuses = []) => ({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '100000000001' }, messages, contacts, statuses } }] }] });
const msg = (id, userId = bsuid) => ({ id, from_user_id: userId, type: 'text', text: { body: 'Hola, quiero hacer un pedido' } });
try {
  const events = normalizeWhatsAppEvents(envelope([msg('bsuid-inbound'), msg('other-inbound', other)], [
    { user_id: other, profile: { name: 'Other buyer' } },
    { user_id: bsuid, profile: { name: 'Demo buyer', username: 'demo.buyer' } },
  ], [{ id: 'outbound', recipient_user_id: bsuid, status: 'delivered' }]), store.getState());
  assert.equal(events[0].waId, bsuid, 'BSUID-only inbound must preserve the complete sender identifier');
  assert.equal(events[0].profileName, 'Demo buyer', 'contact matching must not match undefined phone numbers');
  assert.equal(events[1].waId, other);
  assert.equal(events[1].profileName, 'Other buyer');
  assert.equal(events[2].waId, bsuid);
  const legacy = normalizeWhatsAppEvents(envelope([{ ...msg('legacy'), from: '573001110002' }], [{ wa_id: '573001110002', user_id: bsuid, profile: { name: 'Known phone' } }]), store.getState())[0];
  assert.equal(legacy.waId, '573001110002');
  assert.equal(legacy.whatsappUserId, bsuid);
  assert.equal(legacy.profileName, 'Known phone');
  const calls = [];
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://graph.facebook.com/v26.0/100000000001/messages');
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(body.recipient, bsuid, 'Meta requires recipient for BSUID, not to');
    assert.equal(Object.hasOwn(body, 'to'), false);
    return new Response(JSON.stringify({ messages: [{ id: `out-${calls.length}` }], contacts: [{ user_id: bsuid }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  for (const extra of [ {}, { template_name: 'order_update' },
    { interactive: { kind: 'button', buttons: [{ id: 'confirm', title: 'Confirmar pedido' }] } },
    { interactive: { kind: 'list', rows: [{ id: 'cash', title: 'Efectivo' }] } },
  ]) await tools.call('whatsapp_business_messaging', 'andina', 'bsuid-contract', { wa_id: bsuid, text: 'Mensaje de prueba', ...extra });
  assert.equal(calls.length, 4);
  await assert.rejects(tools.call('whatsapp_business_messaging', 'andina', 'bsuid-contract', { text: 'No destination' }), e => e.code === 'whatsapp_recipient_missing');
  assert.equal(calls.length, 4, 'missing destination must never reach Meta');
  const first = await runtime.ensureConversation('andina', events[0]);
  const second = await runtime.ensureConversation('andina', events[1]);
  assert.notEqual(first.id, second.id);
  assert.equal((await runtime.ensureConversation('andina', { ...events[0], messageId: 'next' })).id, first.id);
  assert.notEqual((await runtime.ensureConversation('norte', events[0])).id, first.id, 'same identifier across tenants stays isolated');
  const count = store.getState().conversations.length;
  await assert.rejects(runtime.processInbound({ tenantId: 'andina', messageId: 'missing-id', text: 'Hola' }), e => e.code === 'whatsapp_recipient_missing');
  assert.equal(store.getState().conversations.length, count, 'missing identity must not create or reuse an anonymous conversation');
  await runtime.processInbound({ tenantId: 'andina', coexistenceEvent: { field: 'smb_message_echoes', value: {
    message_echoes: [{ id: 'human-bsuid', to_user_id: bsuid, type: 'text', text: { body: 'Ya te atiendo' } }],
  } } });
  assert.equal(store.getState().conversations.find(c => c.id === first.id).manualMode, 'whatsapp_external');
  assert.equal(store.getState().conversations.find(c => c.id === first.id).messages.filter(m => m.providerMessageId === 'human-bsuid').length, 1);
  console.log('PASS BSUID inbound/contact/status, outbound text/template/buttons/list, continuity, tenant isolation and missing recipient guard');
} finally {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN_REF;
  else process.env.WHATSAPP_ACCESS_TOKEN_REF = originalToken;
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
