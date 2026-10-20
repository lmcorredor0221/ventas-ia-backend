import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-whatsapp-async-'));
const runtime = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'mock',
  asyncInboundEnabled: true,
  integrationOutboxEnabled: true,
  backgroundWorkersEnabled: false,
});
const server = runtime.app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const url = `http://127.0.0.1:${port}/webhooks/whatsapp`;
  const payload = inboundPayload('wamid-async-contract-1');

  const startedAt = Date.now();
  const first = await postJson(url, payload);
  const elapsedMs = Date.now() - startedAt;
  assert.equal(first.queued, true);
  assert.equal(first.duplicate, false);
  assert.ok(elapsedMs < 1_000, `Webhook should acknowledge before catalog/LLM work (${elapsedMs} ms)`);
  assert.equal(runtime.store.getInboundMessage('wamid-async-contract-1').status, 'queued');
  assert.equal(runtime.store.listOutbox({ status: 'pending' }).filter((entry) => entry.kind === 'whatsapp.inbound_processing').length, 1);

  const duplicate = await postJson(url, payload);
  assert.equal(duplicate.queued, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(runtime.store.listOutbox({ status: 'pending' }).filter((entry) => entry.kind === 'whatsapp.inbound_processing').length, 1);

  const drained = await runtime.integrationOutbox.drain();
  assert.equal(drained.processed, 1);
  const inbound = runtime.store.getInboundMessage('wamid-async-contract-1');
  assert.equal(inbound.status, 'completed');
  assert.ok(inbound.result?.conversationId);

  const conversation = runtime.store.getState().conversations.find((item) => item.id === inbound.result.conversationId);
  assert.ok(conversation.messages.some((message) => message.role === 'user' && message.providerMessageId === 'wamid-async-contract-1'));

  const paymentOffer = runtime.store.createInteractionOffer({
    id: 'io-paymentcontract',
    tenantId: 'andina',
    conversationId: conversation.id,
    purpose: 'payment_method',
    options: [{ id: 'vi:io-paymentcontract:1', title: 'Efectivo', action: 'set_payment_method', value: 'cash' }],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(paymentOffer.status, 'active');
  await runtime.runtime.processInbound({
    tenantId: 'andina',
    provider: 'meta_whatsapp_cloud_api',
    waId: '573001110002',
    phoneNumberId: '100000000001',
    profileName: 'Prueba asíncrona',
    messageId: 'wamid-async-payment-1',
    messageType: 'interactive',
    text: 'Efectivo',
    interactive: { type: 'button_reply', optionId: 'vi:io-paymentcontract:1', title: 'Efectivo' },
  });
  assert.equal(runtime.store.getState().interactionOffersById['io-paymentcontract'].status, 'consumed');

  const terminalMessageId = 'wamid-async-terminal-failure';
  const terminalInbound = runtime.store.enqueueInboundMessage({
    tenantId: 'andina',
    provider: 'meta_whatsapp_cloud_api',
    waId: '573001110002',
    phoneNumberId: '100000000001',
    messageId: terminalMessageId,
    messageType: 'text',
    text: 'Mensaje que falla para probar la cola',
  });
  const originalHandler = runtime.integrationOutbox.handlers['whatsapp.inbound_processing'];
  runtime.integrationOutbox.handlers['whatsapp.inbound_processing'] = async () => {
    throw new Error('terminal inbound failure');
  };
  runtime.integrationOutbox.maxAttempts = 1;
  await runtime.integrationOutbox.drain();
  assert.equal(terminalInbound.created, true);
  assert.equal(runtime.store.getInboundMessage(terminalMessageId).status, 'dead_letter');
  runtime.integrationOutbox.handlers['whatsapp.inbound_processing'] = originalHandler;

  console.log('WhatsApp async inbound contract tests passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
  runtime.runtime.stop();
  await runtime.integrationOutbox.stop();
  await runtime.store.close?.();
  await fs.rm(tempDir, { recursive: true, force: true });
}

function inboundPayload(messageId) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-contract',
      changes: [{
        field: 'messages',
        value: {
          metadata: { display_phone_number: '+1 555 202 4079', phone_number_id: '100000000001' },
          contacts: [{ profile: { name: 'Prueba asíncrona' }, wa_id: '573001110002' }],
          messages: [{ id: messageId, from: '573001110002', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Tienes chocorramo?' } }],
        },
      }],
    }],
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${text}`);
  return JSON.parse(text);
}
