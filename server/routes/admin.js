import express from 'express';
import {
  filterWebhookEvents,
  platformLlmConfig,
  summarizeWebhookEvents,
  updatePlatformSettings,
} from '../services/platformService.js';
import { mergeTenantConfig, sanitizeAdminConfigPatch } from '../services/tenantConfigPolicy.js';

export function createAdminRouter({ store, usage, auth, controlPlane }) {
  const router = express.Router();

  router.use((req, _res, next) => {
    try {
      auth.requirePlatformAdmin(req);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get('/overview', async (req, res, next) => {
    try {
      const tenants = await readTenants(store);
      const tenantSummaries = await Promise.all(tenants.map(async (tenant) => tenantAdminSummary({ tenant, store, usage, controlPlane })));
      const webhooks = await readWebhookEvents(store, { limit: 200 });
      const outboxEntries = await readOutbox(store, { limit: 100 });
      const summary = summarizeWebhookEvents(webhooks);
      res.json({
        generatedAt: new Date().toISOString(),
        platform: {
          llm: publicLlmSettings(platformLlmConfig(store.getState())),
          webhookSummary: summary,
          outboxSummary: summarizeOutbox(outboxEntries),
        },
        totals: {
          tenants: tenants.length,
          activeTenants: tenants.filter((tenant) => tenant.status === 'active').length,
          paymentBlocked: tenantSummaries.filter((tenant) => ['pending', 'pending_payment', 'past_due', 'grace_period', 'payment_required', 'expired', 'cancelled', 'suspended'].includes(tenant.subscriptionStatus)).length,
          llmTokens: tenantSummaries.reduce((sum, tenant) => sum + tenant.usage.metrics.llm_total_tokens, 0),
          interactions: tenantSummaries.reduce((sum, tenant) => sum + tenant.usage.metrics.agent_interactions, 0),
        },
        tenants: tenantSummaries,
        recentWebhooks: webhooks.slice(0, 20),
        recentOutbox: outboxEntries.slice(0, 20).map(publicOutboxEntry),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/settings', (req, res) => {
    res.json({
      llm: publicLlmSettings(platformLlmConfig(store.getState())),
    });
  });

  router.patch('/settings', (req, res, next) => {
    try {
      let settings;
      store.mutate((state) => {
        settings = updatePlatformSettings(state, sanitizeSettingsPatch(req.body ?? {}));
      });
      res.json({ llm: publicLlmSettings(settings.llm) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/webhooks', async (req, res, next) => {
    try {
      const limit = Number(req.query.limit ?? 200);
      const events = await readWebhookEvents(store, {
        tenantId: req.query.tenantId,
        provider: req.query.provider,
        status: req.query.status,
        limit: Math.min(Math.max(limit, 1), 500),
      });
      const filtered = filterWebhookEvents(events, {
        tenantId: req.query.tenantId,
        provider: req.query.provider,
        status: req.query.status,
        from: req.query.from,
        to: req.query.to,
        q: req.query.q,
      });
      res.json({
        summary: summarizeWebhookEvents(filtered),
        events: filtered,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/webhooks/:id', async (req, res, next) => {
    try {
      const events = await readWebhookEvents(store, { limit: 500 });
      const event = events.find((item) => item.id === req.params.id);
      if (!event) return res.status(404).json({ error: 'Webhook event not found' });
      return res.json(event);
    } catch (error) {
      next(error);
    }
  });

  router.get('/outbox', async (req, res, next) => {
    try {
      const entries = await readOutbox(store, {
        tenantId: req.query.tenantId,
        status: req.query.status,
        limit: Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500),
      });
      res.json({
        summary: summarizeOutbox(entries),
        entries: entries.map(publicOutboxEntry),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/billing/plans', (_req, res, next) => {
    try {
      res.json({ plans: controlPlane.listBillingPlans({ includeInactive: true }) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/billing/plans', (req, res, next) => {
    try {
      res.status(201).json(controlPlane.upsertBillingPlan(req.body ?? {}, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/billing/plans/:planId', (req, res, next) => {
    try {
      res.json(controlPlane.updateBillingPlan(req.params.planId, req.body ?? {}, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/billing/tenants/:tenantId/sync', async (req, res, next) => {
    try {
      res.json(await controlPlane.syncMercadoPagoSubscription(req.params.tenantId, {
        actor: req.auth?.user,
        force: Boolean(req.body?.force),
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/billing/tenants/:tenantId/discounts', (req, res, next) => {
    try {
      res.status(201).json(controlPlane.createBillingDiscount(req.params.tenantId, req.body ?? {}, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/billing/tenants/:tenantId/discounts', (req, res, next) => {
    try {
      res.json({ discounts: controlPlane.listBillingDiscounts(req.params.tenantId) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/billing/tenants/:tenantId/discounts/:discountId/revoke', (req, res, next) => {
    try {
      res.json(controlPlane.revokeBillingDiscount(req.params.tenantId, req.params.discountId, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/billing/tenants/:tenantId/exceptions', (req, res, next) => {
    try {
      res.status(201).json(controlPlane.createBillingAccessException(req.params.tenantId, req.body ?? {}, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/billing/tenants/:tenantId/exceptions', (req, res, next) => {
    try {
      res.json({ exceptions: controlPlane.listBillingAccessExceptions(req.params.tenantId) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/billing/tenants/:tenantId/exceptions/:exceptionId/revoke', (req, res, next) => {
    try {
      res.json(controlPlane.revokeBillingAccessException(req.params.tenantId, req.params.exceptionId, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/billing/tenants/:tenantId/change-plan', (req, res, next) => {
    try {
      res.json(controlPlane.changeSubscriptionPlan(req.params.tenantId, req.body ?? {}, { actor: req.auth?.user, admin: true }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/billing/jobs/run', (req, res, next) => {
    try {
      res.json(controlPlane.runBillingMaintenance({ now: req.body?.now, actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/validate', (req, res, next) => {
    try {
      const result = controlPlane.validateTenantSetup(req.params.tenantId);
      auth.recordTenantAction(req, {
        tenantId: req.params.tenantId,
        action: 'tenant.validation.admin_requested',
        resource: 'tenant_validation',
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/tenants/:tenantId/activate', (req, res, next) => {
    try {
      const result = controlPlane.activateTenant(req.params.tenantId);
      auth.recordTenantAction(req, {
        tenantId: req.params.tenantId,
        action: 'tenant.activation.admin_requested',
        resource: 'tenant',
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.patch('/tenants/:tenantId/config', (req, res, next) => {
    try {
      const tenantId = req.params.tenantId;
      const configPatch = sanitizeAdminConfigPatch(req.body ?? {});
      let tenant;
      store.mutate((state) => {
        tenant = state.tenants.find((item) => item.id === tenantId);
        if (tenant) tenant.config = mergeTenantConfig(tenant.config, configPatch);
      });
      if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
      auth.recordTenantAction(req, {
        tenantId,
        action: 'tenant.config.admin_update',
        resource: 'tenant.config',
        metadata: {
          sections: Object.keys(configPatch),
          fields: Object.fromEntries(Object.entries(configPatch).map(([key, value]) => [key, isPlainObject(value) ? Object.keys(value) : []])),
        },
      });
      return res.json(tenant);
    } catch (error) {
      next(error);
    }
  });

  router.get('/billing/funnel', (_req, res, next) => {
    try {
      res.json(controlPlane.getBillingFunnel());
    } catch (error) {
      next(error);
    }
  });

  router.patch('/billing/funnel/:tenantId/reason', (req, res, next) => {
    try {
      res.json(controlPlane.updateBillingFunnelReason(req.params.tenantId, req.body ?? {}, { actor: req.auth?.user }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function tenantAdminSummary({ tenant, store, usage, controlPlane }) {
  const state = store.getState();
  const subscription = state.subscriptionsByTenant?.[tenant.id] ?? null;
  const googleConnection = state.googleConnectionsByTenant?.[tenant.id] ?? null;
  const googleWorkspace = state.googleWorkspacesByTenant?.[tenant.id] ?? null;
  const webhooks = await readWebhookEvents(store, { tenantId: tenant.id, limit: 50 });
  const events = store.listEvents ? await store.listEvents({ tenantId: tenant.id, limit: 30 }) : state.events.filter((event) => event.tenantId === tenant.id).slice(0, 30);
  const usageSummary = await usage.summary(tenant.id);
  const billingStatus = controlPlane.getBillingStatus(tenant.id);
  const lastError = [...webhooks, ...events]
    .find((event) => ['failed', 'rejected', 'blocked'].includes(event.status) || String(event.type ?? '').includes('failed') || event.errorCode);
  return {
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    plan: tenant.plan,
    ownerEmail: tenant.lifecycle?.ownerEmail ?? subscription?.payerEmail ?? null,
    subscriptionStatus: subscription?.status ?? 'missing',
    billingNotices: billingStatus.notices ?? [],
    paymentHistoryCount: billingStatus.paymentHistory?.length ?? 0,
    activeDiscounts: billingStatus.activeDiscounts?.length ?? 0,
    activeDiscountsDetail: billingStatus.activeDiscounts ?? [],
    activeAccessExceptions: billingStatus.activeAccessExceptions?.length ?? 0,
    activeAccessExceptionsDetail: billingStatus.activeAccessExceptions ?? [],
    checkoutRecovery: billingStatus.checkoutRecovery,
    access: tenant.lifecycle?.access ?? 'blocked',
    googleStatus: googleConnection?.status ?? 'missing',
    googleWorkspaceStatus: googleWorkspace?.status ?? 'missing',
    whatsappStatus: tenant.config?.whatsapp?.phoneNumberId ? 'connected' : 'missing',
    usage: usageSummary,
    webhooks: summarizeWebhookEvents(webhooks),
    lastUsedAt: latestDate([
      tenant.lifecycle?.updatedAt,
      ...events.map((event) => event.at ?? event.createdAt),
      ...webhooks.map((event) => event.receivedAt),
    ]),
    lastError: lastError ? {
      at: lastError.receivedAt ?? lastError.at ?? lastError.createdAt,
      source: lastError.provider ?? lastError.type,
      message: lastError.errorMessage ?? lastError.detail ?? lastError.status,
    } : null,
  };
}

async function readTenants(store) {
  return store.listTenants ? store.listTenants() : store.getState().tenants;
}

async function readWebhookEvents(store, filters = {}) {
  if (store.listWebhookEvents) return store.listWebhookEvents(filters);
  const events = store.getState().webhookEvents ?? [];
  return filterWebhookEvents(events, filters).slice(0, Number(filters.limit ?? 200));
}

async function readOutbox(store, { tenantId, status, limit = 100 } = {}) {
  const entries = store.listOutbox
    ? await store.listOutbox({ status, limit })
    : (store.getState().integrationOutbox ?? []).filter((entry) => !status || entry.status === status).slice(-limit);
  return entries.filter((entry) => !tenantId || entry.tenantId === tenantId);
}

function summarizeOutbox(entries) {
  const summary = {
    total: entries.length,
    pending: 0,
    processing: 0,
    retrying: 0,
    failed: 0,
    processed: 0,
  };
  for (const entry of entries) {
    if (Object.hasOwn(summary, entry.status)) summary[entry.status] += 1;
  }
  return summary;
}

function publicOutboxEntry(entry) {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    kind: entry.kind,
    aggregateType: entry.aggregateType,
    aggregateId: entry.aggregateId,
    status: entry.status,
    attempts: Number(entry.attempts ?? 0),
    nextAttemptAt: entry.nextAttemptAt,
    createdAt: entry.createdAt,
    lockedAt: entry.lockedAt,
    processedAt: entry.processedAt,
    lastError: entry.lastError,
  };
}

function sanitizeSettingsPatch(body) {
  const llm = body.llm ?? {};
  return {
    llm: {
      provider: 'deepseek',
      model: String(llm.model ?? 'deepseek-chat').trim() || 'deepseek-chat',
      mode: String(llm.mode ?? 'json_schema').trim() || 'json_schema',
      simulator: llm.simulator === '' ? null : llm.simulator,
      apiKeyRef: String(llm.apiKeyRef ?? 'DEEPSEEK_API_KEY').trim() || 'DEEPSEEK_API_KEY',
      baseUrlRef: String(llm.baseUrlRef ?? 'DEEPSEEK_BASE_URL').trim() || 'DEEPSEEK_BASE_URL',
      temperature: Number(llm.temperature ?? 0),
      maxTokens: Number(llm.maxTokens ?? 1200),
      timeoutMs: Number(llm.timeoutMs ?? 15000),
      responseLanguage: String(llm.responseLanguage ?? 'es-CO').trim() || 'es-CO',
    },
  };
}

function publicLlmSettings(settings) {
  return {
    ...settings,
    configured: Boolean(settings?.apiKeyRef),
    secretValueVisible: false,
  };
}

function latestDate(values) {
  const sorted = values
    .filter(Boolean)
    .map((value) => new Date(value).toISOString())
    .sort()
    .reverse();
  return sorted[0] ?? null;
}
