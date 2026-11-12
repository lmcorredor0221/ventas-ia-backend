import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

// Intentionally isolated live-provider diagnostic. It uses the real planner
// and DeepSeek but the mock WhatsApp adapter and a temporary JSON store.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-deepseek-line-updates-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
  integrationOutboxEnabled: false,
  dataFile: path.join(dir, 'store.json'),
  llmRequestTimeoutMs: 30000,
  contextualProductSelectionV2: true,
  contextualProductSelectionTenants: ['andina'],
});

const tenantId = 'andina';
const waId = '573000000907';
const conversationId = 'deepseek-line-updates-live';
const pan = { sku: 'PAN-500', name: 'Pan tajado blanco Bimbo', presentation: '500 g', price: 10200, stock: 50, category: 'Panadería' };
const queso = { sku: 'QUESO-250', name: 'Queso doble crema Colanta', presentation: '250 g', price: 10800, stock: 24, category: 'Lácteos' };
store.mutate((state) => {
  state.platformSettings.llm = {
    ...(state.platformSettings.llm ?? {}), provider: 'deepseek', model: 'deepseek-chat', mode: 'json_schema', simulator: null,
    apiKeyRef: 'DEEPSEEK_API_KEY', baseUrlRef: 'DEEPSEEK_BASE_URL', temperature: 0, maxTokens: 1200, timeoutMs: 30000,
  };
  state.productsByTenant[tenantId] = [pan, queso];
  state.conversations.unshift({
    id: conversationId, tenantId, waId, status: 'live', stage: 'clarification', messages: [
      { role: 'agent', text: '¿Cuántas unidades de cada producto deseas?', at: new Date().toISOString() },
    ],
    orderDraft: { delivery: true, items: [
      { lineId: 'line-pan', rawName: 'pan tajado', catalogQuery: 'pan tajado', quantity: null, selectionStatus: 'selected', product: pan },
      { lineId: 'line-queso', rawName: 'queso doble crema', catalogQuery: 'queso doble crema', quantity: 'media libra', selectionStatus: 'selected', product: queso },
    ], missingFields: ['quantity:pan tajado', 'quantity:queso doble crema'] },
  });
});

try {
  const result = await runtime.processInbound({ tenantId, waId, text: 'una de cada una', messageId: `deepseek-live-${Date.now()}`, provider: 'whatsapp' });
  const conversation = store.getState().conversations.find((item) => item.id === conversationId);
  console.log(JSON.stringify({
    plan: { intent: result.result?.plan?.intent, lineUpdates: result.result?.plan?.lineUpdates ?? [] },
    items: conversation.orderDraft?.items?.map((item) => ({ lineId: item.lineId, quantity: item.quantity, requestedMeasure: item.requestedMeasure, available: item.available, lineTotal: item.lineTotal })),
    missingFields: conversation.orderDraft?.missingFields,
  }, null, 2));
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
