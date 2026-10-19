import crypto from 'node:crypto';

export const LEGACY_BILLING_PLAN_ID = 'ventas_ia_1000_domicilios';
export const DEFAULT_BILLING_PLAN_ID = 'ventas_ia_400_domicilios';
export const DEFAULT_INCLUDED_DELIVERIES = 400;
export const DEFAULT_INCLUDED_INTERACTIONS = 2700;
export const BILLING_GRACE_DAYS = 5;
export const CHECKOUT_RECOVERY_DAYS = 7;

export function defaultBillingPlan(now = new Date().toISOString()) {
  return {
    id: DEFAULT_BILLING_PLAN_ID,
    name: 'Ventas IA Basico',
    description: 'Plan mensual base para tiendas con hasta 400 domicilios por ciclo.',
    currency: 'COP',
    amount: 89000,
    billingFrequency: 'monthly',
    includedDeliveries: DEFAULT_INCLUDED_DELIVERIES,
    includedInteractions: DEFAULT_INCLUDED_INTERACTIONS,
    trialEnabled: true,
    trialDays: 7,
    graceDays: BILLING_GRACE_DAYS,
    isActive: true,
    isDefault: true,
    mercadoPagoPlanId: process.env.MERCADOPAGO_PREAPPROVAL_PLAN_ID || null,
    createdAt: now,
    updatedAt: now,
  };
}

export function ensureBillingState(state) {
  const now = new Date().toISOString();
  state.billingPlans ??= [defaultBillingPlan(now)];
  migrateLegacyPlanReferences(state, now);
  if (!state.billingPlans.some((plan) => plan.id === DEFAULT_BILLING_PLAN_ID)) {
    state.billingPlans.unshift(defaultBillingPlan(now));
  }
  state.billingPlans = state.billingPlans.map((plan) => normalizePlan(plan, now));
  if (!state.billingPlans.some((plan) => plan.isDefault && plan.isActive)) {
    const firstActive = state.billingPlans.find((plan) => plan.isActive) ?? state.billingPlans[0];
    firstActive.isDefault = true;
  }
  state.subscriptionPaymentsByTenant ??= {};
  state.subscriptionEvents ??= [];
  state.billingDiscounts ??= [];
  state.billingAccessExceptions ??= [];
  state.billingUsageCyclesByTenant ??= {};
  state.billingFunnelEvents ??= [];
  for (const tenant of state.tenants ?? []) {
    const subscription = state.subscriptionsByTenant?.[tenant.id];
    if (subscription) {
      const plan = planById(state, subscription.planId) ?? defaultPlan(state);
      normalizeSubscription(subscription, plan, now);
    }
    state.subscriptionPaymentsByTenant[tenant.id] ??= [];
    state.billingUsageCyclesByTenant[tenant.id] ??= [];
    const cyclePlan = planById(state, subscription?.planId) ?? defaultPlan(state);
    for (const cycle of state.billingUsageCyclesByTenant[tenant.id]) {
      cycle.includedDeliveries = cyclePlan.includedDeliveries;
      cycle.includedInteractions = cyclePlan.includedInteractions;
    }
    if (!state.billingUsageCyclesByTenant[tenant.id].length && subscription) {
      state.billingUsageCyclesByTenant[tenant.id].push(createUsageCycle({
        tenantId: tenant.id,
        subscription,
        plan: cyclePlan,
        now,
      }));
    }
  }
}

export function normalizePlan(plan, now = new Date().toISOString()) {
  return {
    id: String(plan.id ?? crypto.randomUUID()),
    name: String(plan.name ?? 'Plan Ventas IA'),
    description: plan.description ?? '',
    currency: String(plan.currency ?? 'COP'),
    amount: Number(plan.amount ?? 0),
    billingFrequency: String(plan.billingFrequency ?? plan.billing_frequency ?? 'monthly'),
    includedDeliveries: Number(plan.includedDeliveries ?? plan.included_deliveries ?? DEFAULT_INCLUDED_DELIVERIES),
    includedInteractions: Number(plan.includedInteractions ?? plan.included_interactions ?? DEFAULT_INCLUDED_INTERACTIONS),
    trialEnabled: Boolean(plan.trialEnabled ?? plan.trial_enabled ?? false),
    trialDays: Number(plan.trialDays ?? plan.trial_days ?? 0),
    graceDays: Number(plan.graceDays ?? plan.grace_days ?? BILLING_GRACE_DAYS),
    isActive: plan.isActive ?? plan.is_active ?? true,
    isDefault: Boolean(plan.isDefault ?? plan.is_default ?? false),
    mercadoPagoPlanId: plan.mercadoPagoPlanId ?? plan.mercadopago_plan_id ?? process.env.MERCADOPAGO_PREAPPROVAL_PLAN_ID ?? null,
    createdAt: plan.createdAt ?? plan.created_at ?? now,
    updatedAt: now,
  };
}

function migrateLegacyPlanReferences(state, now) {
  const legacy = state.billingPlans.find((plan) => plan.id === LEGACY_BILLING_PLAN_ID);
  const current = state.billingPlans.find((plan) => plan.id === DEFAULT_BILLING_PLAN_ID);
  if (legacy && !current) {
    legacy.id = DEFAULT_BILLING_PLAN_ID;
    legacy.name = 'Ventas IA Basico';
    legacy.description = 'Plan mensual base para tiendas con hasta 400 domicilios por ciclo.';
    legacy.includedDeliveries = DEFAULT_INCLUDED_DELIVERIES;
    legacy.includedInteractions = DEFAULT_INCLUDED_INTERACTIONS;
    legacy.updatedAt = now;
  } else if (legacy) {
    legacy.isActive = false;
    legacy.isDefault = false;
  }

  for (const tenant of state.tenants ?? []) {
    if (tenant.config?.saas?.planCode !== LEGACY_BILLING_PLAN_ID) continue;
    tenant.config.saas.planCode = DEFAULT_BILLING_PLAN_ID;
    tenant.config.saas.includedDeliveries = DEFAULT_INCLUDED_DELIVERIES;
    tenant.config.saas.includedInteractions = DEFAULT_INCLUDED_INTERACTIONS;
  }
  for (const subscription of Object.values(state.subscriptionsByTenant ?? {})) {
    if (subscription.planId !== LEGACY_BILLING_PLAN_ID) continue;
    subscription.planId = DEFAULT_BILLING_PLAN_ID;
    subscription.includedDeliveries = DEFAULT_INCLUDED_DELIVERIES;
    subscription.includedInteractions = DEFAULT_INCLUDED_INTERACTIONS;
    subscription.updatedAt = now;
  }
}

export function defaultPlan(state) {
  return state.billingPlans?.find((plan) => plan.isDefault && plan.isActive)
    ?? state.billingPlans?.find((plan) => plan.isActive)
    ?? state.billingPlans?.[0]
    ?? defaultBillingPlan();
}

export function planById(state, planId) {
  return state.billingPlans?.find((plan) => plan.id === planId) ?? null;
}

export function normalizeSubscription(subscription, plan, now = new Date().toISOString()) {
  subscription.status = normalizeSubscriptionStatus(subscription.status);
  subscription.planId ??= plan.id;
  subscription.billingCycle = 'anniversary';
  subscription.includedDeliveries ??= plan.includedDeliveries;
  subscription.includedInteractions ??= plan.includedInteractions;
  subscription.graceDays ??= plan.graceDays;
  subscription.checkoutExpiresAt ??= subscription.checkoutCreatedAt
    ? addDays(subscription.checkoutCreatedAt, CHECKOUT_RECOVERY_DAYS)
    : null;
  if (subscription.status === 'active') {
    subscription.currentPeriodStart ??= subscription.activatedAt ?? now;
    subscription.currentPeriodEnd ??= addMonths(subscription.currentPeriodStart, 1);
    subscription.nextBillingDate ??= subscription.currentPeriodEnd;
  }
  return subscription;
}

export function normalizeSubscriptionStatus(status) {
  const normalized = String(status ?? 'pending_payment').toLowerCase();
  if (['authorized', 'active'].includes(normalized)) return 'active';
  if (['pending', 'in_process'].includes(normalized)) return 'pending_payment';
  if (['past_due', 'payment_required', 'rejected'].includes(normalized)) return 'past_due';
  if (['grace', 'grace_period'].includes(normalized)) return 'grace_period';
  if (['paused'].includes(normalized)) return 'paused';
  if (['cancelled', 'canceled'].includes(normalized)) return 'cancelled';
  if (['expired'].includes(normalized)) return 'expired';
  if (['suspended'].includes(normalized)) return 'suspended';
  if (['trial'].includes(normalized)) return 'trial';
  return normalized;
}

export function createCheckoutExpiration(now = new Date().toISOString()) {
  return addDays(now, CHECKOUT_RECOVERY_DAYS);
}

export function isCheckoutRecoverable(subscription, now = new Date().toISOString()) {
  if (!subscription?.checkoutUrl || !subscription.checkoutExpiresAt) return false;
  return new Date(subscription.checkoutExpiresAt).getTime() > new Date(now).getTime();
}

export function createUsageCycle({ tenantId, subscription, plan, now = new Date().toISOString() }) {
  const periodStart = subscription.currentPeriodStart ?? subscription.activatedAt ?? now;
  const periodEnd = subscription.currentPeriodEnd ?? addMonths(periodStart, 1);
  return {
    id: `cycle-${tenantId}-${periodStart.slice(0, 10)}`,
    tenantId,
    subscriptionId: subscription.id ?? tenantId,
    periodStart,
    periodEnd,
    deliveriesUsed: 0,
    interactionsUsed: 0,
    llmTokensUsed: 0,
    toolCallsUsed: 0,
    includedDeliveries: plan.includedDeliveries,
    includedInteractions: plan.includedInteractions,
    createdAt: now,
    updatedAt: now,
  };
}

export function addMonths(value, months) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  const maxDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, maxDay));
  return date.toISOString();
}

export function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    currency: plan.currency,
    amount: plan.amount,
    billingFrequency: plan.billingFrequency,
    includedDeliveries: plan.includedDeliveries,
    includedInteractions: plan.includedInteractions,
    trialEnabled: plan.trialEnabled,
    trialDays: plan.trialDays,
    graceDays: plan.graceDays,
    isActive: plan.isActive,
    isDefault: plan.isDefault,
    mercadoPagoPlanConfigured: Boolean(plan.mercadoPagoPlanId),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function recordFunnelEvent(state, { tenantId, stage, reasonCode = null, note = null, actorId = null, payload = {} }) {
  const event = {
    id: `funnel-${crypto.randomUUID().slice(0, 12)}`,
    tenantId,
    stage,
    reasonCode,
    note,
    actorId,
    payload,
    createdAt: new Date().toISOString(),
  };
  state.billingFunnelEvents.unshift(event);
  state.billingFunnelEvents = state.billingFunnelEvents.slice(0, 1000);
  return event;
}
