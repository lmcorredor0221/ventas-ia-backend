import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-meta-self-service-'));
const originalFetch = global.fetch;
const env = {
  META_APP_ID: 'app', META_APP_SECRET: 'secret', SECRET_ENCRYPTION_KEY: 'contract-only',
  META_WHATSAPP_ADVANCED_ACCESS_APPROVED: 'true', META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED: 'true',
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: 'config', WHATSAPP_WEBHOOK_PUBLIC_URL: 'https://example.test/webhooks/whatsapp',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
};
const previous = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
Object.assign(process.env, env);
let onBizApp = true, businessId = 'business-a', expiry = 3600, failSubscribe = false, failSync = false, platform = 'CLOUD_API', uncertainSync = false;
let phones = [{ id: 'phone-a', display_phone_number: '+57 300 000 0001', verified_name: 'Tienda A' }];
const calls = [];
global.fetch = async (url, options = {}) => {
  const u = new URL(url);
  calls.push({ path: u.pathname, method: options.method ?? 'GET' });
  let response;
  if (u.pathname.endsWith('/oauth/access_token')) response = { access_token: 'contract-business-token', ...(expiry === undefined ? {} : { expires_in: expiry }) };
  else if (u.pathname.endsWith('/me')) response = { client_business_id: businessId };
  else if (u.pathname.endsWith('/phone_numbers')) response = { data: phones };
  else if (u.pathname.endsWith('/subscribed_apps')) {
    if (failSubscribe) return new Response(JSON.stringify({ error: { message: 'Unavailable' } }), { status: 503 });
    response = { success: true };
  } else if (u.pathname.endsWith('/register')) {
    assert.equal(onBizApp, false, 'never register an app/coexistence phone');
    response = { success: true };
  } else if (u.pathname.endsWith('/smb_app_data')) {
    if (uncertainSync) throw new TypeError('Network interrupted after request');
    if (failSync && JSON.parse(options.body).sync_type === 'history') return new Response(JSON.stringify({ error: { message: 'Temporary failure' } }), {status:503});
    response = { request_id: `sync-${JSON.parse(options.body).sync_type}` };
  }
  else if (phones.some(p => u.pathname.endsWith(`/${p.id}`))) response = { ...phones.find(p => u.pathname.endsWith(`/${p.id}`)), is_on_biz_app: onBizApp, platform_type: platform };
  else throw new Error(`Unexpected Graph endpoint: ${u.pathname}`);
  return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
};
const { store, controlPlane } = await createAppAsync({ dataFile: path.join(tempDir, 'state.json'), storageDriver: 'json' });
const owner = { actorId: 'owner-a' };
const start = (tenantId, setupPath, context = owner) => {
  controlPlane.saveWhatsAppOnboardingIntent(tenantId, { setupPath });
  return controlPlane.startWhatsAppEmbeddedSignup(tenantId, context);
};
const finish = (tenantId, launch, patch = {}, context = owner) => controlPlane.completeWhatsAppEmbeddedSignup(tenantId, {
  attemptId: launch.attemptId, code: 'code-a', wabaId: 'waba-a', businessId: 'business-a',
  event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', ...patch,
}, context);
try {
  store.mutate(s => { for (const t of s.tenants) t.config.whatsapp.phoneNumberId = null; });
  for (const id of ['andina', 'norte']) controlPlane.mockActivateSubscription(id);
  process.env.META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED = 'false';
  assert.equal(controlPlane.getWhatsAppOnboarding('andina').canAutomate, false);
  assert.equal(controlPlane.getWhatsAppOnboarding('andina').reason, 'meta_login_review_pending');
  process.env.META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED = 'true';
  const a = start('andina', 'business_app_existing').launch;
  assert.ok(a.attemptId);
  assert.equal(a.setupPath, 'business_app_existing');
  await assert.rejects(finish('andina', a, {}, { actorId: 'other-owner' }), e => e.code === 'whatsapp_signup_attempt_invalid');
  await assert.rejects(finish('norte', a), e => e.code === 'whatsapp_signup_attempt_invalid');
  const b = start('andina', 'business_app_existing').launch;
  await assert.rejects(finish('andina', a), e => e.code === 'whatsapp_signup_attempt_invalid');
  const connected = await finish('andina', b);
  assert.equal(connected.tenant.config.whatsapp.phoneNumberId, 'phone-a');
  assert.equal(connected.tenant.config.whatsapp.businessId, 'business-a');
  assert.equal(connected.whatsappOnboarding.token.status, 'expiring_soon');
  assert.equal(calls.some(c => c.path.endsWith('/register')), false);
  assert.equal(calls.filter(c => c.path.endsWith('/smb_app_data')).length, 2);
  const beforeReplay = calls.length;
  await finish('andina', b);
  assert.equal(calls.length, beforeReplay, 'completion retry must not reuse a one-time code');
  const north = start('norte', 'business_app_existing').launch;
  await assert.rejects(finish('norte', north), e => e.code === 'whatsapp_phone_already_bound');
  assert.equal(store.getState().tenants.find(t => t.id === 'norte').config.whatsapp.phoneNumberId, null);

  // A WABA with several phones requires an explicit selection, never the first phone.
  phones = [{ id: 'phone-b', display_phone_number: '+57 300 000 0002' }, { id: 'phone-c', display_phone_number: '+57 300 000 0003' }];
  const selectLaunch = start('norte', 'business_app_existing').launch;
  const selection = await finish('norte', selectLaunch);
  assert.equal(selection.requiresPhoneSelection, true);
  assert.equal(selection.phones.length, 2);
  assert.equal(JSON.stringify(selection).includes('contract-business-token'), false);
  const exchanged = calls.filter(c => c.path.endsWith('/oauth/access_token')).length;
  const selected = await controlPlane.completeWhatsAppEmbeddedSignup('norte', { attemptId: selectLaunch.attemptId, phoneNumberId: 'phone-c' }, owner);
  assert.equal(selected.tenant.config.whatsapp.phoneNumberId, 'phone-c');
  assert.equal(calls.filter(c => c.path.endsWith('/oauth/access_token')).length, exchanged);

  // Renewing must not move an existing tenant onto a different phone.
  const renew = controlPlane.startWhatsAppEmbeddedSignup('andina', { ...owner, purpose: 'renew' }).launch;
  await assert.rejects(finish('andina', renew, { phoneNumberId: 'phone-b' }), e => e.code === 'whatsapp_renewal_asset_mismatch');

  const c = controlPlane.createTenant({ storeName: 'Nueva tienda contrato', ownerEmail: 'new@example.test' }).tenant.id;
  controlPlane.mockActivateSubscription(c);
  phones = [{ id: 'phone-new' }]; onBizApp = false; expiry = undefined;
  const fresh = start(c, 'new_business').launch;
  await assert.rejects(finish(c, fresh, { event: 'FINISH', phoneNumberId: 'phone-new' }), e => e.code === 'whatsapp_registration_pin_required');
  failSubscribe = true;
  await assert.rejects(finish(c, fresh, { event: 'FINISH', phoneNumberId: 'phone-new', registrationPin: '123456' }));
  failSubscribe = false;
  const final = await finish(c, fresh, { event: 'FINISH', phoneNumberId: 'phone-new', registrationPin: '123456' });
  assert.equal(final.whatsappOnboarding.token.expiresAt, null, 'never invent an expiry when Meta omitted it');
  assert.equal(final.whatsappOnboarding.token.status, 'unknown');
  assert.equal(calls.filter(c => c.path.endsWith('/register')).length, 1);
  const recovery = controlPlane.createTenant({storeName:'Coexistencia recuperable',ownerEmail:'recovery@example.test'}).tenant.id;
  controlPlane.mockActivateSubscription(recovery);
  phones=[{id:'phone-recovery'}]; onBizApp=true; failSync=true;
  const pending = await finish(recovery,start(recovery,'business_app_existing').launch);
  assert.equal(pending.syncPending,true);
  assert.equal(pending.whatsappOnboarding.connected,true);
  const syncCalls = calls.filter(c=>c.path.endsWith('/smb_app_data')).length;
  store.mutate(s=>s.whatsappOnboardingByTenant[recovery].attempt.expiresAt=new Date(0).toISOString());
  failSync=false;
  const recovered=await controlPlane.retryWhatsAppCoexistenceSync(recovery);
  assert.equal(recovered.syncPending,undefined);
  assert.equal(calls.filter(c=>c.path.endsWith('/smb_app_data')).length,syncCalls+1,'do not repeat successful contacts sync');
  await controlPlane.retryWhatsAppCoexistenceSync(recovery);
  assert.equal(calls.filter(c=>c.path.endsWith('/smb_app_data')).length,syncCalls+1);
  const edge = controlPlane.createTenant({storeName:'Cloud pendiente',ownerEmail:'edge@example.test'}).tenant.id;
  controlPlane.mockActivateSubscription(edge);
  phones=[{id:'phone-edge'}]; onBizApp=false; platform='NOT_APPLICABLE';
  const edgeLaunch = start(edge,'cloud_api_existing').launch;
  const beforeEdge=calls.filter(c=>c.method==='POST').length;
  await assert.rejects(finish(edge,edgeLaunch),e=>e.code==='whatsapp_cloud_phone_required');
  assert.equal(calls.filter(c=>c.method==='POST').length,beforeEdge,'reject unregistered cloud assets before provider mutations');
  platform='CLOUD_API'; onBizApp=true; uncertainSync=true;
  const unknown=await finish(edge,start(edge,'business_app_existing').launch);
  assert.equal(unknown.whatsappOnboarding.sync.error,'whatsapp_sync_outcome_unknown');
  const unknownCalls=calls.length;
  await assert.rejects(controlPlane.retryWhatsAppCoexistenceSync(edge),e=>e.code==='whatsapp_sync_outcome_unknown');
  assert.equal(calls.length,unknownCalls,'never repeat a one-time request whose outcome is unknown');
  console.log('WhatsApp self-service contracts passed: external gate, attempts, coexistence, isolation, selection, retry and renewal');
} finally {
  await store.close?.();
  global.fetch = originalFetch;
  for (const [k,v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
