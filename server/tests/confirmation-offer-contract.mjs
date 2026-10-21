import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-confirmation-offer-'));
const { runtime } = createApp({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  whatsappMode: 'mock',
});

const confirmation = await runtime.createConfirmationOffer({
  tenantId: 'andina',
  conversationId: 'wa-confirmation-contract',
  body: 'El subtotal es $ 10.000. ¿Confirmas el pedido?',
});

assert.equal(confirmation.interactive.kind, 'button');
assert.deepEqual(
  confirmation.offer.options.map((option) => ({ title: option.title, action: option.action })),
  [
    { title: 'Confirmar pedido', action: 'confirm_order' },
    { title: 'Ajustar pedido', action: 'adjust_order' },
    { title: 'Hablar con la tienda', action: 'human_handoff' },
  ],
);
assert.equal(confirmation.interactive.buttons.length, 3);

console.log('Confirmation offer contract checks passed');
