import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  console.log('Mercado Pago sandbox test skipped: MERCADOPAGO_ACCESS_TOKEN is not configured.');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-mp-'));
const runtime = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
});

try {
  const bundle = runtime.controlPlane.createTenant({
    storeName: 'Mercado Pago Sandbox Store',
    ownerEmail: 'sandbox@example.local',
    ownerName: 'Sandbox Owner',
  }, { actor: { id: 'sandbox-test', email: 'sandbox@example.local' } });
  const tenantId = bundle.tenant.id;
  const checkout = await runtime.controlPlane.createSubscriptionCheckout({
    tenantId,
    payerEmail: process.env.MERCADOPAGO_SANDBOX_PAYER_EMAIL ?? 'test_user_123@testuser.com',
  });

  assert.equal(checkout.mode, 'live');
  assert.equal(checkout.provider, 'mercado_pago');
  assert.ok(checkout.checkoutUrl, 'Mercado Pago must return a checkout URL');
  assert.ok(checkout.subscription.mercadoPagoPreapprovalId, 'Mercado Pago must return a preapproval id');

  const sync = await runtime.controlPlane.syncMercadoPagoSubscription(tenantId, {
    actor: { id: 'sandbox-test', email: 'sandbox@example.local' },
    force: true,
  });
  assert.equal(sync.checkedProvider, true);
  assert.ok(sync.providerStatus, 'Manual sync must read provider status');
  console.log(JSON.stringify({
    ok: true,
    tenantId,
    checkoutUrl: checkout.checkoutUrl,
    preapprovalId: checkout.subscription.mercadoPagoPreapprovalId,
    providerStatus: sync.providerStatus,
  }, null, 2));
} finally {
  await runtime.store.close?.();
}
