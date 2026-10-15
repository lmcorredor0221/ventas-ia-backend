import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-autoservicio-'));
const { app, store, controlPlane } = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  allowLocalCatalogFallback: false,
});
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const basicPlanId = 'ventas_ia_400_domicilios';

  const trialPlan = controlPlane.updateBillingPlan(basicPlanId, {
    trialEnabled: true,
    trialDays: 7,
  });
  assert.equal(trialPlan.trialEnabled, true);
  assert.equal(trialPlan.trialDays, 7);

  const trialBundle = controlPlane.createTenant({
    storeName: 'Tienda Trial Autoservicio',
    ownerEmail: 'trial@example.com',
    ownerName: 'Dueño Trial',
  });
  assert.equal(trialBundle.subscription.status, 'trial');
  assert.equal(trialBundle.status.readyForOperation, false);
  assert.ok(trialBundle.subscription.trialEndsAt);
  assert.equal(trialBundle.subscription.includedDeliveries, 400);

  const trialEnd = new Date(Date.parse(trialBundle.subscription.trialEndsAt) + 60_000).toISOString();
  const maintenance = controlPlane.runBillingMaintenance({ now: trialEnd });
  assert.ok(maintenance.actions.some((action) => action.tenantId === trialBundle.tenant.id && action.action === 'trial_ended'));
  assert.equal(store.getState().subscriptionsByTenant[trialBundle.tenant.id].status, 'pending_payment');
  assert.equal(store.getState().tenants.find((tenant) => tenant.id === trialBundle.tenant.id).lifecycle.access, 'blocked');

  controlPlane.updateBillingPlan(basicPlanId, { trialEnabled: false, trialDays: 0 });

  const unavailableResponse = await fetch(`${base}/api/agent/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantId: 'andina',
      waId: '573009991234',
      profileName: 'Google no disponible',
      text: 'Buenas, para domicilio me regalas una coca cola 350',
    }),
  });
  assert.equal(unavailableResponse.status, 200);
  const unavailable = await unavailableResponse.json();
  assert.equal(unavailable.result.summary, 'Google unavailable; human handoff requested');
  assert.equal(unavailable.conversation.status, 'blocked');
  assert.ok(unavailable.conversation.messages.at(-1).text.includes('no esta conectada a Google'));

  const pending = store.getState().pendingRequests.find((request) => request.conversationId === unavailable.conversation.id);
  assert.equal(pending.type, 'human_handoff');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.contextSnapshot.action, 'connect_google_or_validate_order_manually');
} finally {
  server.close();
}

console.log('Autoservicio plan checks passed');
