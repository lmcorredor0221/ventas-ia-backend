import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-handoff-gap-'));
const dataFile = path.join(dir, 'store.json');
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  dataFile,
  whatsappMode: 'mock',
  allowLocalCatalogFallback: true,
  contextualProductSelectionV2: true,
  contextualProductSelectionTenants: ['andina'],
  backgroundWorkersEnabled: false,
});

const selectedProduct = {
  sku: 'BOG-PAN-019', name: 'Ponque Chocoramo', price: 2800, stock: 55,
  category: 'Ponques y paquetes', brand: 'Ramo', presentation: '65 g',
};
const handoffQuestion = 'El brownie Mamai de arequipe no aparece en el catálogo. ¿Desea que un asesor le confirme disponibilidad o prefiere otro producto?';
const conversationId = 'handoff-product-gap';
const waId = '573000009002';

try {
  runtime.planner = {
    async composeReply({ fallbackText }) { return { text: fallbackText }; },
  };
  store.mutate((state) => {
    state.conversations.unshift({
      id: conversationId,
      tenantId: 'andina',
      waId,
      status: 'live',
      messages: [],
      orderDraft: {
        delivery: true,
        items: [
          { lineId: 'L1', catalogQuery: 'chocorramo', quantity: 3, product: selectedProduct, lineTotal: 8400, available: true, selectionStatus: 'selected' },
          {
            lineId: 'L2', catalogQuery: 'brownie Mamai arequipe', quantity: 1,
            product: null, lineTotal: null, available: false, selectionStatus: 'handoff',
            selectionQuestion: handoffQuestion,
          },
        ],
        missingFields: [
          'product:brownie Mamai arequipe',
          'quantity:brownie Mamai arequipe',
          'stock:brownie Mamai arequipe',
        ],
        subtotal: 8400,
      },
    });
  });

  await runtime.handleOrderClarification({
    tenantId: 'andina',
    conversationId,
    normalized: { waId, text: 'Ramo Ponque · 65 g', traceId: 'handoff-product-gap' },
    customerProfile: { name: 'Luis', defaultAddress: 'Calle 1' },
    plan: { intent: 'order_clarification', order: { delivery: true, items: [] }, missingFields: [] },
    preserveExistingCatalogSelections: true,
  });

  const conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.deepEqual(conversation.orderDraft.missingFields, ['product:brownie Mamai arequipe']);
  const reply = conversation.messages.filter((message) => message.role === 'agent').at(-1)?.text ?? '';
  assert.match(reply, /El brownie Mamai de arequipe no aparece en el catálogo/);
  assert.doesNotMatch(reply, /cantidad de brownie/i);
  assert.doesNotMatch(reply, /confirmar alternativa/i);
  assert.equal(conversation.orderDraft.items.find((item) => item.lineId === 'L1').lineTotal, 8400);
  console.log('Handoff product-gap continuity passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
