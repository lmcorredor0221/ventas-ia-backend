import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { bogotaCatalogSeed } from '../data/bogotaCatalogSeed.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-variant-offer-'));
const previousGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const previousGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-secret';

try {
  const { runtime, store } = await createAppAsync({
    dataFile: path.join(tempDir, 'store.json'),
    storageDriver: 'json',
    whatsappMode: 'mock',
  });
  store.mutate((state) => {
    state.productsByTenant.andina = bogotaCatalogSeed;
  });

  const initial = await runtime.processInbound({
    tenantId: 'andina',
    waId: '573001112233',
    profileName: 'Cliente de variantes',
    text: 'Para domicilio quiero un Chocoramo y una Coca-Cola',
    messageId: 'wamid.variant.1',
    provider: 'whatsapp',
    messageType: 'text',
  });
  const initialConversation = initial.conversation;
  const initialDraft = initialConversation.orderDraft;
  const variantItem = initialDraft.items.find((item) => /coca/i.test(item.catalogQuery));
  const stableItem = initialDraft.items.find((item) => /chocoramo/i.test(item.catalogQuery));
  assert.equal(variantItem.resolution.status, 'needs_selection');
  assert.equal(stableItem.resolution.status, 'resolved');
  assert.ok(stableItem.product?.sku);

  const offer = Object.values(store.getState().interactionOffersById ?? {})
    .find((item) => item.conversationId === initialConversation.id && item.purpose === 'product_variant' && item.status === 'active');
  assert.ok(offer, 'La variante debe generar una oferta activa');
  assert.equal(offer.rawItemId, variantItem.rawItemId);
  assert.equal(offer.version, initialDraft.version);
  assert.equal(offer.options.length, 2);
  assert.ok(offer.options.every((option) => option.action === 'select_product_variant'));

  const selectedOption = offer.options.find((option) => /1\.5 L/i.test(option.title));
  assert.ok(selectedOption, 'La opcion debe mostrar presentacion y precio al cliente');
  const selected = await runtime.processInbound({
    tenantId: 'andina',
    waId: '573001112233',
    profileName: 'Cliente de variantes',
    text: selectedOption.title,
    messageId: 'wamid.variant.2',
    provider: 'whatsapp',
    messageType: 'interactive',
    interactive: { type: 'button_reply', optionId: selectedOption.id, title: selectedOption.title },
  });
  const selectedDraft = selected.conversation.orderDraft;
  const selectedVariant = selectedDraft.items.find((item) => item.rawItemId === variantItem.rawItemId);
  const retained = selectedDraft.items.find((item) => item.rawItemId === stableItem.rawItemId);
  assert.equal(selected.result.summary, 'Interactive product variant selected');
  assert.equal(selectedVariant.product.sku, 'BOG-BEB-044');
  assert.equal(retained.product.sku, stableItem.product.sku);
  assert.equal(selectedDraft.version, initialDraft.version + 1);
  assert.ok(selectedDraft.subtotal > stableItem.lineTotal);

  const duplicate = await runtime.processInbound({
    tenantId: 'andina',
    waId: '573001112233',
    profileName: 'Cliente de variantes',
    text: selectedOption.title,
    messageId: 'wamid.variant.3',
    provider: 'whatsapp',
    messageType: 'interactive',
    interactive: { type: 'button_reply', optionId: selectedOption.id, title: selectedOption.title },
  });
  assert.equal(duplicate.conversation.orderDraft.version, selectedDraft.version);
  assert.equal(duplicate.conversation.orderDraft.subtotal, selectedDraft.subtotal);
  runtime.stop();
  store.close?.();
  console.log('Product variant offer and versioned selection contract passed.');
} finally {
  if (previousGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = previousGoogleClientId;
  if (previousGoogleClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = previousGoogleClientSecret;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
