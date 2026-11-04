import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-whatsapp-batch-'));
const runtime = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'mock',
  asyncInboundEnabled: true,
  integrationOutboxEnabled: true,
  whatsappInboundBatchingEnabled: true,
  whatsappInboundBatchWindowMs: 10,
  whatsappInboundBatchMaxMessages: 8,
  backgroundWorkersEnabled: false,
});

try {
  const first = runtime.store.enqueueInboundMessage(payload('wamid-batch-1', 'Hola'));
  const second = runtime.store.enqueueInboundMessage(payload('wamid-batch-2', 'Me llamo Luis'));
  assert.equal(first.created, true);
  assert.equal(second.created, true);

  const drained = await runtime.integrationOutbox.drain();
  assert.equal(drained.processed, 2, 'La entrada agrupada y la entrada ya completada deben cerrar ambos outbox');

  const firstInbound = runtime.store.getInboundMessage('wamid-batch-1');
  const secondInbound = runtime.store.getInboundMessage('wamid-batch-2');
  assert.equal(firstInbound.status, 'completed');
  assert.equal(secondInbound.status, 'completed');
  assert.equal(firstInbound.result.batchSize, 2);
  assert.equal(secondInbound.result.batchSize, 2);
  assert.deepEqual(firstInbound.result.processedMessageIds, ['wamid-batch-1', 'wamid-batch-2']);

  const conversationId = firstInbound.result.conversationId;
  const conversation = runtime.store.getState().conversations.find((item) => item.id === conversationId);
  const inboundMessages = conversation.messages.filter((message) => message.role === 'user');
  assert.deepEqual(inboundMessages.map((message) => message.providerMessageId), ['wamid-batch-1', 'wamid-batch-2']);
  const started = runtime.store.getState().events.find((event) => event.type === 'agent.started' && event.conversationId === conversationId);
  assert.equal(started.metadata.batchSize, 2);

  console.log('WhatsApp inbound batching contract tests passed');
} finally {
  runtime.runtime.stop();
  await runtime.integrationOutbox.stop();
  await runtime.store.close?.();
  await fs.rm(tempDir, { recursive: true, force: true });
}

function payload(messageId, text) {
  return {
    tenantId: 'andina',
    provider: 'meta_whatsapp_cloud_api',
    waId: '573009991111',
    phoneNumberId: '100000000001',
    profileName: 'Luis',
    messageId,
    messageType: 'text',
    text,
    receivedAt: new Date().toISOString(),
  };
}
