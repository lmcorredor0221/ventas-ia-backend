import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-backend-'));
const { app } = createApp({ dataFile: path.join(tempDir, 'store.json') });
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  const health = await getJson(`${base}/health`);
  assert.equal(health.ok, true);

  const overview = await getJson(`${base}/api/ops/overview?tenantId=andina`);
  assert.ok(overview.conversations.length > 0);
  assert.ok(overview.tools.some((tool) => tool.name === 'google_sheets_read_table'));

  const run = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998877',
    profileName: 'Prueba Local',
    text: 'Necesito precio de un mostrador',
  });
  assert.equal(run.duplicate, false);
  assert.ok(run.conversation.id);

  const imageRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998878',
    profileName: 'Imagen Local',
    messageType: 'image',
    mediaRef: 'media-1',
    text: '',
  });
  assert.equal(imageRun.duplicate, false);

  const pending = await getJson(`${base}/api/pending-requests?tenantId=andina`);
  assert.ok(pending.some((request) => request.type === 'human_handoff'));

  const verify = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=dev-verify-token&hub.challenge=abc123`);
  assert.equal(await verify.text(), 'abc123');

  console.log('Backend smoke tests passed');
} finally {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text);
}
