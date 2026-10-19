import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const originalFetch = global.fetch;
const envKeys = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_WHATSAPP_ADVANCED_ACCESS_APPROVED',
  'WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID',
  'WHATSAPP_WEBHOOK_PUBLIC_URL',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'SECRET_ENCRYPTION_KEY',
  'WHATSAPP_GRAPH_API_VERSION',
  'WHATSAPP_TENANT_TOKEN_LIFETIME_DAYS',
  'WHATSAPP_TENANT_TOKEN_RENEWAL_WINDOW_DAYS',
];
const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-whatsapp-embedded-'));
const graphCalls = [];

Object.assign(process.env, {
  META_APP_ID: 'meta-app-contract',
  META_APP_SECRET: 'meta-secret-contract',
  META_WHATSAPP_ADVANCED_ACCESS_APPROVED: 'false',
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: 'meta-config-contract',
  WHATSAPP_WEBHOOK_PUBLIC_URL: 'https://example.test/webhooks/whatsapp',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-contract',
  SECRET_ENCRYPTION_KEY: 'embedded-signup-contract-key',
  WHATSAPP_GRAPH_API_VERSION: 'v26.0',
  WHATSAPP_TENANT_TOKEN_LIFETIME_DAYS: '60',
  WHATSAPP_TENANT_TOKEN_RENEWAL_WINDOW_DAYS: '14',
});

global.fetch = async (url, options = {}) => {
  const href = String(url);
  graphCalls.push({ url: href, options });
  if (href.includes('/oauth/access_token')) return jsonResponse({ access_token: 'tenant-a-meta-token' });
  if (href.includes('/200000000001?fields=')) {
    assert.equal(options.headers.authorization, 'Bearer tenant-a-meta-token');
    return jsonResponse({ id: '200000000001', display_phone_number: '+57 300 000 0000', verified_name: 'Tienda Contrato' });
  }
  if (href.includes('/300000000001/phone_numbers')) {
    assert.equal(options.headers.authorization, 'Bearer tenant-a-meta-token');
    return jsonResponse({ data: [{ id: '200000000001' }] });
  }
  if (href.includes('/300000000001/subscribed_apps')) {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer tenant-a-meta-token');
    return jsonResponse({ success: true });
  }
  if (href.includes('/200000000001/register')) {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer tenant-a-meta-token');
    assert.deepEqual(JSON.parse(options.body), { messaging_product: 'whatsapp', pin: '123456' });
    return jsonResponse({ success: true });
  }
  throw new Error(`Unexpected Graph API request: ${href}`);
};

const { controlPlane, secretVault, store } = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
});

try {
  store.mutate((state) => {
    const tenant = state.tenants.find((item) => item.id === 'andina');
    tenant.config.whatsapp.phoneNumberId = null;
  });
  controlPlane.mockActivateSubscription('andina');
  controlPlane.saveWhatsAppOnboardingIntent('andina', {
    setupPath: 'new_business',
    hasWhatsAppBusiness: false,
    businessName: 'Tienda Contrato',
    contactPhone: '+57 300 000 0000',
  });
  const subscriptionBeforeReset = controlPlane.getTenantBundle('andina').subscription;
  const reset = controlPlane.resetWhatsAppOnboarding('andina', { actor: { id: 'owner-contract' } });
  assert.equal(reset.whatsappOnboarding.setupPath, null);
  assert.equal(reset.whatsappOnboarding.status, 'needs_path');
  assert.equal(reset.subscription.id, subscriptionBeforeReset.id);
  assert.equal(store.getState().whatsappOnboardingByTenant.andina, undefined);
  assert.ok(store.getState().auditEvents.some((event) => event.action === 'whatsapp.onboarding.reset'));

  controlPlane.saveWhatsAppOnboardingIntent('andina', {
    setupPath: 'new_business',
    hasWhatsAppBusiness: false,
    businessName: 'Tienda Contrato',
    contactPhone: '+57 300 000 0000',
  });
  const pendingApproval = controlPlane.getWhatsAppOnboarding('andina');
  assert.equal(pendingApproval.canAutomate, false);
  assert.equal(pendingApproval.reason, 'meta_app_review_pending');
  assert.equal(controlPlane.startWhatsAppEmbeddedSignup('andina').mode, 'guided_manual');
  await assert.rejects(
    controlPlane.completeWhatsAppEmbeddedSignup('andina', {
      code: 'embedded-code-contract',
      wabaId: '300000000001',
      phoneNumberId: '200000000001',
    }),
    (error) => error.statusCode === 428 && error.code === 'meta_app_review_pending',
  );
  assert.equal(graphCalls.length, 0);
  process.env.META_WHATSAPP_ADVANCED_ACCESS_APPROVED = 'true';
  const result = await controlPlane.completeWhatsAppEmbeddedSignup('andina', {
    code: 'embedded-code-contract',
    wabaId: '300000000001',
    phoneNumberId: '200000000001',
    registrationPin: '123456',
  });

  assert.equal(result.tenant.config.whatsapp.phoneNumberId, '200000000001');
  assert.equal(result.tenant.config.whatsapp.wabaId, '300000000001');
  assert.equal(secretVault.readSecret(result.tenant.config.whatsapp.accessTokenRef), 'tenant-a-meta-token');
  assert.ok(Date.parse(result.tenant.config.whatsapp.accessTokenIssuedAt));
  assert.ok(Date.parse(result.tenant.config.whatsapp.accessTokenExpiresAt));
  assert.equal(result.whatsappOnboarding.token.status, 'valid');
  assert.equal(graphCalls.length, 5);
  assert.ok(store.getState().auditEvents.some((event) => event.action === 'whatsapp.embedded_signup.completed'));
  const renewal = controlPlane.startWhatsAppEmbeddedSignup('andina', { purpose: 'renew' });
  assert.equal(renewal.mode, 'embedded_signup');
  assert.equal(renewal.launch.graphApiVersion, 'v26.0');
  assert.throws(
    () => controlPlane.startWhatsAppEmbeddedSignup('andina'),
    (error) => error.code === 'whatsapp_channel_already_connected' && error.statusCode === 409,
  );
  assert.throws(
    () => controlPlane.resetWhatsAppOnboarding('andina'),
    (error) => error.code === 'whatsapp_channel_already_connected' && error.statusCode === 409,
  );
  console.log('WhatsApp Embedded Signup contract tests passed');
} finally {
  await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
  global.fetch = originalFetch;
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
