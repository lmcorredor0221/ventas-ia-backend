import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventas-ia-contextual-routing-'));
const runtime = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
});

try {
  const calls = [];
  const originalCall = runtime.runtime.tools.call.bind(runtime.runtime.tools);
  runtime.runtime.tools.call = async (...args) => {
    calls.push(args);
    return originalCall(...args);
  };
  runtime.runtime.planner = {
    async plan() {
      return {
        intent: 'greeting',
        order: { delivery: false, items: [] },
        semanticFrame: {
          schemaVersion: 'semantic-frame.v2',
          intent: 'greeting',
          conversationAct: 'new_request',
          delivery: false,
          customerDelta: {},
          items: [],
          missingCustomerFields: [],
          confidence: 0.98,
        },
        recommendedTools: ['whatsapp_business_messaging'],
        missingFields: [],
        confidence: 0.98,
      };
    },
    async composeReply({ fallbackText }) {
      return { text: fallbackText, executionMode: 'deterministic_test_fallback' };
    },
  };

  const result = await runtime.runtime.processInbound({
    tenantId: 'andina',
    provider: 'meta_whatsapp_cloud_api',
    waId: '573009992222',
    phoneNumberId: '100000000001',
    profileName: 'Cliente saludo',
    messageId: 'wamid-greeting-routing-1',
    messageType: 'text',
    text: 'Buenas veci',
  });

  assert.equal(result.result.summary, 'Contextual greeting sent');
  assert.equal(calls.some(([name]) => name === 'google_sheets_read_table'), false);
  assert.equal(calls.some(([name]) => name === 'google_drive_file_picker'), false);
  assert.equal(calls.some(([name, , , payload]) => name === 'whatsapp_business_messaging'
    && payload?.text?.includes('Hola')
    && payload?.text?.includes('Rocío')), true);
  console.log('Contextual routing contract tests passed');
} finally {
  runtime.runtime.stop();
  await runtime.store.close?.();
  await fs.rm(tempDir, { recursive: true, force: true });
}
