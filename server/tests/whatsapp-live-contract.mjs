import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const originalFetch = global.fetch;
const originalToken = process.env.WHATSAPP_ACCESS_TOKEN_REF;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-whatsapp-live-'));
const outboundCalls = [];

process.env.WHATSAPP_ACCESS_TOKEN_REF = 'wa-tenant-token';

global.fetch = async (url, options = {}) => {
  const href = String(url);
  outboundCalls.push({ url: href, options });
  assert.equal(href, 'https://graph.facebook.com/v26.0/100000000001/messages');
  assert.equal(options.headers.authorization, 'Bearer wa-tenant-token');
  const body = JSON.parse(options.body);
  assert.equal(body.messaging_product, 'whatsapp');
  assert.equal(body.to, '573001110002');
  assert.equal(body.type, 'text');
  assert.equal(body.text.body, 'Mensaje live de prueba');
  return jsonResponse({
    messaging_product: 'whatsapp',
    contacts: [{ input: '573001110002', wa_id: '573001110002' }],
    messages: [{ id: 'wamid-live-contract' }],
  });
};

const { tools, store } = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'live',
});

try {
  const result = await tools.call('whatsapp_business_messaging', 'andina', 'whatsapp-live-contract', {
    action: 'send_session_message',
    wa_id: '573001110002',
    text: 'Mensaje live de prueba',
  });

  assert.equal(result.delivery_status, 'accepted_by_provider');
  assert.equal(result.provider_message_id, 'wamid-live-contract');
  assert.equal(outboundCalls.length, 1);
  assert.ok(store.getState().auditEvents.some((event) =>
    event.action === 'tool.whatsapp_business_messaging.sent' &&
    event.metadata?.live === true
  ));

  console.log('WhatsApp live contract tests passed');
} finally {
  await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.WHATSAPP_ACCESS_TOKEN_REF;
  else process.env.WHATSAPP_ACCESS_TOKEN_REF = originalToken;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
