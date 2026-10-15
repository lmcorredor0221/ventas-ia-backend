import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-backend-'));
const { app, store, events, controlPlane, runtime } = await createAppAsync({ dataFile: path.join(tempDir, 'store.json'), storageDriver: 'json' });
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  const health = await getJson(`${base}/health`);
  assert.equal(health.ok, true);

  const overview = await getJson(`${base}/api/ops/overview?tenantId=andina`);
  assert.ok(overview.conversations.length > 0);
  assert.ok(overview.tools.some((tool) => tool.name === 'google_sheets_read_table'));

  store.mutate((state) => {
    state.conversations.unshift({
      id: 'wa-smoke-decision',
      customer: 'Caso Decision Smoke',
      tenantId: 'andina',
      stage: 'payment',
      zone: 'payment',
      status: 'live',
      value: '$42.000',
      progress: 72,
      need: 'Validar una decision humana creada por evento critico.',
      nextStep: 'Esperar aprobacion humana antes de registrar.',
      humanReason: '',
      lastTool: 'transactional_write',
      avatar: 'DS',
      path: ['whatsapp', 'agent', 'payment'],
      messages: [],
    });
  });
  const decisionEvent = events.emit({
    type: 'decision.requested',
    tenantId: 'andina',
    conversationId: 'wa-smoke-decision',
    detail: 'Registrar escritura transaccional del pedido',
  });
  const linkedDecisionRequests = store.getState().pendingRequests.filter((request) => (
    request.conversationId === 'wa-smoke-decision' && request.type === 'decision.requested' && request.status === 'pending'
  ));
  assert.equal(linkedDecisionRequests.length, 1);
  assert.equal(decisionEvent.metadata.requestId, linkedDecisionRequests[0].id);
  assert.equal(decisionEvent.metadata.autoLinkedHumanRequest, true);
  events.emit({
    type: 'decision.requested',
    tenantId: 'andina',
    conversationId: 'wa-smoke-decision',
    detail: 'Registrar escritura transaccional del pedido',
  });
  const dedupedDecisionRequests = store.getState().pendingRequests.filter((request) => (
    request.conversationId === 'wa-smoke-decision' && request.type === 'decision.requested' && request.status === 'pending'
  ));
  assert.equal(dedupedDecisionRequests.length, 1);
  const decisionConversation = store.getState().conversations.find((conversation) => conversation.id === 'wa-smoke-decision');
  assert.equal(decisionConversation.status, 'approval_required');
  assert.equal(decisionConversation.zone, 'approval');
  store.mutate((state) => {
    const request = state.pendingRequests.find((item) => item.id === linkedDecisionRequests[0].id);
    request.contextSnapshot = { customerWaId: '573001119900' };
  });
  const resolvedDecisionFallback = await postJson(`${base}/api/pending-requests/${encodeURIComponent(linkedDecisionRequests[0].id)}/resolve`, {
    outcome: 'approved',
    note: 'Listo, ya lo revisa la tienda.',
    approverId: 'smoke-operator',
    responseMode: 'whatsapp',
  });
  assert.equal(resolvedDecisionFallback.customerReply.mode, 'whatsapp');
  assert.equal(resolvedDecisionFallback.customerReply.deliveryStatus, 'mock_accepted');

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

  const manualCaseRun = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998899',
    profileName: 'Caso Manual',
    text: 'Tienes cafe tostado premium?',
  });
  const manualStarted = await postJson(`${base}/api/conversations/${encodeURIComponent(manualCaseRun.conversation.id)}/manual-whatsapp`, {});
  assert.equal(manualStarted.status, 'manual_active');
  assert.equal(manualStarted.manualMode, 'whatsapp_external');
  assert.equal(manualStarted.aiPaused, true);
  assert.ok(manualStarted.messages.at(-1).text.includes('continua de manera manual'));
  store.mutate((state) => {
    const conversation = state.conversations.find((item) => item.id === manualStarted.id);
    conversation.orderDraft = { items: [{ catalogQuery: 'Pedido anterior que no se debe heredar' }], status: 'not_confirmed' };
    conversation.manualLastActivityAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  });
  const expiredManualCases = await runtime.closeExpiredManualCases();
  assert.ok(expiredManualCases.includes(manualStarted.id));
  const closedManual = store.getState().conversations.find((item) => item.id === manualStarted.id);
  assert.equal(closedManual.status, 'closed_no_confirmation');
  assert.equal(closedManual.caseStatus, 'closed_no_confirmation');
  assert.equal(closedManual.orderDraft.status, 'not_confirmed');
  assert.ok(closedManual.messages.at(-1).text.includes('Pedido no confirmado'));

  const newCaseAfterClosure = await postJson(`${base}/api/agent/run`, {
    tenantId: 'andina',
    waId: '573009998899',
    profileName: 'Caso Manual',
    text: 'Quiero 1 chocoramo para domicilio',
  });
  assert.notEqual(newCaseAfterClosure.conversation.id, manualStarted.id);
  assert.equal(newCaseAfterClosure.conversation.orderDraft.items[0].catalogQuery.toLowerCase(), 'chocoramo');
  assert.equal(newCaseAfterClosure.conversation.orderDraft.items.some((item) => item.catalogQuery === 'Pedido anterior que no se debe heredar'), false);
  const activeConversationIds = (await getJson(`${base}/api/ops/overview?tenantId=andina`)).conversations.map((item) => item.id);
  assert.equal(activeConversationIds.includes(manualStarted.id), false);
  assert.equal(activeConversationIds.includes(newCaseAfterClosure.conversation.id), true);

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
  assert.equal(usage.limits.includedDeliveries, 400);
  assert.equal(usage.limits.includedInteractions, 2700);
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
  const handoffRequest = pending.find((request) => request.type === 'human_handoff');
  const humanReply = 'Claro, lo valida la tienda y te confirmamos por este mismo WhatsApp.';
  const resolvedHandoff = await postJson(`${base}/api/pending-requests/${encodeURIComponent(handoffRequest.id)}/resolve`, {
    outcome: 'approved',
    note: humanReply,
    approverId: 'smoke-operator',
    responseMode: 'whatsapp',
  });
  assert.equal(resolvedHandoff.status, 'resolved');
  assert.equal(resolvedHandoff.customerReply.mode, 'whatsapp');
  const handoffConversation = store.getState().conversations.find((conversation) => conversation.id === handoffRequest.conversationId);
  assert.ok(handoffConversation.messages.some((message) => message.role === 'human' && message.text === humanReply));

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
  assert.ok(billingPlans.plans.some((plan) => plan.id === 'ventas_ia_400_domicilios' && plan.isActive));

  const billingStatusBeforeCheckout = await getJson(`${base}/api/billing/status?tenantId=${createdTenant.tenant.id}`);
  assert.equal(billingStatusBeforeCheckout.plan.includedDeliveries, 400);
  assert.equal(billingStatusBeforeCheckout.plan.includedInteractions, 2700);
  assert.equal(billingStatusBeforeCheckout.actions.canStartCheckout, true);
  assert.ok(billingStatusBeforeCheckout.notices.some((notice) => notice.key === 'checkout_expired_or_missing'));

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
  assert.ok(adminPlans.plans.some((plan) => plan.id === 'ventas_ia_400_domicilios'));

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
  const defaultAdminPlan = await patchJson(`${base}/api/admin/billing/plans/ventas_ia_400_domicilios`, {
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
  const discounts = await getJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/discounts`);
  assert.ok(discounts.discounts.some((item) => item.id === discount.id));

  const exception = await postJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/exceptions`, {
    reason: 'Soporte piloto',
    expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  }, { expectedStatus: 201 });
  assert.equal(exception.status, 'active');
  const exceptions = await getJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/exceptions`);
  assert.ok(exceptions.exceptions.some((item) => item.id === exception.id));

  const billingStatusWithCommercialAdjustments = await getJson(`${base}/api/billing/status?tenantId=${createdTenant.tenant.id}`);
  assert.equal(billingStatusWithCommercialAdjustments.activeDiscounts.length, 1);
  assert.equal(billingStatusWithCommercialAdjustments.activeAccessExceptions.length, 1);
  assert.ok(billingStatusWithCommercialAdjustments.notices.some((notice) => notice.key === 'discount_active'));
  assert.ok(billingStatusWithCommercialAdjustments.notices.some((notice) => notice.key === 'access_exception_active'));

  const revokedDiscount = await patchJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/discounts/${discount.id}/revoke`, {});
  assert.equal(revokedDiscount.status, 'revoked');
  const revokedException = await patchJson(`${base}/api/admin/billing/tenants/${createdTenant.tenant.id}/exceptions/${exception.id}/revoke`, {});
  assert.equal(revokedException.status, 'revoked');

  const blockedRun = await postJson(`${base}/api/agent/run`, {
    tenantId: createdTenant.tenant.id,
    waId: '573001010101',
    profileName: 'Cliente Bloqueado',
    text: 'tienes chocoramo?',
  }, { expectedStatus: 402 });
  assert.equal(blockedRun.code, 'tenant_not_operational');
  const blockedGoogleSetup = await getJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/google/oauth/start`, { expectedStatus: 402 });
  assert.equal(blockedGoogleSetup.code, 'subscription_required_for_setup');
  const blockedWhatsAppBinding = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/whatsapp/binding`, {
    phoneNumberId: 'blocked-before-payment',
  }, { expectedStatus: 402 });
  assert.equal(blockedWhatsAppBinding.code, 'subscription_required_for_setup');

  const checkout = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/subscription/checkout`, {
    payerEmail: 'dueno@example.com',
  });
  assert.equal(checkout.mode, 'sandbox_contract');
  assert.equal(checkout.subscription.status, 'pending_payment');
  assert.ok(checkout.subscription.checkoutExpiresAt);
  const billingStatusWithCheckout = await getJson(`${base}/api/billing/status?tenantId=${createdTenant.tenant.id}`);
  assert.equal(billingStatusWithCheckout.checkoutRecovery.recoverable, true);
  assert.ok(billingStatusWithCheckout.notices.some((notice) => notice.key === 'checkout_pending'));

  const continuedCheckout = await postJson(`${base}/api/billing/continue-checkout`, {
    tenantId: createdTenant.tenant.id,
    payerEmail: 'dueno@example.com',
  });
  assert.equal(continuedCheckout.reused, true);
  assert.equal(continuedCheckout.checkoutUrl, checkout.checkoutUrl);

  const subscription = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/subscription/mock-activate`, {});
  assert.equal(subscription.subscription.status, 'active');
  assert.ok(subscription.subscription.currentPeriodEnd);

  const upgradePlan = await postJson(`${base}/api/admin/billing/plans`, {
    name: 'Plan Upgrade Smoke',
    amount: 189000,
    includedDeliveries: 3000,
    includedInteractions: 12000,
    isActive: true,
  }, { expectedStatus: 201 });
  const upgradedSubscription = await postJson(`${base}/api/billing/change-plan`, {
    tenantId: createdTenant.tenant.id,
    planId: upgradePlan.id,
    direction: 'upgrade',
  });
  assert.equal(upgradedSubscription.appliesImmediately, true);
  assert.equal(upgradedSubscription.subscription.planId, upgradePlan.id);
  assert.equal(upgradedSubscription.subscription.pendingPlanChange, null);

  const downgradedSubscription = await postJson(`${base}/api/billing/change-plan`, {
    tenantId: createdTenant.tenant.id,
    planId: 'ventas_ia_400_domicilios',
    direction: 'downgrade',
  });
  assert.equal(downgradedSubscription.appliesImmediately, false);
  assert.equal(downgradedSubscription.subscription.planId, upgradePlan.id);
  assert.equal(downgradedSubscription.subscription.pendingPlanChange.planId, 'ventas_ia_400_domicilios');
  assert.equal(downgradedSubscription.noRefunds, true);

  const cancelledSubscription = await postJson(`${base}/api/billing/cancel`, {
    tenantId: createdTenant.tenant.id,
    reason: 'smoke_test_cancel_at_period_end',
  });
  assert.equal(cancelledSubscription.subscription.cancelAtPeriodEnd, true);
  assert.ok(cancelledSubscription.accessUntil);

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
  const repeatedProvision = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/google/provision`, {});
  assert.equal(repeatedProvision.reused, true);
  assert.equal(repeatedProvision.workspace.spreadsheet.id, provision.workspace.spreadsheet.id);

  const googleReadyOverview = await getJson(`${base}/api/ops/overview?tenantId=${createdTenant.tenant.id}`);
  const googleTools = googleReadyOverview.tools.filter((tool) => tool.name.startsWith('google_'));
  assert.ok(googleTools.length >= 4);
  assert.ok(googleTools.every((tool) => ['sandbox_ready', 'production_ready'].includes(tool.status)));

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

  await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/whatsapp/binding`, {
    phoneNumberId: '200000000001',
    phoneNumberIdRef: `${createdTenant.tenant.id.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
    accessTokenRef: `${createdTenant.tenant.id.toUpperCase()}_WHATSAPP_ACCESS_TOKEN_REF`,
    wabaId: '300000000001',
  }, { expectedStatus: 428 });
  const whatsappBinding = controlPlane.saveWhatsAppBinding(createdTenant.tenant.id, {
    phoneNumberId: '200000000001',
    phoneNumberIdRef: `${createdTenant.tenant.id.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
    accessTokenRef: `${createdTenant.tenant.id.toUpperCase()}_WHATSAPP_ACCESS_TOKEN_REF`,
    wabaId: '300000000001',
  }, { verifiedByProvider: true });
  assert.equal(whatsappBinding.tenant.config.whatsapp.phoneNumberId, '200000000001');
  assert.equal(whatsappBinding.whatsappOnboarding.status, 'connected');

  const whatsappReadyOverview = await getJson(`${base}/api/ops/overview?tenantId=${createdTenant.tenant.id}`);
  assert.equal(
    whatsappReadyOverview.tools.find((tool) => tool.name === 'whatsapp_business_messaging')?.status,
    'production_ready',
  );

  const validation = await postJson(`${base}/api/saas/tenants/${createdTenant.tenant.id}/validate`, {});
  assert.equal(validation.readyForActivation, true);

  const activated = await postJson(`${base}/api/admin/tenants/${createdTenant.tenant.id}/activate`, {});
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
    'human_response.whatsapp_sent',
  ]) {
    assert.ok(auditActions.has(action), `missing audit action ${action}`);
  }

  console.log('Backend smoke tests passed');
} finally {
  server.close();
  await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function getJson(url, { expectedStatus = 200 } = {}) {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  if (!text) return {};
  return JSON.parse(text);
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
