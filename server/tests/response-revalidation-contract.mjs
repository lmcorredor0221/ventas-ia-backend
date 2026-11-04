import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-response-revalidation-'));
const runtime = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
});

try {
  const conversationId = 'response-revalidation-conversation';
  runtime.store.mutate((state) => {
    state.conversations.unshift({
      id: conversationId,
      tenantId: 'andina',
      waId: '573009991111',
      status: 'live',
      messages: [{ role: 'user', providerMessageId: 'wamid-newer', text: 'Ahora quiero otra cosa' }],
    });
  });
  const calls = [];
  const originalCall = runtime.runtime.tools.call.bind(runtime.runtime.tools);
  runtime.runtime.tools.call = async (...args) => {
    calls.push(args);
    return originalCall(...args);
  };

  const suppressed = await runtime.runtime.sendCustomerMessage({
    tenantId: 'andina',
    conversationId,
    normalized: { messageId: 'wamid-stale', waId: '573009991111', messageType: 'text' },
    payload: { action: 'send_session_message', wa_id: '573009991111', text: 'Respuesta vieja' },
  });
  assert.equal(suppressed.suppressed, true);
  assert.equal(calls.length, 0);
  assert.ok(runtime.store.getState().events.some((event) => event.type === 'llm.response.suppressed'));

  const sent = await runtime.runtime.sendCustomerMessage({
    tenantId: 'andina',
    conversationId,
    normalized: { messageId: 'wamid-newer', waId: '573009991111', messageType: 'text' },
    payload: { action: 'send_session_message', wa_id: '573009991111', text: 'Respuesta vigente' },
  });
  assert.equal(sent.suppressed, undefined);
  assert.equal(calls.length, 1);
  console.log('Response revalidation contract tests passed');
} finally {
  runtime.runtime.stop();
  await runtime.store.close?.();
  await fs.rm(tempDir, { recursive: true, force: true });
}
