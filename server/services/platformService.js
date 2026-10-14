import crypto from 'node:crypto';

export const DEFAULT_PLATFORM_SETTINGS = {
  llm: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    mode: 'json_schema',
    simulator: 'codex',
    apiKeyRef: 'DEEPSEEK_API_KEY',
    baseUrlRef: 'DEEPSEEK_BASE_URL',
    temperature: 0,
    maxTokens: 1200,
    timeoutMs: 15000,
    responseLanguage: 'es-CO',
  },
};

const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'x-hub-signature-256',
  'x-signature',
  'access_token',
  'refresh_token',
  'client_secret',
  'token',
]);

export function ensurePlatformState(state) {
  state.platformSettings = mergeDeep(DEFAULT_PLATFORM_SETTINGS, state.platformSettings ?? {});
  state.webhookEvents ??= [];
}

export function platformLlmConfig(state) {
  ensurePlatformState(state);
  return {
    ...DEFAULT_PLATFORM_SETTINGS.llm,
    ...(state.platformSettings?.llm ?? {}),
  };
}

export function updatePlatformSettings(state, patch = {}) {
  ensurePlatformState(state);
  state.platformSettings = mergeDeep(state.platformSettings, patch);
  state.platformSettings.updatedAt = new Date().toISOString();
  return state.platformSettings;
}

export function recordWebhookEvent(store, event = {}) {
  const now = new Date().toISOString();
  const record = {
    id: event.id ?? `whk-${crypto.randomUUID()}`,
    provider: event.provider ?? 'unknown',
    tenantId: event.tenantId ?? null,
    eventType: event.eventType ?? 'unknown',
    externalId: event.externalId ?? null,
    status: event.status ?? 'received',
    receivedAt: event.receivedAt ?? now,
    processedAt: event.processedAt ?? null,
    durationMs: Number(event.durationMs ?? 0),
    httpStatus: event.httpStatus ?? null,
    idempotencyKey: event.idempotencyKey ?? event.externalId ?? null,
    payloadRedacted: redact(event.payload ?? {}),
    headersRedacted: redact(event.headers ?? {}),
    errorCode: event.errorCode ?? null,
    errorMessage: event.errorMessage ?? null,
    conversationId: event.conversationId ?? null,
    metadata: event.metadata ?? {},
  };
  store.mutate((state) => {
    ensurePlatformState(state);
    state.webhookEvents.unshift(record);
    state.webhookEvents = state.webhookEvents.slice(0, 2000);
  });
  store.persistWebhookEvent?.(record);
  return record;
}

export function filterWebhookEvents(events, filters = {}) {
  const fromTime = filters.from ? new Date(filters.from).getTime() : null;
  const toTime = filters.to ? new Date(filters.to).getTime() : null;
  const q = String(filters.q ?? '').trim().toLowerCase();
  return events.filter((event) => {
    const created = new Date(event.receivedAt ?? event.processedAt ?? 0).getTime();
    if (filters.tenantId && event.tenantId !== filters.tenantId) return false;
    if (filters.provider && event.provider !== filters.provider) return false;
    if (filters.status && event.status !== filters.status) return false;
    if (fromTime && created < fromTime) return false;
    if (toTime && created > toTime) return false;
    if (!q) return true;
    return [
      event.provider,
      event.tenantId,
      event.eventType,
      event.externalId,
      event.status,
      event.errorCode,
      event.errorMessage,
      event.conversationId,
    ].some((value) => String(value ?? '').toLowerCase().includes(q));
  });
}

export function summarizeWebhookEvents(events) {
  const byStatus = countBy(events, (event) => event.status);
  const byProvider = countBy(events, (event) => event.provider);
  const failed = events.filter((event) => ['failed', 'rejected'].includes(event.status));
  const durations = events.map((event) => Number(event.durationMs ?? 0)).filter((value) => value > 0);
  const avgDurationMs = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
  return {
    total: events.length,
    processed: byStatus.processed ?? 0,
    failed: failed.length,
    rejected: byStatus.rejected ?? 0,
    duplicates: byStatus.duplicate ?? 0,
    ignored: byStatus.ignored ?? 0,
    avgDurationMs,
    lastReceivedAt: events[0]?.receivedAt ?? null,
    byStatus,
    byProvider,
  };
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item) ?? 'unknown';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const normalized = key.toLowerCase();
    if (SECRET_KEYS.has(normalized) || normalized.includes('secret') || normalized.includes('token')) return [key, '***'];
    return [key, redact(item)];
  }));
}

function mergeDeep(base, patch) {
  const output = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeDeep(output[key] ?? {}, value)
      : value;
  }
  return output;
}
