import crypto from 'node:crypto';
import { appendAuditEvent } from './authService.js';
import {
  createCheckoutExpiration,
  createUsageCycle,
  addDays,
  defaultPlan,
  ensureBillingState,
  isCheckoutRecoverable,
  addMonths,
  normalizePlan,
  normalizeSubscription,
  normalizeSubscriptionStatus as normalizeBillingSubscriptionStatus,
  planById,
  publicPlan,
  recordFunnelEvent,
} from './billingService.js';
import { sandboxWorkspaceForTenant } from './googleWorkspaceService.js';
import { platformLlmConfig } from './platformService.js';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'authorized', 'trial', 'grace_period']);
const BLOCKED_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'paused', 'expired', 'payment_required', 'rejected', 'suspended']);

export class SaasControlPlane {
  constructor({ store, events, config, googleWorkspace, secretVault }) {
    this.store = store;
    this.events = events;
    this.config = config;
    this.googleWorkspace = googleWorkspace;
    this.secretVault = secretVault;
  }

  createTenant({ storeName, ownerEmail, ownerName = '', whatsappNumber = '' }, { actor } = {}) {
    ownerEmail = ownerEmail ?? actor?.email;
    ownerName = ownerName || actor?.name || '';
    if (!storeName || !ownerEmail) {
      const error = new Error('storeName and ownerEmail are required');
      error.statusCode = 400;
      throw error;
    }
    const tenantId = uniqueTenantId(this.store.getState(), storeName);
    const now = new Date().toISOString();
    const plan = defaultPlan(this.store.getState());
    const tenant = {
      id: tenantId,
      name: storeName,
      industry: 'Tienda de barrio',
      plan: 'Ventas IA SaaS',
      status: 'subscription_pending',
      accent: '#d49a41',
      whatsappNumber,
      responseTarget: '45 s',
      quota: 1000,
      lifecycle: {
        access: 'blocked',
        activationStatus: 'draft',
        createdAt: now,
        updatedAt: now,
        ownerEmail,
        ownerName,
      },
      config: tenantConfigFor(tenantId),
    };
    this.store.mutate((state) => {
      state.tenants.unshift(tenant);
      state.productsByTenant[tenantId] = [];
      state.driveFilesByTenant[tenantId] = [];
      state.customerProfilesByTenant[tenantId] = {};
      state.ordersByTenant[tenantId] = [];
      state.subscriptionsByTenant[tenantId] = {
        id: `sub-${tenantId}`,
        tenantId,
        planId: plan.id,
        status: 'pending_payment',
        provider: 'mercado_pago',
        payerEmail: ownerEmail,
        billingCycle: 'anniversary',
        includedDeliveries: plan.includedDeliveries,
        includedInteractions: plan.includedInteractions,
        graceDays: plan.graceDays,
        createdAt: now,
        updatedAt: now,
      };
      state.billingUsageCyclesByTenant[tenantId] = [
        createUsageCycle({ tenantId, subscription: state.subscriptionsByTenant[tenantId], plan, now }),
      ];
      state.onboardingByTenant[tenantId] = createOnboardingState(tenantId, now);
      recordFunnelEvent(state, { tenantId, stage: 'account_created', actorId: actor?.id ?? null, payload: { ownerEmail } });
    });
    this.persistTenantCritical(tenantId);
    this.events.emit({ type: 'tenant.created', tenantId, detail: `Cliente creado para ${storeName}`, metadata: { ownerEmail } });
    this.audit(tenantId, 'tenant.create', 'tenant', { ownerEmail, actorId: actor?.id, source: actor ? 'authenticated_user' : 'system' });
    return this.getTenantBundle(tenantId);
  }

  async createSubscriptionCheckout({ tenantId, payerEmail }) {
    const tenant = this.requireTenant(tenantId);
    const subscription = this.ensureSubscription(tenantId, payerEmail ?? tenant.lifecycle?.ownerEmail);
    const plan = planById(this.store.getState(), subscription.planId) ?? defaultPlan(this.store.getState());
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const planId = plan.mercadoPagoPlanId ?? process.env.MERCADOPAGO_PREAPPROVAL_PLAN_ID;
    const backUrl = `${this.publicBaseUrl()}/api/saas/tenants/${tenantId}/status`;
    const now = new Date().toISOString();
    const checkoutExpiresAt = createCheckoutExpiration(now);

    if (!accessToken) {
      const checkoutUrl = `/api/saas/tenants/${tenantId}/subscription/mock-activate`;
      const mock = {
        mode: 'sandbox_contract',
        provider: 'mercado_pago',
        checkoutUrl,
        subscription: this.updateSubscription(tenantId, {
          status: 'pending_payment',
          planId: plan.id,
          providerMode: 'mock',
          checkoutUrl,
          checkoutCreatedAt: now,
          checkoutExpiresAt,
          amount: plan.amount,
          currency: plan.currency,
        }),
      };
      this.recordBillingFunnel(tenantId, 'checkout_started', { mode: mock.mode });
      this.events.emit({ type: 'subscription.checkout.created', tenantId, detail: 'Checkout Mercado Pago simulado', metadata: { mode: mock.mode } });
      this.audit(tenantId, 'subscription.checkout.created', 'subscription', { mode: mock.mode, provider: 'mercado_pago' });
      return mock;
    }

    const body = {
      preapproval_plan_id: planId || undefined,
      reason: planId ? undefined : `Ventas IA - ${tenant.name}`,
      external_reference: tenantId,
      payer_email: payerEmail ?? subscription.payerEmail,
      back_url: backUrl,
      status: 'pending',
    };
    const response = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Mercado Pago preapproval failed: ${response.status}`);
      error.statusCode = 502;
      error.payload = payload;
      throw error;
    }
    const nextSubscription = this.updateSubscription(tenantId, {
      status: normalizeSubscriptionStatus(payload.status),
      providerMode: 'live',
      planId: plan.id,
      mercadoPagoPreapprovalId: payload.id,
      checkoutUrl: payload.init_point ?? payload.sandbox_init_point,
      rawStatus: payload.status,
      checkoutCreatedAt: now,
      checkoutExpiresAt,
      amount: plan.amount,
      currency: plan.currency,
    });
    this.recordBillingFunnel(tenantId, 'checkout_started', { mode: 'live', preapprovalId: payload.id });
    this.events.emit({
      type: 'subscription.checkout.created',
      tenantId,
      detail: 'Checkout Mercado Pago creado',
      metadata: { preapprovalId: payload.id, status: payload.status },
    });
    this.audit(tenantId, 'subscription.checkout.created', 'subscription', {
      mode: 'live',
      provider: 'mercado_pago',
      preapprovalId: payload.id,
      status: payload.status,
    });
    return { mode: 'live', provider: 'mercado_pago', checkoutUrl: nextSubscription.checkoutUrl, subscription: nextSubscription };
  }

  async continueSubscriptionCheckout({ tenantId, payerEmail }) {
    const subscription = this.ensureSubscription(tenantId, payerEmail);
    if (subscription.status === 'pending_payment' && isCheckoutRecoverable(subscription)) {
      this.audit(tenantId, 'subscription.checkout.continued', 'subscription', { reused: true });
      return {
        mode: subscription.providerMode ?? 'mock',
        provider: 'mercado_pago',
        reused: true,
        checkoutUrl: subscription.checkoutUrl,
        subscription,
      };
    }
    return this.createSubscriptionCheckout({ tenantId, payerEmail });
  }

  mockActivateSubscription(tenantId) {
    const plan = planById(this.store.getState(), this.store.getState().subscriptionsByTenant?.[tenantId]?.planId) ?? defaultPlan(this.store.getState());
    const now = new Date().toISOString();
    const subscription = this.updateSubscription(tenantId, {
      status: 'active',
      providerMode: 'mock',
      activatedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: addMonths(now, 1),
      nextBillingDate: addMonths(now, 1),
      includedDeliveries: plan.includedDeliveries,
      includedInteractions: plan.includedInteractions,
    });
    this.recordPayment(tenantId, {
      status: 'approved',
      amount: plan.amount,
      currency: plan.currency,
      paidAt: now,
      externalReference: tenantId,
      mercadopagoPreapprovalId: subscription.mercadoPagoPreapprovalId ?? null,
      receiptUrl: null,
      rawStatusDetail: 'mock_activation',
    });
    this.ensureCurrentUsageCycle(tenantId);
    this.patchTenantLifecycle(tenantId, { subscriptionStatus: 'active' });
    this.completeOnboardingStep(tenantId, 'subscription');
    this.recordBillingFunnel(tenantId, 'payment_confirmed', { mode: 'mock' });
    this.events.emit({ type: 'subscription.activated', tenantId, detail: 'Suscripcion activada para prueba local' });
    this.audit(tenantId, 'subscription.activated', 'subscription', { mode: 'mock', status: subscription.status });
    return { subscription, status: this.getOnboardingStatus(tenantId) };
  }

  async handleMercadoPagoWebhook({ payload, headers = {}, query = {} }) {
    if (!this.isMercadoPagoSignatureAcceptable({ headers, query, payload })) {
      const error = new Error('Invalid Mercado Pago webhook signature');
      error.statusCode = 401;
      throw error;
    }
    const topic = payload.type ?? payload.topic ?? query.type;
    const dataId = payload.data?.id ?? query['data.id'] ?? query.data_id;
    let resource = payload.resource ?? payload;

    if (process.env.MERCADOPAGO_ACCESS_TOKEN && dataId && topic === 'subscription_preapproval') {
      const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
        headers: { authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
      });
      resource = await response.json().catch(() => resource);
    }

    const tenantId = resource.external_reference ?? payload.external_reference ?? payload.tenantId;
    if (!tenantId) {
      this.audit(null, 'subscription.webhook.ignored', 'mercado_pago_webhook', { reason: 'missing_external_reference', topic, dataId });
      return { ignored: true, reason: 'missing_external_reference', topic, dataId };
    }
    this.requireTenant(tenantId);

    const normalizedStatus = normalizeSubscriptionStatus(resource.status ?? payload.status);
    const subscription = this.updateSubscription(tenantId, {
      status: normalizedStatus,
      rawStatus: resource.status ?? payload.status,
      providerMode: process.env.MERCADOPAGO_ACCESS_TOKEN ? 'live' : 'mock',
      mercadoPagoPreapprovalId: resource.id ?? dataId,
      lastWebhookAt: new Date().toISOString(),
    });
    this.patchTenantLifecycle(tenantId, { subscriptionStatus: normalizedStatus });
    if (ACTIVE_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
      const now = new Date().toISOString();
      if (!subscription.activatedAt) {
        this.updateSubscription(tenantId, {
          activatedAt: now,
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, 1),
          nextBillingDate: addMonths(now, 1),
        });
      } else if (subscription.currentPeriodEnd && isOnOrBefore(subscription.currentPeriodEnd, now)) {
        this.updateSubscription(tenantId, {
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, 1),
          nextBillingDate: addMonths(now, 1),
          graceStartedAt: null,
          graceEndsAt: null,
          suspendedAt: null,
          reactivatedAt: normalizedStatus === 'active' ? now : subscription.reactivatedAt,
        });
      }
      this.recordPayment(tenantId, {
        status: 'approved',
        amount: resource.transaction_amount ?? resource.auto_recurring?.transaction_amount ?? subscription.amount ?? 0,
        currency: resource.currency_id ?? subscription.currency ?? 'COP',
        paidAt: now,
        externalReference: tenantId,
        mercadopagoPreapprovalId: resource.id ?? dataId,
        rawStatusDetail: resource.status ?? payload.status,
      });
      this.ensureCurrentUsageCycle(tenantId);
      this.completeOnboardingStep(tenantId, 'subscription');
      this.recordBillingFunnel(tenantId, 'payment_confirmed', { topic, dataId });
    }
    if (BLOCKED_SUBSCRIPTION_STATUSES.has(normalizedStatus)) this.patchTenant(tenantId, { status: 'subscription_blocked' });

    this.events.emit({
      type: 'subscription.webhook.received',
      tenantId,
      detail: `Mercado Pago ${topic ?? 'webhook'} -> ${normalizedStatus}`,
      metadata: { topic, dataId },
    });
    this.audit(tenantId, 'subscription.webhook.received', 'subscription', {
      topic,
      dataId,
      status: normalizedStatus,
      providerMode: subscription.providerMode,
    });
    return { accepted: true, topic, dataId, subscription, status: this.getOnboardingStatus(tenantId) };
  }

  beginGoogleOAuth(tenantId, { loginHint } = {}) {
    const tenant = this.requireTenant(tenantId);
    this.requireActiveSubscriptionForSetup(tenantId, 'google_oauth');
    const state = crypto.randomBytes(24).toString('hex');
    const redirectUri = this.googleRedirectUri();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    this.store.mutate((next) => {
      next.googleOAuthStates[state] = {
        state,
        tenantId,
        loginHint: loginHint ?? tenant.lifecycle?.ownerEmail,
        scopes: GOOGLE_SCOPES,
        createdAt: now,
        expiresAt,
      };
    });

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    if (clientId) url.searchParams.set('client_id', clientId);
    if (loginHint ?? tenant.lifecycle?.ownerEmail) url.searchParams.set('login_hint', loginHint ?? tenant.lifecycle.ownerEmail);

    this.events.emit({ type: 'google.oauth.started', tenantId, detail: 'OAuth Google iniciado', metadata: { hasClientId: Boolean(clientId) } });
    this.audit(tenantId, 'google.oauth.started', 'google_connection', {
      hasClientId: Boolean(clientId),
      scopes: GOOGLE_SCOPES,
      expiresAt,
    });
    return {
      ready: Boolean(clientId && process.env.GOOGLE_CLIENT_SECRET),
      state,
      expiresAt,
      redirectUri,
      scopes: GOOGLE_SCOPES,
      authorizationUrl: url.toString(),
    };
  }

  async completeGoogleOAuth({ state, code, mockAccountEmail }) {
    const oauthState = this.consumeOAuthState(state);
    const tenantId = oauthState.tenantId;
    this.requireActiveSubscriptionForSetup(tenantId, 'google_oauth');
    const hasLiveCredentials = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    let tokenPayload = null;
    let accountEmail = mockAccountEmail ?? oauthState.loginHint;

    const liveMode = hasLiveCredentials && code && code !== 'dev-mock-code';
    if (liveMode) {
      tokenPayload = await this.googleWorkspace.exchangeAuthorizationCode({
        code,
        redirectUri: this.googleRedirectUri(),
      });
      if (!tokenPayload.refresh_token) {
        const error = new Error('Google OAuth did not return refresh_token; reconnect with consent prompt');
        error.statusCode = 428;
        error.code = 'google_refresh_token_missing';
        throw error;
      }
      accountEmail = parseEmailFromIdToken(tokenPayload.id_token) ?? accountEmail;
    }

    const refreshTokenRef = liveMode
      ? this.secretVault.saveSecret({
        tenantId,
        name: 'google_refresh_token',
        value: tokenPayload.refresh_token,
        provider: 'google',
        purpose: 'Google Drive and Sheets OAuth refresh token',
      })
      : `${tenantId.toUpperCase()}_GOOGLE_REFRESH_TOKEN_REF`;

    const connection = {
      tenantId,
      provider: 'google',
      status: 'connected',
      mode: liveMode ? 'live' : 'sandbox_contract',
      accountEmail,
      scopes: tokenPayload?.scope ? tokenPayload.scope.split(/\s+/).filter(Boolean) : oauthState.scopes,
      accessTokenRef: liveMode ? null : `${tenantId.toUpperCase()}_GOOGLE_ACCESS_TOKEN_REF`,
      refreshTokenRef,
      connectedAt: new Date().toISOString(),
      expiresAt: tokenPayload?.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString() : null,
    };

    this.store.mutate((next) => {
      next.googleConnectionsByTenant[tenantId] = connection;
      const tenant = next.tenants.find((item) => item.id === tenantId);
      if (tenant) {
        tenant.config.googleOAuth = {
          status: connection.status,
          mode: connection.mode,
          accountEmail: connection.accountEmail,
          scopes: connection.scopes,
          refreshTokenRef: connection.refreshTokenRef,
        };
        tenant.config.googleSheets.refreshTokenRef = connection.refreshTokenRef;
        tenant.config.googleDrive.refreshTokenRef = connection.refreshTokenRef;
        tenant.lifecycle = { ...(tenant.lifecycle ?? {}), googleStatus: 'connected', updatedAt: new Date().toISOString() };
      }
    });
    this.persistTenantCritical(tenantId);
    this.completeOnboardingStep(tenantId, 'google_oauth');
    this.recordBillingFunnel(tenantId, 'google_connected', { mode: connection.mode });
    this.events.emit({ type: 'google.oauth.connected', tenantId, detail: 'Google conectado', metadata: { mode: connection.mode } });
    this.audit(tenantId, 'google.oauth.connected', 'google_connection', {
      mode: connection.mode,
      accountEmail: connection.accountEmail,
      scopes: connection.scopes,
    });
    return { connection, status: this.getOnboardingStatus(tenantId) };
  }

  async provisionGoogleWorkspace(tenantId) {
    const tenant = this.requireTenant(tenantId);
    this.requireActiveSubscriptionForSetup(tenantId, 'google_provisioning');
    const connection = this.store.getState().googleConnectionsByTenant[tenantId];
    if (!connection?.status) {
      const error = new Error('Google OAuth must be connected before provisioning');
      error.statusCode = 428;
      throw error;
    }
    const workspace = connection.mode === 'live'
      ? await this.provisionLiveGoogleWorkspace({ tenant, connection })
      : sandboxWorkspaceForTenant(tenant, connection.mode);
    const now = workspace.provisionedAt ?? new Date().toISOString();

    this.store.mutate((next) => {
      next.googleWorkspacesByTenant[tenantId] = workspace;
      next.provisioningRuns.unshift({
        id: `prov-${crypto.randomUUID().slice(0, 10)}`,
        tenantId,
        provider: 'google',
        status: 'success',
        mode: workspace.mode,
        createdAt: now,
        resources: {
          rootFolderId: workspace.rootFolder.id,
          spreadsheetId: workspace.spreadsheet.id,
        },
      });
      next.provisioningRuns = next.provisioningRuns.slice(0, 100);
      const nextTenant = next.tenants.find((item) => item.id === tenantId);
      if (nextTenant) {
        nextTenant.config.googleSheets.spreadsheetIdRef = `${tenantId.toUpperCase()}_GOOGLE_SHEETS_OPS_SPREADSHEET_ID_REF`;
        nextTenant.config.googleSheets.range = 'Catalogo!A1:J1000';
        nextTenant.config.googleSheets.catalogRange = 'Catalogo!A1:J1000';
        nextTenant.config.googleSheets.customerProfilesRange = 'Clientes!A1:H1000';
        nextTenant.config.googleSheets.ordersRange = 'Pedidos!A1:M1000';
        nextTenant.config.googleDrive.rootFolderRef = `${tenantId.toUpperCase()}_GOOGLE_DRIVE_ROOT_FOLDER_ID_REF`;
        nextTenant.lifecycle = { ...(nextTenant.lifecycle ?? {}), provisioningStatus: 'provisioned', updatedAt: now };
      }
    });
    this.persistTenantCritical(tenantId);
    this.completeOnboardingStep(tenantId, 'google_provisioning');
    this.events.emit({ type: 'google.workspace.provisioned', tenantId, detail: 'Estructura Google aprovisionada', metadata: { mode: workspace.mode } });
    this.audit(tenantId, 'google.workspace.provisioned', 'google_workspace', {
      mode: workspace.mode,
      rootFolderId: workspace.rootFolder.id,
      spreadsheetId: workspace.spreadsheet.id,
      sheets: workspace.spreadsheet.sheets.map((sheet) => sheet.name),
    });
    return { workspace, status: this.getOnboardingStatus(tenantId) };
  }

  async provisionLiveGoogleWorkspace({ tenant, connection }) {
    const refreshToken = this.secretVault.readSecret(connection.refreshTokenRef);
    if (!refreshToken) {
      const error = new Error('Google refresh token is not available for this tenant');
      error.statusCode = 428;
      error.code = 'google_refresh_token_unavailable';
      throw error;
    }
    const accessToken = await this.googleWorkspace.refreshAccessToken(refreshToken);
    return this.googleWorkspace.provisionWorkspace({ tenant, accessToken });
  }

  validateTenantSetup(tenantId) {
    const validation = this.getOnboardingStatus(tenantId);
    this.store.mutate((next) => {
      next.validationRuns.unshift({
        id: `val-${crypto.randomUUID().slice(0, 10)}`,
        tenantId,
        status: validation.readyForActivation ? 'passed' : 'failed',
        checks: validation.checks,
        createdAt: new Date().toISOString(),
      });
      next.validationRuns = next.validationRuns.slice(0, 100);
    });
    this.events.emit({
      type: 'tenant.validation.completed',
      tenantId,
      detail: validation.readyForActivation ? 'Validacion lista para activar' : 'Validacion con pendientes',
      metadata: { missing: validation.checks.filter((item) => !item.ok).map((item) => item.key) },
    });
    if (validation.readyForActivation) this.completeOnboardingStep(tenantId, 'validation');
    this.audit(tenantId, 'tenant.validation.completed', 'tenant_validation', {
      readyForActivation: validation.readyForActivation,
      missing: validation.checks.filter((item) => !item.ok).map((item) => item.key),
    });
    return validation;
  }

  activateTenant(tenantId) {
    const validation = this.validateTenantSetup(tenantId);
    if (!validation.readyForActivation) {
      const error = new Error('Tenant is not ready for activation');
      error.statusCode = 428;
      error.validation = validation;
      throw error;
    }
    const now = new Date().toISOString();
    this.store.mutate((next) => {
      const tenant = next.tenants.find((item) => item.id === tenantId);
      if (!tenant) return;
      tenant.status = 'active';
      tenant.lifecycle = {
        ...(tenant.lifecycle ?? {}),
        access: 'active',
        activationStatus: 'active',
        activatedAt: now,
        updatedAt: now,
      };
      tenant.config.saas.enforceEntitlement = true;
    });
    this.persistTenantCritical(tenantId);
    this.completeOnboardingStep(tenantId, 'activation');
    this.recordBillingFunnel(tenantId, 'store_activated', { readyForOperation: true });
    this.events.emit({ type: 'tenant.activated', tenantId, detail: 'Cliente activado para operar' });
    this.audit(tenantId, 'tenant.activated', 'tenant', { readyForOperation: true });
    return this.getTenantBundle(tenantId);
  }

  requireTenantOperational(tenantId) {
    const tenant = this.requireTenant(tenantId);
    if (!tenant.config?.saas?.enforceEntitlement) return tenant;
    const status = this.getOnboardingStatus(tenantId);
    if (status.readyForOperation) return tenant;
    const exceptionActive = activeItemsForTenant(this.store.getState().billingAccessExceptions, tenantId, 'expiresAt').length > 0;
    const nonBillingReady = status.checks
      .filter((check) => check.key !== 'subscription')
      .every((check) => check.ok) && tenant.lifecycle?.activationStatus === 'active';
    if (exceptionActive && nonBillingReady) return tenant;
    const error = new Error('Tenant is not operational');
    error.statusCode = ACTIVE_SUBSCRIPTION_STATUSES.has(status.subscription?.status) ? 428 : 402;
    error.code = 'tenant_not_operational';
    error.status = status;
    throw error;
  }

  listBillingPlans({ includeInactive = false } = {}) {
    const plans = this.store.getState().billingPlans ?? [];
    return plans
      .filter((plan) => includeInactive || plan.isActive)
      .map(publicPlan);
  }

  upsertBillingPlan(payload, { actor } = {}) {
    const now = new Date().toISOString();
    const plan = normalizePlan({
      ...payload,
      id: payload.id || slugify(payload.name) || `plan-${crypto.randomUUID().slice(0, 8)}`,
    }, now);
    this.store.mutate((state) => {
      if (plan.isDefault) {
        for (const item of state.billingPlans ?? []) item.isDefault = false;
      }
      const index = (state.billingPlans ?? []).findIndex((item) => item.id === plan.id);
      if (index >= 0) state.billingPlans[index] = { ...state.billingPlans[index], ...plan, updatedAt: now };
      else state.billingPlans.unshift(plan);
    });
    this.audit(null, 'billing.plan.upserted', 'billing_plan', { planId: plan.id, actorId: actor?.id, isActive: plan.isActive });
    return publicPlan(plan);
  }

  updateBillingPlan(planId, payload, { actor } = {}) {
    let updated;
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const index = (state.billingPlans ?? []).findIndex((plan) => plan.id === planId);
      if (index < 0) {
        const error = new Error(`Billing plan not found: ${planId}`);
        error.statusCode = 404;
        throw error;
      }
      if (payload.isDefault) {
        for (const item of state.billingPlans) item.isDefault = false;
      }
      updated = normalizePlan({ ...state.billingPlans[index], ...payload, id: planId }, now);
      state.billingPlans[index] = updated;
    });
    this.audit(null, 'billing.plan.updated', 'billing_plan', { planId, actorId: actor?.id, isActive: updated.isActive });
    return publicPlan(updated);
  }

  getBillingStatus(tenantId) {
    const tenant = this.requireTenant(tenantId);
    const state = this.store.getState();
    const subscription = this.ensureSubscription(tenantId, tenant.lifecycle?.ownerEmail);
    const plan = planById(state, subscription.planId) ?? defaultPlan(state);
    const payments = state.subscriptionPaymentsByTenant?.[tenantId] ?? [];
    const usageCycle = this.ensureCurrentUsageCycle(tenantId);
    const checkoutRecoverable = isCheckoutRecoverable(subscription);
    const discounts = activeItemsForTenant(state.billingDiscounts, tenantId, 'endsAt');
    const accessExceptions = activeItemsForTenant(state.billingAccessExceptions, tenantId, 'expiresAt');
    const notices = billingNotices({ subscription, plan, payments, usageCycle, checkoutRecoverable, discounts, accessExceptions });
    return {
      tenantId,
      tenantName: tenant.name,
      subscription,
      plan: publicPlan(plan),
      payments,
      paymentHistory: payments.map(publicPayment),
      usageCycle,
      notices,
      checkoutRecovery: {
        recoverable: checkoutRecoverable,
        checkoutUrl: checkoutRecoverable ? subscription.checkoutUrl : null,
        expiresAt: subscription.checkoutExpiresAt ?? null,
        daysRemaining: daysRemaining(subscription.checkoutExpiresAt),
      },
      activeDiscounts: discounts,
      activeAccessExceptions: accessExceptions,
      limits: {
        includedDeliveries: plan.includedDeliveries,
        includedInteractions: plan.includedInteractions,
      },
      actions: {
        canStartCheckout: !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status),
        canContinueCheckout: subscription.status === 'pending_payment' && checkoutRecoverable,
        canCancel: ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status),
        canUpgrade: true,
      },
    };
  }

  getPaymentHistory(tenantId) {
    this.requireTenant(tenantId);
    return (this.store.getState().subscriptionPaymentsByTenant?.[tenantId] ?? []).map(publicPayment);
  }

  cancelSubscription(tenantId, { reason = 'owner_requested' } = {}, { actor } = {}) {
    const subscription = this.ensureSubscription(tenantId, actor?.email);
    const now = new Date().toISOString();
    const patch = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
      ? { cancelAtPeriodEnd: true, cancellationRequestedAt: now, cancellationReason: reason }
      : { status: 'cancelled', cancelledAt: now, cancellationReason: reason };
    const nextSubscription = this.updateSubscription(tenantId, patch);
    this.events.emit({ type: 'subscription.cancel.requested', tenantId, detail: 'Cancelacion de suscripcion solicitada', metadata: { reason } });
    this.audit(tenantId, 'subscription.cancel.requested', 'subscription', { reason, actorId: actor?.id });
    return { subscription: nextSubscription, accessUntil: nextSubscription.currentPeriodEnd ?? null };
  }

  changeSubscriptionPlan(tenantId, { planId, direction = 'upgrade' }, { actor, admin = false } = {}) {
    const state = this.store.getState();
    const plan = planById(state, planId);
    if (!plan || !plan.isActive) {
      const error = new Error(`Active billing plan not found: ${planId}`);
      error.statusCode = 404;
      throw error;
    }
    const subscription = this.ensureSubscription(tenantId, actor?.email);
    const now = new Date().toISOString();
    const upgrade = direction === 'upgrade';
    const nextSubscription = this.updateSubscription(tenantId, upgrade
      ? {
        planId: plan.id,
        planChangedAt: now,
        pendingPlanChange: null,
        includedDeliveries: plan.includedDeliveries,
        includedInteractions: plan.includedInteractions,
      }
      : {
        pendingPlanChange: {
          planId: plan.id,
          appliesAt: subscription.currentPeriodEnd ?? subscription.nextBillingDate ?? null,
          requestedAt: now,
        },
      });
    this.audit(tenantId, 'subscription.plan_change.requested', 'subscription', {
      planId: plan.id,
      direction,
      actorId: actor?.id,
      admin,
      noRefunds: true,
    });
    return { subscription: nextSubscription, plan: publicPlan(plan), appliesImmediately: upgrade, noRefunds: true };
  }

  async syncMercadoPagoSubscription(tenantId, { actor, force = false } = {}) {
    const subscription = this.ensureSubscription(tenantId, actor?.email);
    const before = subscription.status;
    const now = new Date().toISOString();
    const lastManualSyncAt = subscription.lastManualSyncAt ?? subscription.lastSyncAt;
    if (!force && lastManualSyncAt && Date.now() - new Date(lastManualSyncAt).getTime() < 60_000) {
      const error = new Error('Mercado Pago sync is rate limited');
      error.statusCode = 429;
      error.code = 'mercadopago_sync_rate_limited';
      error.retryAfterSeconds = Math.ceil((60_000 - (Date.now() - new Date(lastManualSyncAt).getTime())) / 1000);
      throw error;
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    const preapprovalId = subscription.mercadoPagoPreapprovalId ?? subscription.mercadopagoPreapprovalId;
    let providerResource = null;
    let checkedProvider = false;
    let providerMode = accessToken ? 'live_ready' : 'local_contract';
    let syncMode = providerMode;

    if (accessToken && preapprovalId) {
      checkedProvider = true;
      providerResource = await fetchMercadoPagoPreapproval(preapprovalId, accessToken);
      const normalizedStatus = normalizeSubscriptionStatus(providerResource.status);
      providerMode = 'live';
      syncMode = 'live_provider_checked';
      this.updateSubscriptionFromMercadoPagoResource(tenantId, providerResource, {
        now,
        actor,
        source: 'manual_sync',
      });
    } else if (accessToken) {
      syncMode = 'live_ready_missing_preapproval';
    }

    const synced = this.updateSubscription(tenantId, {
      lastSyncAt: now,
      lastManualSyncAt: now,
      syncMode,
      providerMode: providerMode === 'live' ? 'live' : subscription.providerMode,
    });
    this.audit(tenantId, 'subscription.sync.requested', 'subscription', {
      actorId: actor?.id,
      statusBefore: before,
      statusAfter: synced.status,
      providerMode: synced.syncMode,
      checkedProvider,
      preapprovalId: preapprovalId ?? null,
    });
    return {
      subscription: synced,
      statusBefore: before,
      statusAfter: synced.status,
      providerMode: synced.syncMode,
      checkedProvider,
      preapprovalId: preapprovalId ?? null,
      providerStatus: providerResource?.status ?? null,
    };
  }

  runBillingMaintenance({ now = new Date().toISOString(), actor } = {}) {
    const state = this.store.getState();
    const tenantIds = Object.keys(state.subscriptionsByTenant ?? {});
    const result = {
      ranAt: now,
      mode: process.env.MERCADOPAGO_ACCESS_TOKEN ? 'live_ready' : 'local_contract',
      scanned: tenantIds.length,
      checkoutExpired: 0,
      enteredGrace: 0,
      suspended: 0,
      cancelled: 0,
      cyclesOpened: 0,
      discountsExpired: 0,
      exceptionsExpired: 0,
      actions: [],
    };

    let expiredDiscounts = [];
    let expiredExceptions = [];
    this.store.mutate((next) => {
      expiredDiscounts = expireBillingCollection(next.billingDiscounts, 'endsAt', now);
      expiredExceptions = expireBillingCollection(next.billingAccessExceptions, 'expiresAt', now);
    });
    result.discountsExpired = expiredDiscounts.length;
    result.exceptionsExpired = expiredExceptions.length;
    for (const discount of expiredDiscounts) this.audit(discount.tenantId, 'billing.discount.expired', 'billing_discount', { discountId: discount.id, actorId: actor?.id });
    for (const exception of expiredExceptions) this.audit(exception.tenantId, 'billing.access_exception.expired', 'billing_access_exception', { exceptionId: exception.id, actorId: actor?.id });

    for (const tenantId of tenantIds) {
      const subscription = this.store.getState().subscriptionsByTenant?.[tenantId];
      if (!subscription) continue;
      const status = normalizeBillingSubscriptionStatus(subscription.status);
      const dueAt = subscription.nextBillingDate ?? subscription.currentPeriodEnd;

      if (status === 'pending_payment' && subscription.checkoutExpiresAt && isOnOrBefore(subscription.checkoutExpiresAt, now)) {
        this.updateSubscription(tenantId, {
          status: 'expired',
          checkoutExpiredAt: now,
          expiredAt: subscription.expiredAt ?? now,
        });
        this.patchTenant(tenantId, { status: 'subscription_blocked' });
        this.patchTenantLifecycle(tenantId, { subscriptionStatus: 'expired', access: 'blocked' });
        this.recordBillingFunnel(tenantId, 'blocked', { reasonCode: 'checkout_expired' });
        this.events.emit({ type: 'subscription.checkout.expired', tenantId, detail: 'Checkout Mercado Pago vencido' });
        this.audit(tenantId, 'subscription.checkout.expired', 'subscription', { checkoutExpiresAt: subscription.checkoutExpiresAt, actorId: actor?.id });
        result.checkoutExpired += 1;
        result.actions.push({ tenantId, action: 'checkout_expired', from: status, to: 'expired' });
        continue;
      }

      if (ACTIVE_SUBSCRIPTION_STATUSES.has(status) && subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && isOnOrBefore(subscription.currentPeriodEnd, now)) {
        this.updateSubscription(tenantId, {
          status: 'cancelled',
          cancelledAt: subscription.cancelledAt ?? now,
        });
        this.patchTenant(tenantId, { status: 'subscription_cancelled' });
        this.patchTenantLifecycle(tenantId, { subscriptionStatus: 'cancelled', access: 'readonly' });
        this.events.emit({ type: 'subscription.cancelled', tenantId, detail: 'Suscripcion cancelada al cierre del periodo' });
        this.audit(tenantId, 'subscription.cancelled_at_period_end', 'subscription', { actorId: actor?.id });
        result.cancelled += 1;
        result.actions.push({ tenantId, action: 'cancelled_at_period_end', from: status, to: 'cancelled' });
        continue;
      }

      if (['active', 'trial'].includes(status) && dueAt && isOnOrBefore(dueAt, now)) {
        const graceDays = Number(subscription.graceDays ?? planById(this.store.getState(), subscription.planId)?.graceDays ?? defaultPlan(this.store.getState()).graceDays ?? 5);
        this.updateSubscription(tenantId, {
          status: 'grace_period',
          graceStartedAt: subscription.graceStartedAt ?? now,
          graceEndsAt: subscription.graceEndsAt ?? addDays(now, graceDays),
          lastBillingAttemptAt: now,
        });
        this.patchTenantLifecycle(tenantId, { subscriptionStatus: 'grace_period', access: 'active' });
        this.events.emit({ type: 'subscription.grace.started', tenantId, detail: 'Periodo de gracia iniciado por cobro pendiente', metadata: { graceDays } });
        this.audit(tenantId, 'subscription.grace.started', 'subscription', { graceDays, actorId: actor?.id });
        result.enteredGrace += 1;
        result.actions.push({ tenantId, action: 'grace_started', from: status, to: 'grace_period', graceDays });
        continue;
      }

      if (status === 'past_due' && !subscription.graceEndsAt) {
        const graceDays = Number(subscription.graceDays ?? defaultPlan(this.store.getState()).graceDays ?? 5);
        this.updateSubscription(tenantId, {
          status: 'grace_period',
          graceStartedAt: subscription.graceStartedAt ?? now,
          graceEndsAt: addDays(now, graceDays),
        });
        this.patchTenantLifecycle(tenantId, { subscriptionStatus: 'grace_period', access: 'active' });
        this.audit(tenantId, 'subscription.grace.started', 'subscription', { graceDays, actorId: actor?.id, source: 'past_due' });
        result.enteredGrace += 1;
        result.actions.push({ tenantId, action: 'grace_started', from: status, to: 'grace_period', graceDays });
        continue;
      }

      if (status === 'grace_period' && subscription.graceEndsAt && isOnOrBefore(subscription.graceEndsAt, now)) {
        this.updateSubscription(tenantId, {
          status: 'suspended',
          suspendedAt: subscription.suspendedAt ?? now,
        });
        this.patchTenant(tenantId, { status: 'subscription_blocked' });
        this.patchTenantLifecycle(tenantId, { subscriptionStatus: 'suspended', access: 'limited' });
        this.events.emit({ type: 'subscription.suspended', tenantId, detail: 'Suscripcion suspendida por gracia vencida' });
        this.audit(tenantId, 'subscription.suspended', 'subscription', { graceEndsAt: subscription.graceEndsAt, actorId: actor?.id });
        result.suspended += 1;
        result.actions.push({ tenantId, action: 'suspended_after_grace', from: status, to: 'suspended' });
        continue;
      }

      if (status === 'active' && subscription.currentPeriodStart && !this.store.getState().billingUsageCyclesByTenant?.[tenantId]?.some((cycle) => cycle.periodStart === subscription.currentPeriodStart)) {
        this.ensureCurrentUsageCycle(tenantId);
        result.cyclesOpened += 1;
        result.actions.push({ tenantId, action: 'usage_cycle_created', periodStart: subscription.currentPeriodStart });
      }
    }

    this.audit(null, 'billing.maintenance.ran', 'billing_job', { actorId: actor?.id, ...result });
    return result;
  }

  createBillingDiscount(tenantId, payload, { actor } = {}) {
    this.requireTenant(tenantId);
    const now = new Date().toISOString();
    const discount = {
      id: `disc-${crypto.randomUUID().slice(0, 12)}`,
      tenantId,
      planId: payload.planId ?? null,
      discountType: payload.discountType ?? 'percentage',
      discountValue: Number(payload.discountValue ?? payload.value ?? 0),
      startsAt: payload.startsAt ?? now,
      endsAt: payload.endsAt,
      reason: String(payload.reason ?? '').trim(),
      approvedBy: actor?.id ?? payload.approvedBy ?? 'admin',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    if (!discount.endsAt || !discount.reason || discount.discountValue <= 0) {
      const error = new Error('discountValue, endsAt and reason are required');
      error.statusCode = 400;
      throw error;
    }
    this.store.mutate((state) => {
      state.billingDiscounts.unshift(discount);
    });
    this.audit(tenantId, 'billing.discount.created', 'billing_discount', { discountId: discount.id, actorId: actor?.id, reason: discount.reason });
    return discount;
  }

  listBillingDiscounts(tenantId) {
    if (tenantId) this.requireTenant(tenantId);
    return (this.store.getState().billingDiscounts ?? [])
      .filter((item) => !tenantId || item.tenantId === tenantId)
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }

  revokeBillingDiscount(tenantId, discountId, { actor } = {}) {
    this.requireTenant(tenantId);
    const now = new Date().toISOString();
    let discount;
    this.store.mutate((state) => {
      discount = (state.billingDiscounts ?? []).find((item) => item.tenantId === tenantId && item.id === discountId);
      if (!discount) return;
      discount.status = 'revoked';
      discount.revokedAt = now;
      discount.revokedBy = actor?.id ?? 'admin';
      discount.updatedAt = now;
    });
    if (!discount) {
      const error = new Error(`Billing discount not found: ${discountId}`);
      error.statusCode = 404;
      throw error;
    }
    this.audit(tenantId, 'billing.discount.revoked', 'billing_discount', { discountId, actorId: actor?.id });
    return discount;
  }

  createBillingAccessException(tenantId, payload, { actor } = {}) {
    this.requireTenant(tenantId);
    const now = new Date().toISOString();
    const exception = {
      id: `access-${crypto.randomUUID().slice(0, 12)}`,
      tenantId,
      reason: String(payload.reason ?? '').trim(),
      startsAt: payload.startsAt ?? now,
      expiresAt: payload.expiresAt,
      createdBy: actor?.id ?? payload.createdBy ?? 'admin',
      status: 'active',
      createdAt: now,
      revokedAt: null,
    };
    if (!exception.reason || !exception.expiresAt) {
      const error = new Error('reason and expiresAt are required');
      error.statusCode = 400;
      throw error;
    }
    this.store.mutate((state) => {
      state.billingAccessExceptions.unshift(exception);
    });
    this.audit(tenantId, 'billing.access_exception.created', 'billing_access_exception', {
      exceptionId: exception.id,
      actorId: actor?.id,
      expiresAt: exception.expiresAt,
    });
    return exception;
  }

  listBillingAccessExceptions(tenantId) {
    if (tenantId) this.requireTenant(tenantId);
    return (this.store.getState().billingAccessExceptions ?? [])
      .filter((item) => !tenantId || item.tenantId === tenantId)
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  }

  revokeBillingAccessException(tenantId, exceptionId, { actor } = {}) {
    this.requireTenant(tenantId);
    const now = new Date().toISOString();
    let exception;
    this.store.mutate((state) => {
      exception = (state.billingAccessExceptions ?? []).find((item) => item.tenantId === tenantId && item.id === exceptionId);
      if (!exception) return;
      exception.status = 'revoked';
      exception.revokedAt = now;
      exception.revokedBy = actor?.id ?? 'admin';
      exception.updatedAt = now;
    });
    if (!exception) {
      const error = new Error(`Billing access exception not found: ${exceptionId}`);
      error.statusCode = 404;
      throw error;
    }
    this.audit(tenantId, 'billing.access_exception.revoked', 'billing_access_exception', { exceptionId, actorId: actor?.id });
    return exception;
  }

  getBillingFunnel() {
    const state = this.store.getState();
    const stages = ['account_created', 'diagnosis_started', 'diagnosis_completed', 'checkout_started', 'payment_confirmed', 'google_connected', 'whatsapp_configured', 'store_activated'];
    const events = state.billingFunnelEvents ?? [];
    return {
      stages: stages.map((stage) => ({
        stage,
        total: new Set(events.filter((event) => event.stage === stage).map((event) => event.tenantId)).size,
      })),
      events: events.slice(0, 200),
    };
  }

  updateBillingFunnelReason(tenantId, { stage = 'blocked', reasonCode, note }, { actor } = {}) {
    this.requireTenant(tenantId);
    let event;
    this.store.mutate((state) => {
      event = recordFunnelEvent(state, {
        tenantId,
        stage,
        reasonCode,
        note,
        actorId: actor?.id ?? null,
        payload: { manual: true },
      });
    });
    this.audit(tenantId, 'billing.funnel.reason_updated', 'billing_funnel', { stage, reasonCode, actorId: actor?.id });
    return event;
  }

  getTenantBundle(tenantId) {
    const state = this.store.getState();
    return {
      tenant: state.tenants.find((item) => item.id === tenantId),
      subscription: state.subscriptionsByTenant[tenantId] ?? null,
      googleConnection: state.googleConnectionsByTenant[tenantId] ?? null,
      googleWorkspace: state.googleWorkspacesByTenant[tenantId] ?? null,
      whatsappOnboarding: this.getWhatsAppOnboarding(tenantId),
      onboarding: state.onboardingByTenant[tenantId] ?? null,
      status: this.getOnboardingStatus(tenantId),
    };
  }

  getWhatsAppOnboarding(tenantId) {
    const tenant = this.requireTenant(tenantId);
    const saved = this.store.getState().whatsappOnboardingByTenant[tenantId] ?? {};
    return whatsappOnboardingForTenant({ tenant, saved });
  }

  saveWhatsAppOnboardingIntent(tenantId, payload = {}) {
    const tenant = this.requireTenant(tenantId);
    const setupPath = normalizeWhatsAppSetupPath(payload.setupPath);
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      state.whatsappOnboardingByTenant[tenantId] = {
        ...(state.whatsappOnboardingByTenant[tenantId] ?? {}),
        tenantId,
        setupPath,
        hasWhatsAppBusiness: payload.hasWhatsAppBusiness ?? setupPath !== 'new_business',
        businessName: String(payload.businessName ?? tenant.name ?? '').trim(),
        contactPhone: String(payload.contactPhone ?? tenant.whatsappNumber ?? '').trim(),
        notes: String(payload.notes ?? '').trim(),
        status: 'in_progress',
        updatedAt: now,
        createdAt: state.whatsappOnboardingByTenant[tenantId]?.createdAt ?? now,
      };
    });
    this.events.emit({ type: 'whatsapp.onboarding.intent_saved', tenantId, detail: 'Ruta WhatsApp seleccionada', metadata: { setupPath } });
    this.audit(tenantId, 'whatsapp.onboarding.intent_saved', 'whatsapp_connection', { setupPath });
    return this.getWhatsAppOnboarding(tenantId);
  }

  startWhatsAppEmbeddedSignup(tenantId) {
    this.requireTenant(tenantId);
    this.requireActiveSubscriptionForSetup(tenantId, 'whatsapp_setup');
    const status = this.getWhatsAppOnboarding(tenantId);
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      state.whatsappOnboardingByTenant[tenantId] = {
        ...(state.whatsappOnboardingByTenant[tenantId] ?? {}),
        tenantId,
        status: status.canAutomate ? 'ready_to_connect' : 'guided_manual',
        lastAttemptAt: now,
        lastAttemptMode: status.automationMode,
        updatedAt: now,
        createdAt: state.whatsappOnboardingByTenant[tenantId]?.createdAt ?? now,
      };
    });
    this.events.emit({
      type: 'whatsapp.embedded_signup.started',
      tenantId,
      detail: status.canAutomate ? 'Embedded Signup WhatsApp preparado' : 'Guia manual WhatsApp requerida',
      metadata: { automationMode: status.automationMode },
    });
    this.audit(tenantId, 'whatsapp.embedded_signup.started', 'whatsapp_connection', {
      canAutomate: status.canAutomate,
      automationMode: status.automationMode,
    });

    if (!status.canAutomate) {
      return {
        ready: false,
        mode: 'guided_manual',
        reason: 'meta_app_not_configured',
        message: 'Faltan credenciales Meta para abrir Embedded Signup desde la microapp.',
        manualSteps: status.steps,
        status: this.getWhatsAppOnboarding(tenantId),
      };
    }

    return {
      ready: true,
      mode: 'embedded_signup',
      launch: {
        appId: process.env.META_APP_ID,
        configId: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? process.env.META_CONFIG_ID,
        redirectUri: process.env.WHATSAPP_EMBEDDED_SIGNUP_REDIRECT_URI ?? `${this.publicBaseUrl()}/api/saas/whatsapp/embedded-signup/callback`,
        responseType: 'code',
      },
      status: this.getWhatsAppOnboarding(tenantId),
    };
  }

  saveWhatsAppBinding(tenantId, payload = {}) {
    const tenant = this.requireTenant(tenantId);
    this.requireActiveSubscriptionForSetup(tenantId, 'whatsapp_binding');
    const phoneNumberId = String(payload.phoneNumberId ?? '').trim();
    if (!phoneNumberId) {
      const error = new Error('phoneNumberId is required');
      error.statusCode = 400;
      throw error;
    }
    const now = new Date().toISOString();
    this.store.mutate((state) => {
      const nextTenant = state.tenants.find((item) => item.id === tenantId);
      if (nextTenant) {
        nextTenant.config.whatsapp = {
          ...(nextTenant.config.whatsapp ?? tenantConfigFor(tenantId).whatsapp),
          phoneNumberId,
          wabaId: String(payload.wabaId ?? nextTenant.config.whatsapp?.wabaId ?? '').trim() || null,
          displayPhoneNumber: String(payload.displayPhoneNumber ?? nextTenant.whatsappNumber ?? '').trim() || null,
          verifiedName: String(payload.verifiedName ?? nextTenant.name ?? '').trim() || null,
          phoneNumberIdRef: String(payload.phoneNumberIdRef ?? nextTenant.config.whatsapp?.phoneNumberIdRef ?? `${tenantId.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`).trim(),
          accessTokenRef: String(payload.accessTokenRef ?? nextTenant.config.whatsapp?.accessTokenRef ?? `${tenantId.toUpperCase()}_WHATSAPP_ACCESS_TOKEN_REF`).trim(),
          verifyTokenRef: String(payload.verifyTokenRef ?? nextTenant.config.whatsapp?.verifyTokenRef ?? 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF').trim(),
          appSecretRef: String(payload.appSecretRef ?? nextTenant.config.whatsapp?.appSecretRef ?? 'WHATSAPP_APP_SECRET_REF').trim(),
        };
        nextTenant.lifecycle = { ...(nextTenant.lifecycle ?? {}), whatsappStatus: 'connected', updatedAt: now };
      }
      state.whatsappOnboardingByTenant[tenantId] = {
        ...(state.whatsappOnboardingByTenant[tenantId] ?? {}),
        tenantId,
        status: 'connected',
        connectedAt: now,
        updatedAt: now,
        createdAt: state.whatsappOnboardingByTenant[tenantId]?.createdAt ?? now,
      };
    });
    this.persistTenantCritical(tenantId);
    this.completeOnboardingStep(tenantId, 'whatsapp');
    this.recordBillingFunnel(tenantId, 'whatsapp_configured', { phoneNumberId });
    this.events.emit({ type: 'whatsapp.connection.bound', tenantId, detail: 'WhatsApp conectado a la tienda', metadata: { phoneNumberId } });
    this.audit(tenantId, 'whatsapp.connection.bound', 'whatsapp_connection', {
      phoneNumberId,
      wabaId: payload.wabaId ?? null,
      hasAccessTokenRef: Boolean(payload.accessTokenRef ?? tenant.config?.whatsapp?.accessTokenRef),
    });
    return this.getTenantBundle(tenantId);
  }

  getOnboardingStatus(tenantId) {
    const state = this.store.getState();
    const tenant = state.tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      const error = new Error(`Tenant not found: ${tenantId}`);
      error.statusCode = 404;
      throw error;
    }
    const subscription = state.subscriptionsByTenant[tenantId] ?? null;
    const googleConnection = state.googleConnectionsByTenant[tenantId] ?? null;
    const googleWorkspace = state.googleWorkspacesByTenant[tenantId] ?? null;
    const checks = [
      { key: 'subscription', label: 'Suscripcion activa en Mercado Pago', ok: ACTIVE_SUBSCRIPTION_STATUSES.has(subscription?.status), detail: subscription?.status ?? 'missing' },
      { key: 'google_oauth', label: 'Google conectado', ok: googleConnection?.status === 'connected', detail: googleConnection?.accountEmail ?? 'missing' },
      { key: 'google_provisioning', label: 'Drive y Sheets aprovisionados', ok: googleWorkspace?.status === 'provisioned', detail: googleWorkspace?.spreadsheet?.id ?? 'missing' },
      { key: 'llm', label: 'DeepSeek global de plataforma', ok: platformLlmConfig(state).provider === 'deepseek' && Boolean(platformLlmConfig(state).apiKeyRef), detail: platformLlmConfig(state).model ?? 'missing' },
      { key: 'whatsapp', label: 'WhatsApp separado por tienda', ok: Boolean(tenant.config?.whatsapp?.phoneNumberId), detail: tenant.config?.whatsapp?.phoneNumberId ? 'Número conectado' : 'missing' },
    ];
    const readyForActivation = checks.every((item) => item.ok);
    const readyForOperation = readyForActivation && tenant.lifecycle?.activationStatus === 'active' && tenant.lifecycle?.access === 'active';
    return {
      tenantId,
      tenantStatus: tenant.status,
      subscription,
      checks,
      readyForActivation,
      readyForOperation,
      nextStep: nextStepFromChecks(checks, tenant.lifecycle),
    };
  }

  ensureSubscription(tenantId, payerEmail) {
    const state = this.store.getState();
    if (state.subscriptionsByTenant[tenantId]) return state.subscriptionsByTenant[tenantId];
    const plan = defaultPlan(state);
    return this.updateSubscription(tenantId, {
      id: `sub-${tenantId}`,
      tenantId,
      planId: plan.id,
      status: 'pending_payment',
      provider: 'mercado_pago',
      payerEmail,
      billingCycle: 'anniversary',
      includedDeliveries: plan.includedDeliveries,
      includedInteractions: plan.includedInteractions,
      graceDays: plan.graceDays,
      createdAt: new Date().toISOString(),
    });
  }

  updateSubscription(tenantId, patch) {
    let subscription;
    const plan = planById(this.store.getState(), patch.planId ?? this.store.getState().subscriptionsByTenant?.[tenantId]?.planId) ?? defaultPlan(this.store.getState());
    this.store.mutate((state) => {
      state.subscriptionsByTenant[tenantId] = {
        id: `sub-${tenantId}`,
        tenantId,
        provider: 'mercado_pago',
        planId: plan.id,
        ...(state.subscriptionsByTenant[tenantId] ?? {}),
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      normalizeSubscription(state.subscriptionsByTenant[tenantId], plan);
      subscription = state.subscriptionsByTenant[tenantId];
    });
    this.persistTenantCritical(tenantId);
    return subscription;
  }

  updateSubscriptionFromMercadoPagoResource(tenantId, resource, { now = new Date().toISOString(), actor, source = 'provider' } = {}) {
    const previous = this.ensureSubscription(tenantId, actor?.email);
    const normalizedStatus = normalizeSubscriptionStatus(resource.status);
    const plan = planById(this.store.getState(), previous.planId) ?? defaultPlan(this.store.getState());
    const patch = {
      status: normalizedStatus,
      rawStatus: resource.status,
      providerMode: 'live',
      mercadoPagoPreapprovalId: resource.id ?? previous.mercadoPagoPreapprovalId,
      checkoutUrl: resource.init_point ?? resource.sandbox_init_point ?? previous.checkoutUrl,
      amount: resource.transaction_amount ?? resource.auto_recurring?.transaction_amount ?? previous.amount ?? plan.amount,
      currency: resource.currency_id ?? previous.currency ?? plan.currency,
    };
    const shouldRecordPayment = ACTIVE_SUBSCRIPTION_STATUSES.has(normalizedStatus)
      && (!ACTIVE_SUBSCRIPTION_STATUSES.has(previous.status) || (previous.currentPeriodEnd && isOnOrBefore(previous.currentPeriodEnd, now)));
    if (ACTIVE_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
      patch.activatedAt = previous.activatedAt ?? now;
      patch.currentPeriodStart = previous.currentPeriodStart ?? now;
      patch.currentPeriodEnd = previous.currentPeriodEnd ?? addMonths(patch.currentPeriodStart, 1);
      patch.nextBillingDate = previous.nextBillingDate ?? patch.currentPeriodEnd;
      patch.graceStartedAt = null;
      patch.graceEndsAt = null;
      patch.suspendedAt = null;
      patch.reactivatedAt = previous.activatedAt ? now : previous.reactivatedAt;
    }
    const subscription = this.updateSubscription(tenantId, patch);
    this.patchTenantLifecycle(tenantId, { subscriptionStatus: normalizedStatus });
    if (shouldRecordPayment) {
      this.recordPayment(tenantId, {
        status: 'approved',
        amount: subscription.amount ?? plan.amount,
        currency: subscription.currency ?? plan.currency,
        paidAt: now,
        externalReference: tenantId,
        mercadopagoPreapprovalId: resource.id ?? previous.mercadoPagoPreapprovalId,
        rawStatusDetail: `${source}:${resource.status}`,
      });
      this.ensureCurrentUsageCycle(tenantId);
      this.completeOnboardingStep(tenantId, 'subscription');
      this.recordBillingFunnel(tenantId, 'payment_confirmed', { source, preapprovalId: resource.id ?? null });
    }
    if (BLOCKED_SUBSCRIPTION_STATUSES.has(normalizedStatus)) {
      this.patchTenant(tenantId, { status: 'subscription_blocked' });
    }
    return subscription;
  }

  requireActiveSubscriptionForSetup(tenantId, step) {
    const subscription = this.ensureSubscription(tenantId);
    if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return subscription;
    const error = new Error('Active subscription is required before operational setup');
    error.statusCode = 402;
    error.code = 'subscription_required_for_setup';
    error.status = { tenantId, step, subscriptionStatus: subscription.status };
    throw error;
  }

  recordPayment(tenantId, payment) {
    let saved;
    this.store.mutate((state) => {
      state.subscriptionPaymentsByTenant[tenantId] ??= [];
      saved = {
        id: payment.id ?? `pay-${crypto.randomUUID().slice(0, 12)}`,
        tenantId,
        subscriptionId: payment.subscriptionId ?? `sub-${tenantId}`,
        mercadoPagoPaymentId: payment.mercadopagoPaymentId ?? payment.mercadoPagoPaymentId ?? null,
        mercadoPagoPreapprovalId: payment.mercadopagoPreapprovalId ?? payment.mercadoPagoPreapprovalId ?? null,
        status: payment.status ?? 'approved',
        amount: Number(payment.amount ?? 0),
        currency: payment.currency ?? 'COP',
        paidAt: payment.paidAt ?? new Date().toISOString(),
        externalReference: payment.externalReference ?? tenantId,
        receiptUrl: payment.receiptUrl ?? null,
        rawStatusDetail: payment.rawStatusDetail ?? null,
        createdAt: payment.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.subscriptionPaymentsByTenant[tenantId].unshift(saved);
    });
    return saved;
  }

  ensureCurrentUsageCycle(tenantId) {
    const state = this.store.getState();
    const subscription = state.subscriptionsByTenant?.[tenantId] ?? this.ensureSubscription(tenantId);
    const plan = planById(state, subscription.planId) ?? defaultPlan(state);
    let cycle = (state.billingUsageCyclesByTenant?.[tenantId] ?? []).find((item) => item.periodStart === subscription.currentPeriodStart);
    if (cycle) return cycle;
    this.store.mutate((next) => {
      next.billingUsageCyclesByTenant[tenantId] ??= [];
      cycle = createUsageCycle({ tenantId, subscription, plan });
      next.billingUsageCyclesByTenant[tenantId].unshift(cycle);
    });
    return cycle;
  }

  recordBillingFunnel(tenantId, stage, payload = {}) {
    let event;
    this.store.mutate((state) => {
      event = recordFunnelEvent(state, { tenantId, stage, payload });
    });
    return event;
  }

  completeOnboardingStep(tenantId, stepKey) {
    this.store.mutate((state) => {
      state.onboardingByTenant[tenantId] ??= createOnboardingState(tenantId, new Date().toISOString());
      const step = state.onboardingByTenant[tenantId].steps.find((item) => item.key === stepKey);
      if (step) {
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
      }
      if (state.onboardingByTenant[tenantId].steps.every((item) => item.status === 'completed')) {
        state.onboardingByTenant[tenantId].status = 'completed';
      }
      state.onboardingByTenant[tenantId].updatedAt = new Date().toISOString();
    });
  }

  patchTenant(tenantId, patch) {
    this.store.mutate((state) => {
      const tenant = state.tenants.find((item) => item.id === tenantId);
      if (tenant) Object.assign(tenant, patch);
    });
    this.persistTenantCritical(tenantId);
  }

  patchTenantLifecycle(tenantId, patch) {
    this.store.mutate((state) => {
      const tenant = state.tenants.find((item) => item.id === tenantId);
      if (!tenant) return;
      tenant.lifecycle = { ...(tenant.lifecycle ?? {}), ...patch, updatedAt: new Date().toISOString() };
    });
    this.persistTenantCritical(tenantId);
  }

  consumeOAuthState(state) {
    const saved = this.store.getState().googleOAuthStates[state];
    if (!saved) {
      const error = new Error('Invalid OAuth state');
      error.statusCode = 400;
      throw error;
    }
    if (new Date(saved.expiresAt).getTime() < Date.now()) {
      const error = new Error('Expired OAuth state');
      error.statusCode = 400;
      throw error;
    }
    this.store.mutate((next) => {
      delete next.googleOAuthStates[state];
    });
    return saved;
  }

  requireTenant(tenantId) {
    const tenant = this.store.getState().tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      const error = new Error(`Tenant not found: ${tenantId}`);
      error.statusCode = 404;
      throw error;
    }
    return tenant;
  }

  googleRedirectUri() {
    return process.env.GOOGLE_REDIRECT_URI ?? `${this.publicBaseUrl()}/api/saas/google/oauth/callback`;
  }

  publicBaseUrl() {
    return process.env.PUBLIC_APP_URL ?? `http://${this.config.host}:${this.config.port}`;
  }

  isMercadoPagoSignatureAcceptable({ headers, query, payload = {} }) {
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) return true;
    const signature = parseMercadoPagoSignature(headers['x-signature']);
    const requestId = headers['x-request-id'];
    const dataId = query['data.id'] ?? query.data_id ?? payload?.data?.id;
    if (!signature.ts || !signature.v1 || !dataId) return false;
    const manifest = [
      `id:${dataId};`,
      requestId ? `request-id:${requestId};` : '',
      `ts:${signature.ts};`,
    ].join('');
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return safeEqualHex(expected, signature.v1);
  }

  persistTenantCritical(tenantId) {
    this.store.persistTenantCritical?.(tenantId);
  }

  audit(tenantId, action, resource, metadata = {}) {
    this.store.mutate((state) => {
      appendAuditEvent(state, {
        tenantId,
        actorId: metadata.actorId ?? null,
        action,
        resource,
        metadata,
      });
    });
  }
}

export function ensureSaasState(state) {
  state.subscriptionsByTenant ??= {};
  state.onboardingByTenant ??= {};
  state.whatsappOnboardingByTenant ??= {};
  state.googleOAuthStates ??= {};
  state.googleConnectionsByTenant ??= {};
  state.googleWorkspacesByTenant ??= {};
  state.provisioningRuns ??= [];
  state.validationRuns ??= [];
  ensureBillingState(state);
  for (const tenant of state.tenants ?? []) {
    tenant.config ??= tenantConfigFor(tenant.id);
    tenant.config.saas = {
      ...tenantConfigFor(tenant.id).saas,
      ...(tenant.config.saas ?? {}),
      enforceEntitlement: tenant.config.saas?.enforceEntitlement ?? tenant.status === 'active',
    };
    tenant.lifecycle ??= {
      access: tenant.status === 'active' || tenant.status === 'sandbox_ready' ? 'active' : 'blocked',
      activationStatus: tenant.status === 'active' || tenant.status === 'sandbox_ready' ? 'active' : 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.subscriptionsByTenant[tenant.id] ??= {
      id: `sub-${tenant.id}`,
      tenantId: tenant.id,
      planId: defaultPlan(state).id,
      provider: 'mercado_pago',
      providerMode: 'seed',
      status: tenant.id === 'norte' ? 'pending_payment' : 'active',
      payerEmail: tenant.lifecycle.ownerEmail ?? `${tenant.id}@example.local`,
      billingCycle: 'anniversary',
      includedDeliveries: defaultPlan(state).includedDeliveries,
      includedInteractions: defaultPlan(state).includedInteractions,
      graceDays: defaultPlan(state).graceDays,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    normalizeSubscription(state.subscriptionsByTenant[tenant.id], planById(state, state.subscriptionsByTenant[tenant.id].planId) ?? defaultPlan(state));
    state.billingUsageCyclesByTenant[tenant.id] ??= [
      createUsageCycle({
        tenantId: tenant.id,
        subscription: state.subscriptionsByTenant[tenant.id],
        plan: planById(state, state.subscriptionsByTenant[tenant.id].planId) ?? defaultPlan(state),
      }),
    ];
    state.onboardingByTenant[tenant.id] ??= createOnboardingState(tenant.id, new Date().toISOString(), tenant.id === 'norte' ? [] : ['subscription']);
    state.whatsappOnboardingByTenant[tenant.id] ??= {
      tenantId: tenant.id,
      setupPath: tenant.config?.whatsapp?.phoneNumberId ? 'cloud_api_existing' : null,
      status: tenant.config?.whatsapp?.phoneNumberId ? 'connected' : 'not_started',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

function tenantConfigFor(tenantId) {
  return {
    timezone: 'America/Bogota',
    businessHours: { start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5, 6] },
    saas: {
      planCode: 'ventas_ia_1000_domicilios',
      includedDeliveries: 1000,
      includedInteractions: 5000,
      enforceEntitlement: true,
    },
    whatsapp: {
      phoneNumberIdRef: `${tenantId.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
      verifyTokenRef: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF',
      appSecretRef: 'WHATSAPP_APP_SECRET_REF',
      accessTokenRef: `${tenantId.toUpperCase()}_WHATSAPP_ACCESS_TOKEN_REF`,
      phoneNumberId: null,
    },
    googleSheets: {
      spreadsheetIdRef: `${tenantId.toUpperCase()}_GOOGLE_SHEETS_OPS_SPREADSHEET_ID_REF`,
      range: 'Catalogo!A1:J1000',
      catalogRange: 'Catalogo!A1:J1000',
      customerProfilesRange: 'Clientes!A1:H1000',
      ordersRange: 'Pedidos!A1:M1000',
      primaryKey: 'sku',
      refreshPolicy: 'short_ttl',
    },
    googleDrive: {
      rootFolderRef: `${tenantId.toUpperCase()}_GOOGLE_DRIVE_ROOT_FOLDER_ID_REF`,
      customerProfileFolderRef: `${tenantId.toUpperCase()}_CUSTOMER_PROFILE_FOLDER_REF`,
      allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      refreshMode: 'on_demand',
    },
    llm: {
      responseLanguage: 'es-CO',
      deprecated: true,
    },
    agentPolicy: {
      tone: 'tendero_bogotano',
      responseLanguage: 'es-CO',
      missingQuantity: 'ask',
      humanEscalation: true,
      allowedTasks: ['intent_classification', 'order_parser', 'tool_router', 'response_composer'],
    },
    orderPolicy: {
      customerIdentifier: 'whatsapp_wa_id',
      customerRequiredFields: ['name', 'defaultAddress'],
      missingQuantity: 'ask',
      customerProfileStore: 'google_sheets',
      confirmedOrderStore: 'google_sheets',
      confirmedOrderHandoff: 'preparation_and_delivery',
    },
    secretsPolicy: 'references_only_no_plaintext_values',
  };
}

function createOnboardingState(tenantId, createdAt, completed = []) {
  const completedSet = new Set(completed);
  const steps = [
    ['subscription', 'Activar suscripcion Mercado Pago'],
    ['google_oauth', 'Conectar Google por OAuth'],
    ['google_provisioning', 'Crear Drive y Sheets del cliente'],
    ['whatsapp', 'Conectar WhatsApp Business del cliente'],
    ['validation', 'Validar configuracion minima'],
    ['activation', 'Activar operacion'],
  ].map(([key, label]) => ({
    key,
    label,
    status: completedSet.has(key) ? 'completed' : 'pending',
    completedAt: completedSet.has(key) ? createdAt : null,
  }));
  return { tenantId, status: 'in_progress', steps, createdAt, updatedAt: createdAt };
}

function normalizeWhatsAppSetupPath(value) {
  const allowed = new Set(['cloud_api_existing', 'business_app_existing', 'new_business']);
  return allowed.has(value) ? value : 'business_app_existing';
}

function whatsappOnboardingForTenant({ tenant, saved }) {
  const whatsapp = tenant.config?.whatsapp ?? {};
  const setupPath = saved.setupPath ?? (whatsapp.phoneNumberId ? 'cloud_api_existing' : null);
  const canAutomate = Boolean(process.env.META_APP_ID && (process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || process.env.META_CONFIG_ID));
  const connected = Boolean(whatsapp.phoneNumberId);
  const status = connected ? 'connected' : saved.status ?? (setupPath ? 'in_progress' : 'needs_path');
  const nextAction = connected
    ? 'validate'
    : canAutomate && setupPath
      ? 'start_embedded_signup'
      : setupPath
        ? 'follow_manual_guide'
        : 'choose_setup_path';
  return {
    tenantId: tenant.id,
    setupPath,
    status,
    automationMode: canAutomate ? 'embedded_signup' : 'guided_manual',
    canAutomate,
    reason: canAutomate ? null : 'meta_app_not_configured',
    nextAction,
    hasWhatsAppBusiness: saved.hasWhatsAppBusiness ?? null,
    businessName: saved.businessName ?? tenant.name,
    contactPhone: saved.contactPhone ?? tenant.whatsappNumber ?? '',
    notes: saved.notes ?? '',
    binding: {
      phoneNumberId: whatsapp.phoneNumberId ?? null,
      wabaId: whatsapp.wabaId ?? null,
      displayPhoneNumber: whatsapp.displayPhoneNumber ?? tenant.whatsappNumber ?? null,
      verifiedName: whatsapp.verifiedName ?? null,
      accessTokenRef: whatsapp.accessTokenRef ?? null,
      verifyTokenRef: whatsapp.verifyTokenRef ?? null,
      appSecretRef: whatsapp.appSecretRef ?? null,
    },
    requirements: whatsappRequirementsForPath(setupPath),
    steps: whatsappSetupSteps({ setupPath, connected, canAutomate, whatsapp }),
    externalLinks: {
      businessSuite: 'https://business.facebook.com/',
      whatsappManager: 'https://business.facebook.com/wa/manage/',
      cloudApiDocs: 'https://developers.facebook.com/docs/whatsapp/cloud-api/',
    },
    lastAttemptAt: saved.lastAttemptAt ?? null,
    updatedAt: saved.updatedAt ?? null,
  };
}

function whatsappRequirementsForPath(setupPath) {
  if (setupPath === 'cloud_api_existing') {
    return [
      'Acceso admin al negocio Meta del cliente',
      'Cuenta WhatsApp existente o permiso para seleccionarla',
      'Identificador del número, acceso permanente y referencia de verificación',
    ];
  }
  if (setupPath === 'new_business') {
    return [
      'Crear o confirmar Business Manager del cliente',
      'Tener numero disponible para OTP y nombre visible de la tienda',
      'Completar verificacion y registrar numero en la integración oficial',
    ];
  }
  return [
    'Confirmar si el numero actual puede migrarse a la integración oficial',
    'Acceso al telefono para recibir OTP',
    'Definir si la tienda conserva el numero o usa uno nuevo',
  ];
}

function whatsappSetupSteps({ setupPath, connected, canAutomate, whatsapp }) {
  const pathSelected = Boolean(setupPath);
  const steps = [
    {
      key: 'diagnosis',
      label: 'Diagnóstico',
      status: pathSelected ? 'done' : 'current',
      detail: 'Preguntar si ya tiene WhatsApp Business, integración oficial o empieza desde cero.',
    },
    {
      key: 'meta_auth',
      label: 'Autorización Meta',
      status: connected ? 'done' : pathSelected && canAutomate ? 'current' : pathSelected ? 'manual' : 'locked',
      detail: canAutomate ? 'Abrir el registro guiado con el negocio del cliente.' : 'Guiar al cliente en Meta Business hasta habilitar la cuenta.',
    },
    {
      key: 'business',
      label: 'Cuenta WhatsApp',
      status: connected || whatsapp.wabaId ? 'done' : pathSelected ? 'manual' : 'locked',
      detail: 'Seleccionar o crear la cuenta WhatsApp, negocio, nombre visible y categoria.',
    },
    {
      key: 'phone',
      label: 'Número y OTP',
      status: connected || whatsapp.phoneNumberId ? 'done' : pathSelected ? 'manual' : 'locked',
      detail: 'Validar numero del cliente, recibir codigo y obtener el identificador del número.',
    },
    {
      key: 'webhook',
      label: 'Eventos de conexión',
      status: connected ? 'done' : pathSelected ? 'manual' : 'locked',
      detail: 'Apuntar eventos de WhatsApp a la URL publica de la plataforma.',
    },
    {
      key: 'test',
      label: 'Mensaje de prueba',
      status: connected ? 'current' : 'locked',
      detail: 'Enviar un mensaje real cuando el webhook público esté publicado.',
    },
  ];
  return steps;
}

function uniqueTenantId(state, storeName) {
  const base = slugify(storeName) || `tenant-${crypto.randomUUID().slice(0, 6)}`;
  const existing = new Set((state.tenants ?? []).map((tenant) => tenant.id));
  if (!existing.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function fetchMercadoPagoPreapproval(preapprovalId, accessToken) {
  const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Mercado Pago preapproval sync failed: ${response.status}`);
    error.statusCode = response.status >= 500 ? 502 : 400;
    error.code = 'mercadopago_preapproval_sync_failed';
    error.payload = payload;
    throw error;
  }
  return payload;
}

function normalizeSubscriptionStatus(status) {
  return normalizeBillingSubscriptionStatus(status);
}

function isOnOrBefore(value, now) {
  if (!value) return false;
  const left = new Date(value).getTime();
  const right = new Date(now).getTime();
  return Number.isFinite(left) && Number.isFinite(right) && left <= right;
}

function expireBillingCollection(collection = [], dateKey, now) {
  const expired = [];
  for (const item of collection ?? []) {
    if (item?.status !== 'active' || !item[dateKey] || !isOnOrBefore(item[dateKey], now)) continue;
    item.status = 'expired';
    item.updatedAt = now;
    item.expiredAt = now;
    expired.push({ ...item });
  }
  return expired;
}

function activeItemsForTenant(collection = [], tenantId, dateKey) {
  const now = Date.now();
  return (collection ?? [])
    .filter((item) => item?.tenantId === tenantId && item.status === 'active')
    .filter((item) => !item[dateKey] || new Date(item[dateKey]).getTime() > now)
    .sort((a, b) => String(a[dateKey] ?? '').localeCompare(String(b[dateKey] ?? '')));
}

function publicPayment(payment) {
  return {
    ...payment,
    hasReceipt: Boolean(payment.receiptUrl || payment.mercadoPagoPaymentId || payment.mercadoPagoPreapprovalId),
    receiptLabel: payment.receiptUrl
      ? 'Comprobante disponible'
      : payment.mercadoPagoPaymentId
        ? `Mercado Pago ${payment.mercadoPagoPaymentId}`
        : payment.mercadoPagoPreapprovalId
          ? `Suscripcion ${payment.mercadoPagoPreapprovalId}`
          : payment.rawStatusDetail ?? 'Referencia local',
  };
}

function billingNotices({ subscription, plan, payments, usageCycle, checkoutRecoverable, discounts, accessExceptions }) {
  const notices = [];
  const status = normalizeBillingSubscriptionStatus(subscription?.status);
  const deliveryPercent = percent(usageCycle?.deliveriesUsed, plan?.includedDeliveries ?? subscription?.includedDeliveries);
  const interactionPercent = percent(usageCycle?.interactionsUsed, plan?.includedInteractions ?? subscription?.includedInteractions);

  if (status === 'pending_payment') {
    notices.push({
      key: checkoutRecoverable ? 'checkout_pending' : 'checkout_expired_or_missing',
      tone: checkoutRecoverable ? 'warning' : 'critical',
      title: checkoutRecoverable ? 'Pago pendiente recuperable' : 'Pago pendiente vencido',
      message: checkoutRecoverable
        ? `El enlace de pago se puede continuar. Vence en ${daysRemaining(subscription.checkoutExpiresAt)} dias.`
        : 'El enlace de pago no esta disponible o ya vencio. Debe generarse uno nuevo.',
      action: checkoutRecoverable ? 'continue_checkout' : 'start_checkout',
    });
  }

  if (status === 'trial') {
    notices.push({
      key: 'trial_active',
      tone: 'info',
      title: 'Periodo de prueba activo',
      message: subscription.trialEndsAt
        ? `La prueba termina el ${formatDateOnly(subscription.trialEndsAt)}.`
        : `Prueba configurada por ${plan?.trialDays ?? subscription.trialDays ?? 0} dias.`,
      action: 'monitor_trial',
    });
  }

  if (status === 'grace_period') {
    const remaining = daysRemaining(subscription.graceEndsAt);
    notices.push({
      key: remaining <= 2 ? 'grace_ending' : 'grace_active',
      tone: remaining <= 2 ? 'critical' : 'warning',
      title: remaining <= 2 ? 'Periodo de gracia por vencer' : 'Periodo de gracia activo',
      message: remaining > 0
        ? `La tienda sigue operando, pero se suspendera si no se confirma el pago en ${remaining} dias.`
        : 'La gracia ya vencio; la siguiente conciliacion suspendera el acceso.',
      action: 'sync_or_collect_payment',
    });
  }

  if (['suspended', 'expired', 'cancelled', 'past_due'].includes(status)) {
    notices.push({
      key: `subscription_${status}`,
      tone: 'critical',
      title: 'Acceso requiere atencion',
      message: 'El estado de pago impide operar normalmente. Sincroniza Mercado Pago, recupera el checkout o aplica una excepcion auditada.',
      action: 'recover_access',
    });
  }

  for (const threshold of [100, 90, 80]) {
    if (deliveryPercent >= threshold) {
      notices.push({
        key: `deliveries_${threshold}`,
        tone: threshold === 100 ? 'critical' : threshold === 90 ? 'warning' : 'info',
        title: threshold === 100 ? 'Limite de domicilios alcanzado' : `Domicilios al ${threshold}%`,
        message: threshold === 100
          ? 'No se deben registrar mas domicilios sin upgrade o excepcion administrativa.'
          : 'Conviene ofrecer upgrade antes de bloquear la operacion.',
        action: threshold === 100 ? 'upgrade_or_exception' : 'suggest_upgrade',
      });
      break;
    }
  }

  for (const threshold of [100, 90, 80]) {
    if (interactionPercent >= threshold) {
      notices.push({
        key: `interactions_${threshold}`,
        tone: threshold === 100 ? 'critical' : threshold === 90 ? 'warning' : 'info',
        title: threshold === 100 ? 'Limite de interacciones alcanzado' : `Interacciones al ${threshold}%`,
        message: threshold === 100
          ? 'El consumo llego al limite del plan. Se requiere upgrade o excepcion administrativa.'
          : 'El cliente se acerca al limite de uso del ciclo.',
        action: threshold === 100 ? 'upgrade_or_exception' : 'monitor_usage',
      });
      break;
    }
  }

  if (discounts.length) {
    notices.push({
      key: 'discount_active',
      tone: 'info',
      title: 'Descuento comercial activo',
      message: `${discounts.length} descuento(s) vigente(s) con vencimiento y auditoria.`,
      action: 'review_discount',
    });
  }

  if (accessExceptions.length) {
    notices.push({
      key: 'access_exception_active',
      tone: 'warning',
      title: 'Excepcion temporal activa',
      message: 'El acceso fue habilitado manualmente sin cambiar el estado real de Mercado Pago.',
      action: 'review_exception',
    });
  }

  if (!payments.length && ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    notices.push({
      key: 'payment_history_missing',
      tone: 'warning',
      title: 'Historial de pago incompleto',
      message: 'La suscripcion esta activa, pero no hay comprobante registrado en el historial local.',
      action: 'sync_payment_history',
    });
  }

  return notices;
}

function percent(value, limit) {
  return Math.round((Number(value ?? 0) / Math.max(Number(limit ?? 0), 1)) * 100);
}

function daysRemaining(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatDateOnly(value) {
  if (!value) return 'fecha pendiente';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(value));
}

function nextStepFromChecks(checks, lifecycle = {}) {
  const missing = checks.find((item) => !item.ok);
  if (missing) return missing.key;
  if (lifecycle.activationStatus !== 'active') return 'activation';
  return 'ready';
}

function parseEmailFromIdToken(idToken) {
  if (!idToken) return null;
  const [, payload] = idToken.split('.');
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.email ?? null;
  } catch {
    return null;
  }
}

function parseMercadoPagoSignature(header) {
  return String(header ?? '')
    .split(',')
    .map((part) => part.trim().split('='))
    .reduce((parts, [key, value]) => {
      if (key && value) parts[key] = value;
      return parts;
    }, {});
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
