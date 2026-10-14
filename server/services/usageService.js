const DEFAULT_LIMITS = {
  includedDeliveries: 1000,
  includedInteractions: 5000,
  includedLlmTokens: null,
};

const THRESHOLDS = [0.8, 0.9, 1];

export class UsageService {
  constructor({ store, events }) {
    this.store = store;
    this.events = events;
  }

  async assertCanProcessInteraction(tenantId, { conversationId = 'system' } = {}) {
    const summary = await this.summary(tenantId);
    if (summary.limits.includedInteractions && summary.metrics.agent_interactions >= summary.limits.includedInteractions) {
      throw this.limitError({
        tenantId,
        conversationId,
        metric: 'agent_interactions',
        limit: summary.limits.includedInteractions,
        current: summary.metrics.agent_interactions,
      });
    }
  }

  async assertCanRecordDelivery(tenantId, { conversationId = 'system' } = {}) {
    const summary = await this.summary(tenantId);
    if (summary.limits.includedDeliveries && summary.metrics.deliveries_confirmed >= summary.limits.includedDeliveries) {
      throw this.limitError({
        tenantId,
        conversationId,
        metric: 'deliveries_confirmed',
        limit: summary.limits.includedDeliveries,
        current: summary.metrics.deliveries_confirmed,
      });
    }
  }

  recordAgentInteraction(tenantId, metadata = {}) {
    return this.incrementMetric(tenantId, 'agent_interactions', 1, metadata);
  }

  recordConfirmedDelivery(tenantId, metadata = {}) {
    return this.incrementMetric(tenantId, 'deliveries_confirmed', 1, metadata);
  }

  recordToolCall(tenantId, toolName, metadata = {}) {
    if (!tenantId || !toolName) return null;
    this.incrementMetric(tenantId, 'tool_calls', 1, { ...metadata, toolName });
    return this.incrementMetric(tenantId, `tool_calls.${toolName}`, 1, metadata);
  }

  recordLlmPlan(tenantId, { providerMetadata, inputText, outputPlan, executionMode, conversationId } = {}) {
    if (!tenantId) return null;
    const usage = normalizeProviderUsage(providerMetadata?.usage);
    const promptTokens = usage.promptTokens ?? estimateTokens(inputText);
    const completionTokens = usage.completionTokens ?? estimateTokens(JSON.stringify(outputPlan ?? {}));
    const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
    const metadata = {
      provider: providerMetadata?.provider ?? outputPlan?.provider,
      model: providerMetadata?.model ?? outputPlan?.model,
      executionMode,
      conversationId,
      estimated: !providerMetadata?.usage,
    };
    this.incrementMetric(tenantId, 'llm_calls', 1, metadata);
    this.incrementMetric(tenantId, 'llm_prompt_tokens', promptTokens, metadata);
    this.incrementMetric(tenantId, 'llm_completion_tokens', completionTokens, metadata);
    return this.incrementMetric(tenantId, 'llm_total_tokens', totalTokens, metadata);
  }

  async summary(tenantId, { period } = {}) {
    const resolvedPeriod = period ?? billingPeriodForTenant(this.store.getState(), tenantId);
    const counters = await this.getCounters(tenantId, resolvedPeriod);
    const tenant = await this.getTenant(tenantId);
    const limits = limitsForTenant(tenant);
    const metrics = {
      agent_interactions: Number(counters.agent_interactions ?? 0),
      deliveries_confirmed: Number(counters.deliveries_confirmed ?? 0),
      tool_calls: Number(counters.tool_calls ?? 0),
      llm_calls: Number(counters.llm_calls ?? 0),
      llm_prompt_tokens: Number(counters.llm_prompt_tokens ?? 0),
      llm_completion_tokens: Number(counters.llm_completion_tokens ?? 0),
      llm_total_tokens: Number(counters.llm_total_tokens ?? 0),
    };
    return {
      tenantId,
      period: resolvedPeriod,
      planCode: tenant?.config?.saas?.planCode ?? 'ventas_ia_1000_domicilios',
      limits,
      metrics,
      percentages: {
        interactions: percentage(metrics.agent_interactions, limits.includedInteractions),
        deliveries: percentage(metrics.deliveries_confirmed, limits.includedDeliveries),
        llmTokens: percentage(metrics.llm_total_tokens, limits.includedLlmTokens),
      },
      status: statusFor(metrics, limits),
      counters,
    };
  }

  async getCounters(tenantId, period) {
    const resolvedPeriod = period ?? billingPeriodForTenant(this.store.getState(), tenantId);
    const state = this.store.getState();
    const memoryCounters = { ...(state.usageCountersByTenant?.[tenantId]?.[resolvedPeriod] ?? {}) };
    if (!this.store.getUsageCounters) return memoryCounters;
    const persistedCounters = await this.store.getUsageCounters(tenantId, resolvedPeriod);
    return { ...persistedCounters, ...memoryCounters };
  }

  incrementMetric(tenantId, metric, amount = 1, metadata = {}) {
    if (!tenantId || !metric || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
    const period = metadata.period ?? billingPeriodForTenant(this.store.getState(), tenantId);
    let nextValue = 0;
    let emittedThreshold = null;
    let thresholdLimit = null;
    this.store.mutate((state) => {
      ensureUsageState(state);
      state.usageCountersByTenant[tenantId] ??= {};
      state.usageCountersByTenant[tenantId][period] ??= {};
      const current = Number(state.usageCountersByTenant[tenantId][period][metric] ?? 0);
      nextValue = current + Number(amount);
      state.usageCountersByTenant[tenantId][period][metric] = nextValue;
      syncBillingUsageCycleMetric(state, tenantId, metric, Number(amount));

      const tenant = state.tenants?.find((item) => item.id === tenantId);
      const limit = limitForMetric(metric, limitsForTenant(tenant));
      if (!limit) return;
      thresholdLimit = limit;
      const ratio = nextValue / limit;
      const reached = THRESHOLDS.filter((threshold) => ratio >= threshold).at(-1);
      if (!reached) return;
      state.usageBudgetAlertsByTenant[tenantId] ??= {};
      state.usageBudgetAlertsByTenant[tenantId][period] ??= {};
      const alertKey = `${metric}:${limit}`;
      const previous = Number(state.usageBudgetAlertsByTenant[tenantId][period][alertKey] ?? 0);
      if (reached > previous) {
        state.usageBudgetAlertsByTenant[tenantId][period][alertKey] = reached;
        emittedThreshold = reached;
      }
    });
    this.store.persistUsageCounter?.(tenantId, period, metric);
    if (emittedThreshold) {
      this.events.emit({
        type: 'budget.threshold_reached',
        tenantId,
        conversationId: metadata.conversationId ?? 'system',
        detail: `${metric} alcanzo ${Math.round(emittedThreshold * 100)}% del limite mensual`,
        metadata: {
          metric,
          value: nextValue,
          limit: thresholdLimit,
          threshold: emittedThreshold,
          period,
        },
      });
    }
    return { tenantId, period, metric, value: nextValue };
  }

  async getTenant(tenantId) {
    if (this.store.getTenant) return this.store.getTenant(tenantId);
    return this.store.getState().tenants.find((item) => item.id === tenantId) ?? null;
  }

  limitError({ tenantId, conversationId, metric, limit, current }) {
    this.events.emit({
      type: 'quota.exceeded',
      tenantId,
      conversationId,
      detail: `${metric} excedio el limite mensual`,
      metadata: { metric, limit, current, period: billingPeriodForTenant(this.store.getState(), tenantId) },
    });
    const error = new Error(`Tenant usage limit exceeded for ${metric}`);
    error.statusCode = 402;
    error.code = 'tenant_usage_limit_exceeded';
    error.status = { tenantId, metric, limit, current, period: billingPeriodForTenant(this.store.getState(), tenantId) };
    return error;
  }
}

export function ensureUsageState(state) {
  state.usageCountersByTenant ??= {};
  state.usageBudgetAlertsByTenant ??= {};
}

export function currentPeriod(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function billingPeriodForTenant(state, tenantId, date = new Date()) {
  const subscription = state.subscriptionsByTenant?.[tenantId];
  if (subscription?.currentPeriodStart) return subscription.currentPeriodStart.slice(0, 10);
  return currentPeriod(date);
}

export function limitsForTenant(tenant) {
  const saas = tenant?.config?.saas ?? {};
  return {
    includedDeliveries: positiveNumber(saas.includedDeliveries, DEFAULT_LIMITS.includedDeliveries),
    includedInteractions: positiveNumber(saas.includedInteractions, DEFAULT_LIMITS.includedInteractions),
    includedLlmTokens: positiveNumber(saas.includedLlmTokens, DEFAULT_LIMITS.includedLlmTokens),
  };
}

function normalizeProviderUsage(usage = {}) {
  if (!usage) return {};
  return {
    promptTokens: numberOrNull(usage.prompt_tokens ?? usage.promptTokenCount),
    completionTokens: numberOrNull(usage.completion_tokens ?? usage.candidatesTokenCount),
    totalTokens: numberOrNull(usage.total_tokens ?? usage.totalTokenCount),
  };
}

function estimateTokens(value) {
  const length = String(value ?? '').length;
  return Math.max(1, Math.ceil(length / 4));
}

function limitForMetric(metric, limits) {
  if (metric === 'agent_interactions') return limits.includedInteractions;
  if (metric === 'deliveries_confirmed') return limits.includedDeliveries;
  if (metric === 'llm_total_tokens') return limits.includedLlmTokens;
  return null;
}

function percentage(value, limit) {
  if (!limit) return null;
  return Math.round((Number(value) / Number(limit)) * 1000) / 10;
}

function statusFor(metrics, limits) {
  if (limits.includedInteractions && metrics.agent_interactions >= limits.includedInteractions) return 'interaction_limit_reached';
  if (limits.includedDeliveries && metrics.deliveries_confirmed >= limits.includedDeliveries) return 'delivery_limit_reached';
  if (limits.includedInteractions && metrics.agent_interactions >= limits.includedInteractions * 0.9) return 'warning';
  if (limits.includedDeliveries && metrics.deliveries_confirmed >= limits.includedDeliveries * 0.9) return 'warning';
  return 'ok';
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function syncBillingUsageCycleMetric(state, tenantId, metric, amount) {
  const subscription = state.subscriptionsByTenant?.[tenantId];
  const cycles = state.billingUsageCyclesByTenant?.[tenantId] ?? [];
  const cycle = cycles.find((item) => item.periodStart === subscription?.currentPeriodStart) ?? cycles[0];
  if (!cycle) return;
  if (metric === 'agent_interactions') cycle.interactionsUsed = Number(cycle.interactionsUsed ?? 0) + amount;
  if (metric === 'deliveries_confirmed') cycle.deliveriesUsed = Number(cycle.deliveriesUsed ?? 0) + amount;
  if (metric === 'llm_total_tokens') cycle.llmTokensUsed = Number(cycle.llmTokensUsed ?? 0) + amount;
  if (metric === 'tool_calls') cycle.toolCallsUsed = Number(cycle.toolCallsUsed ?? 0) + amount;
  cycle.updatedAt = new Date().toISOString();
}
