import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-backend-'));
const { app, store } = await createAppAsync({ dataFile: path.join(tempDir, 'store.json'), storageDriver: 'json' });
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

  const coffeeRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998877',
    profileName: 'Prueba Local',
    text: 'Para un domicilio, tienes cafe tostado premium?',
  });
  assert.equal(coffeeRun.result.plan.intent, 'catalog_query');
  assert.equal(coffeeRun.result.plan.executionMode, 'codex_simulated_deepseek');
  assert.equal(coffeeRun.result.plan.simulatedBy, 'codex');
  assert.ok(coffeeRun.conversation.messages.at(-1).text.includes('Cafe premium tostado 250g'));
  assert.ok(coffeeRun.conversation.messages.at(-1).text.includes('Cuantas unidades'));

  const juiceRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998877',
    profileName: 'Prueba Local',
    text: 'Para un domicilio, que jugos tiene?',
  });
  assert.equal(juiceRun.result.plan.intent, 'catalog_query');
  assert.equal(juiceRun.result.plan.executionMode, 'codex_simulated_deepseek');
  assert.ok(juiceRun.conversation.messages.at(-1).text.includes('Cifrut granadilla'));
  assert.ok(juiceRun.conversation.messages.at(-1).text.includes('Jugo Hit mango'));
  assert.ok(juiceRun.conversation.messages.at(-1).text.includes('Cual quieres y cuantas unidades'));

  const orderRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998877',
    profileName: 'Prueba Local',
    text: 'Hola, para un domicilio, me regalas por favor 3 chocorramos y cifrut de granadilla',
  });
  assert.equal(orderRun.result.plan.intent, 'delivery_order');
  assert.ok(orderRun.result.plan.missingFields.includes('quantity:Cifrut granadilla'));
  assert.equal(orderRun.conversation.orderDraft.items.length, 2);
  assert.ok(orderRun.conversation.messages.at(-1).text.includes('cantidad de Cifrut granadilla'));

  const quantityRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998877',
    profileName: 'Prueba Local',
    text: '2',
  });
  assert.equal(quantityRun.result.summary, 'Order clarified and quote sent');
  assert.equal(quantityRun.conversation.orderDraft.missingFields.length, 0);

  const confirmRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998877',
    profileName: 'Prueba Local',
    text: 'Confirmo el pedido',
  });
  assert.equal(confirmRun.result.plan.intent, 'order_confirmation');
  assert.ok(confirmRun.conversation.orderId);

  const newCustomerRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112233',
    profileName: 'Cliente Nuevo',
    text: 'Quiero 3 chocorramos para domicilio',
  });
  assert.equal(newCustomerRun.result.plan.intent, 'delivery_order');
  assert.ok(newCustomerRun.result.plan.missingFields.includes('customer_name'));
  assert.ok(newCustomerRun.result.plan.missingFields.includes('delivery_address'));
  const savedProfile = await getJson(`${base}/api/ops/overview?tenantId=andina`);
  assert.ok(savedProfile.tools.some((tool) => tool.name === 'google_sheets_customer_profile_lookup'));
  assert.ok(savedProfile.usage.metrics.agent_interactions >= 7);
  assert.ok(savedProfile.usage.metrics.deliveries_confirmed >= 1);
  assert.ok(savedProfile.usage.metrics.tool_calls >= 1);
  assert.ok(savedProfile.usage.metrics.llm_total_tokens >= 1);

  const unknownOrderRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112244',
    profileName: 'Producto Desconocido',
    text: 'Buenas tardes, para un domicilio, me regalas por favor un six pack de club colombia y un paquete de malboro sandia.',
  });
  assert.equal(unknownOrderRun.result.summary, 'Structured order escalated to human');
  assert.equal(unknownOrderRun.conversation.status, 'blocked');
  assert.ok(unknownOrderRun.conversation.orderDraft.missingFields.some((field) => field.startsWith('product:')));
  assert.ok(unknownOrderRun.conversation.messages.at(-1).text.match(/valid(ar|o)|validación/));

  store.mutate((state) => {
    const chocoramo = state.productsByTenant.andina.find((product) => product.sku === 'AND-CHO-01');
    chocoramo.stock = 0;
  });
  const outOfStockRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112245',
    profileName: 'Stock Cero',
    text: 'Quiero 1 chocoramo para domicilio',
  });
  assert.equal(outOfStockRun.result.summary, 'Structured order escalated to human');
  assert.ok(outOfStockRun.conversation.orderDraft.missingFields.includes('stock:Chocoramo'));
  assert.ok(outOfStockRun.conversation.messages.at(-1).text.match(/valid(ar|o)|validación/));

  const mixedOrderRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112246',
    profileName: 'Pedido Mixto',
    text: 'Buenas tardes, para un domicilio, me regalas favor 5000 de calchichon y una coca-cola 350',
  });
  assert.equal(mixedOrderRun.result.summary, 'Structured order escalated to human');
  assert.ok(mixedOrderRun.conversation.orderDraft.missingFields.some((field) => field.includes('calchichon')));
  assert.ok(mixedOrderRun.conversation.messages.at(-1).text.match(/valid(ar|o)|validación/));

  const realGreetingRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112247',
    profileName: 'Conversacion Real',
    text: 'Buenas noches para un domicilio',
  });
  assert.equal(realGreetingRun.result.summary, 'Structured order needs clarification');
  assert.equal(realGreetingRun.conversation.status, 'live');
  assert.ok(realGreetingRun.conversation.orderDraft.missingFields.includes('order_items'));
  assert.ok(realGreetingRun.conversation.messages.at(-1).text.includes('que productos quieres pedir'));

  const paymentPreferenceRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112247',
    profileName: 'Conversacion Real',
    text: 'Pago con tarjeta débito',
  });
  assert.equal(paymentPreferenceRun.result.summary, 'Order still needs clarification');
  assert.equal(paymentPreferenceRun.conversation.orderDraft.paymentMethod, 'card_terminal');

  const realLargeOrderRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573001112247',
    profileName: 'Conversacion Real',
    text: 'Me regalas por favor un paquete de Malboro sandía, 3 chocorramos y un brownie mamai de arequipe, 10 ramitos X2, ponque Bimbo mora / tres leches, 2 tacos de ducales',
  });
  assert.equal(realLargeOrderRun.result.summary, 'Structured order escalated to human');
  assert.ok(realLargeOrderRun.conversation.orderDraft.items.length >= 4);
  assert.ok(realLargeOrderRun.conversation.orderDraft.missingFields.some((field) => field.includes('malboro')));
  assert.ok(realLargeOrderRun.conversation.messages.at(-1).text.match(/valid(ar|o)|validación/));

  const usage = await getJson(`${base}/api/usage?tenantId=andina`);
  assert.equal(usage.limits.includedDeliveries, 1000);
  assert.equal(usage.limits.includedInteractions, 5000);
  assert.ok(usage.percentages.interactions > 0);

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

  const unknownWhatsappTenant = await postJson(`${base}/webhooks/whatsapp`, {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: '999999999999' },
          contacts: [{ profile: { name: 'Cliente WA desconocido' } }],
          messages: [{
            id: 'wamid-unknown-tenant',
            from: '573001110000',
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: 'Buenas, tienes chocoramo?' },
          }],
        },
      }],
    }],
  }, { expectedStatus: 404 });
  assert.equal(unknownWhatsappTenant.code, 'whatsapp_tenant_not_found');

  const createdTenant = await postJson(`${base}/api/saas/tenants`, {
    storeName: 'Tienda Prueba SaaS',
    ownerEmail: 'dueno@example.com',
    ownerName: 'Dueño Local',
    whatsappNumber: '+57 300 000 0000',
  }, { expectedStatus: 201 });
  assert.equal(createdTenant.status.readyForOperation, false);
  assert.equal(createdTenant.subscription.status, 'pending_payment');

  const billingPlans = await getJson(`${base}/api/billing/plans`);
  assert.ok(billingPlans.plans.some((plan) => plan.id === 'ventas_ia_1000_domicilios' && plan.isActive));

  const billingStatusBeforeCheckout = await getJson(`${base}/api/billing/status?tenantId=${createdTenant.tenant.id}`);
  assert.equal(billingStatusBeforeCheckout.plan.includedDeliveries, 1000);
  assert.equal(billingStatusBeforeCheckout.plan.includedInteractions, 5000);
  assert.equal(billingStatusBeforeCheckout.actions.canStartCheckout, true);

  const previousMercadoPagoSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  process.env.MERCADOPAGO_WEBHOOK_SECRET = 'mp-webhook-test-secret';
  try {
    const dataId = 'mp-preapproval-smoke';
    const requestId = 'req-mp-smoke';
    const timestamp = '1742505638683';
    await postJson(`${base}/webhooks/mercadopago?type=subscription_preapproval&data.id=${dataId}`, {
      type: 'subscription_preapproval',
      data: { id: dataId },
      external_reference: createdTenant.tenant.id,
      status: 'pending',
    }, {
      expectedStatus: 401,
      headers: {
        'x-signature': `ts=${timestamp},v1=invalid`,
        'x-request-id': requestId,
      },
    });
    const signature = mercadoPagoSignature({ dataId, requestId, timestamp, secret: process.env.MERCADOPAGO_WEBHOOK_SECRET });
    const mercadoPagoWebhook = await postJson(`${base}/webhooks/mercadopago?type=subscription_preapproval&data.id=${dataId}`, {
      type: 'subscription_preapproval',
      data: { id: dataId },
      external_reference: createdTenant.tenant.id,
      status: 'pending',
    }, {
      headers: {
        'x-signature': `ts=${timestamp},v1=${signature}`,
        'x-request-id': requestId,
      },
    });
    assert.equal(mercadoPagoWebhook.accepted, true);
  } finally {
    if (previousMercadoPagoSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    else process.env.MERCADOPAGO_WEBHOOK_SECRET = previousMercadoPagoSecret;
  }

  const adminOverview = await getJson(`${base}/api/admin/overview`);
  assert.equal(adminOverview.platform.llm.provider, 'deepseek');
  assert.ok(adminOverview.tenants.some((tenant) => tenant.id === createdTenant.tenant.id));

  const webhookAdmin = await getJson(`${base}/api/admin/webhooks?provider=mercado_pago`);
  assert.ok(webhookAdmin.summary.total >= 1);
  assert.ok(webhookAdmin.events.some((event) => event.provider === 'mercado_pago'));

  const adminPlans = await getJson(`${base}/api/admin/billing/plans`);
  assert.ok(adminPlans.plans.some((plan) => plan.id === 'ventas_ia_1000_domicilios'));

  const createdAdminPlan = await postJson(`${base}/api/admin/billing/plans`, {
    name: 'Plan Crecimiento Smoke',
    description: 'Plan creado desde contrato admin',
    amount: 129000,
    includedDeliveries: 1500,
    includedInteractions: 7500,
    trialEnabled: true,
    trialDays: 5,
    graceDays: 7,
    isActive: true,
    isDefault: false,
  }, { expectedStatus: 201 });
  assert.equal(createdAdminPlan.name, 'Plan Crecimiento Smoke');
  assert.equal(createdAdminPlan.trialDays, 5);
  const disabledAdminPlan = await patchJson(`${base}/api/admin/billing/plans/${createdAdminPlan.id}`, {
    isActive: false,
    trialEnabled: false,
    trialDays: 0,
  });
  assert.equal(disabledAdminPlan.isActive, false);
  assert.equal(disabledAdminPlan.trialEnabled, false);
  const defaultAdminPlan = await patchJson(`${base}/api/admin/billing/plans/ventas_ia_1000_domicilios`, {
    isDefault: true,
    trialEnabled: false,
    graceDays: 5,
  });
  assert.equal(defaultAdminPlan.isDefault, true);
  assert.equal(defaultAdminPlan.graceDays, 5);

  const billingJobTenant = await postJson(`${base}/api/saas/tenants`, {
    storeName: 'Tienda Job Billing',
    ownerEmail: 'job@example.com',
    ownerName: 'Job Local',
  }, { expectedStatus: 201 });
  store.mutate((state) => {
    const subscription = state.subscriptionsByTenant[billingJobTenant.tenant.id];
    subscription.status = 'pending_payment';
    subscription.checkoutUrl = '/checkout-expired';
    subscription.checkoutExpiresAt = '2026-01-02T00:00:00.000Z';
  });
  const expiredCheckoutJob = await postJson(`${base}/api/admin/billing/jobs/run`, {
    now: '2026-01-10T00:00:00.000Z',
  });
  assert.ok(expiredCheckoutJob.checkoutExpired >= 1);
  assert.equal(store.getState().subscriptionsByTenant[billingJobTenant.tenant.id].status, 'expired');

  store.mutate((state) => {
    const subscription = state.subscriptionsByTenant[billingJobTenant.tenant.id];
    Object.assign(subscription, {
      status: 'active',
      currentPeriodStart: '2026-01-01T00:00:00.000Z',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      nextBillingDate: '2026-02-01T00:00:00.000Z',
      checkoutExpiresAt: null,
      graceDays: 5,
      graceStartedAt: null,
      graceEndsAt: null,
      suspendedAt: null,
    });
    const tenant = state.tenants.find((item) => item.id === billingJobTenant.tenant.id);
    tenant.status = 'active';
    tenant.lifecycle = { ...(tenant.lifecycle ?? {}), access: 'active', subscriptionStatus: 'active' };
  });
  const graceJob = await postJson(`${base}/api/admin/billing/jobs/run`, {
    now: '2026-02-02T00:00:00.000Z',
  });
  assert.ok(graceJob.enteredGrace >= 1);
  assert.equal(store.getState().subscriptionsByTenant[billingJobTenant.tenant.id].status, 'grace_period');

  store.mutate((state) => {
    state.subscriptionsByTenant[billingJobTenant.tenant.id].graceEndsAt = '2026-02-03T00:00:00.000Z';
  });
  const suspendedJob = await postJson(`${base}/api/admin/billing/jobs/run`, {
    now: '2026-02-04T00:00:00.000Z',
  });
  assert.ok(suspendedJob.suspended >= 1);
  assert.equal(store.getState().subscriptionsByTenant[billingJobTenant.tenant.id].status, 'suspended');

  const syncBilling = await postJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/sync`, {});
  assert.equal(syncBilling.statusAfter, 'pending_payment');

  const discount = await postJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/discounts`, {
    discountType: 'percentage',
    discountValue: 20,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    reason: 'Piloto comercial',
  }, { expectedStatus: 201 });
  assert.equal(discount.status, 'active');

  const exception = await postJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/exceptions`, {
    reason: 'Soporte piloto',
    expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  }, { expectedStatus: 201 });
  assert.equal(exception.status, 'active');

  const blockedRun = await postJson(`${base}/api/agent/run`, {
    tenantId: createdTenant.tenant.id,
    waId: '573001010101',
    profileName: 'Cliente Bloqueado',
    text: 'tienes chocoramo?',
  }, { expectedStatus: 402 });
  assert.equal(blockedRun.code, 'tenant_not_operational');

  const checkout = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/subscription/checkout`, {
    payerEmail: 'dueno@example.com',
  });
  assert.equal(checkout.mode, 'sandbox_contract');
  assert.equal(checkout.subscription.status, 'pending_payment');
  assert.ok(checkout.subscription.checkoutExpiresAt);

  const continuedCheckout = await postJson(`${base}/api/billing/continue-checkout`, {
    tenantId: createdTenant.tenant.id,
    payerEmail: 'dueno@example.com',
  });
  assert.equal(continuedCheckout.reused, true);
  assert.equal(continuedCheckout.checkoutUrl, checkout.checkoutUrl);

  const subscription = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/subscription/mock-activate`, {});
  assert.equal(subscription.subscription.status, 'active');
  assert.ok(subscription.subscription.currentPeriodEnd);

  const payments = await getJson(`${base}/api/billing/payments?tenantId=${createdTenant.tenant.id}`);
  assert.ok(payments.payments.some((payment) => payment.status === 'approved'));

  const funnel = await getJson(`${base}/api/admin/billing/funnel`);
  assert.ok(funnel.stages.some((stage) => stage.stage === 'checkout_started' && stage.total >= 1));

  const oauthStart = await getJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/google/oauth/start`);
  assert.ok(oauthStart.state);
  assert.ok(oauthStart.authorizationUrl.includes('access_type=offline'));

  const oauthCallback = await getJson(`${base}/api/saas/google/oauth/callback?state=${oauthStart.state}&code=dev-mock-code&mockAccountEmail=dueno%40example.com`);
  assert.equal(oauthCallback.connection.status, 'connected');
  assert.equal(oauthCallback.connection.mode, 'sandbox_contract');

  const provision = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/google/provision`, {});
  assert.equal(provision.workspace.status, 'provisioned');
  assert.ok(provision.workspace.spreadsheet.sheets.some((sheet) => sheet.name === 'Catalogo'));
  assert.ok(provision.workspace.spreadsheet.sheets.some((sheet) => sheet.name === 'Clientes'));
  assert.ok(provision.workspace.spreadsheet.sheets.some((sheet) => sheet.name === 'Pedidos'));

  const validationBeforeWhatsapp = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/validate`, {});
  assert.equal(validationBeforeWhatsapp.readyForActivation, false);
  assert.ok(validationBeforeWhatsapp.checks.some((check) => check.key === 'whatsapp' && check.ok === false));

  const whatsappStatus = await getJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/whatsapp/status`);
  assert.equal(whatsappStatus.status, 'needs_path');
  assert.equal(whatsappStatus.canAutomate, false);

  const whatsappIntent = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/whatsapp/intent`, {
    setupPath: 'business_app_existing',
    hasWhatsAppBusiness: true,
    businessName: 'Tienda Prueba SaaS',
    contactPhone: '+57 300 000 0000',
  });
  assert.equal(whatsappIntent.setupPath, 'business_app_existing');

  const whatsappStart = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/whatsapp/embedded-signup/start`, {});
  assert.equal(whatsappStart.ready, false);
  assert.equal(whatsappStart.mode, 'guided_manual');
  assert.ok(whatsappStart.manualSteps.some((step) => step.key === 'phone'));

  const whatsappBinding = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/whatsapp/binding`, {
    phoneNumberId: '200000000001',
    phoneNumberIdRef: `${createdTenant.tenant.id.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
    accessTokenRef: `${createdTenant.tenant.id.toUpperCase()}_WHATSAPP_ACCESS_TOKEN_REF`,
    wabaId: '300000000001',
  });
  assert.equal(whatsappBinding.tenant.config.whatsapp.phoneNumberId, '200000000001');
  assert.equal(whatsappBinding.whatsappOnboarding.status, 'connected');

  const validation = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/validate`, {});
  assert.equal(validation.readyForActivation, true);

  const activated = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/activate`, {});
  assert.equal(activated.status.readyForOperation, true);

  const activatedRun = await postJson(`${base}/api/agent/run`, {
    tenantId: createdTenant.tenant.id,
    waId: '573001010101',
    profileName: 'Cliente Activo',
    text: 'tienes chocoramo?',
  });
  assert.equal(activatedRun.duplicate, false);

  const auditActions = new Set(store.getState().auditEvents.map((event) => event.action));
  for (const action of [
    'subscription.checkout.created',
    'subscription.activated',
    'google.oauth.started',
    'google.oauth.connected',
    'google.workspace.provisioned',
    'whatsapp.onboarding.intent_saved',
    'whatsapp.embedded_signup.started',
    'whatsapp.connection.bound',
    'tenant.validation.completed',
    'tenant.activated',
    'tool.google_sheets_order_write',
    'tool.human_handoff.created',
    'tool.whatsapp_business_messaging.sent',
  ]) {
    assert.ok(auditActions.has(action), `missing audit action ${action}`);
  }

  console.log('Backend smoke tests passed');
} finally {
  server.close();
  await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

async function postJson(url, body, { expectedStatus = 200, headers = {} } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text);
}

function mercadoPagoSignature({ dataId, requestId, timestamp, secret }) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

async function patchJson(url, body, { expectedStatus = 200 } = {}) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text);
}
