export const RUNTIME_CONFIG = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '127.0.0.1',
  // The browser-facing application can live on a different origin than the API.
  // OAuth callbacks use this address to return the owner to its onboarding step.
  frontendAppUrl: process.env.FRONTEND_APP_URL ?? process.env.PUBLIC_APP_URL ?? `http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3001}`,
  corsAllowedOrigins: String(process.env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  storageDriver: process.env.STORAGE_DRIVER ?? (process.env.DATABASE_URL ? 'postgres' : 'json'),
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL ?? 'auto',
  dataFile: process.env.AGENT_DATA_FILE ?? 'server/data/runtime-store.json',
  // Local JSON fixtures keep the desktop simulator usable; production must use live Google data.
  allowLocalCatalogFallback: process.env.ALLOW_LOCAL_CATALOG_FALLBACK === 'true'
    || (process.env.NODE_ENV !== 'production' && (process.env.STORAGE_DRIVER ?? 'json') === 'json'),
  defaultTenantId: process.env.DEFAULT_TENANT_ID ?? 'andina',
  timezone: process.env.AGENT_TIMEZONE ?? 'America/Bogota',
  // Keep the default aligned with the webhook version configured in Meta.
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v26.0',
  whatsappTenantTokenLifetimeDays: Number(process.env.WHATSAPP_TENANT_TOKEN_LIFETIME_DAYS ?? 60),
  whatsappTenantTokenRenewalWindowDays: Number(process.env.WHATSAPP_TENANT_TOKEN_RENEWAL_WINDOW_DAYS ?? 14),
  whatsappMode: process.env.WHATSAPP_PROVIDER_MODE ?? 'mock',
  llmRequestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 8000),
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 600),
  authRequired: process.env.AUTH_REQUIRED === 'true',
  csrfRequired: process.env.CSRF_REQUIRED ? process.env.CSRF_REQUIRED === 'true' : process.env.AUTH_REQUIRED === 'true',
  // The simulated payment endpoint exists for local contracts only. A pending
  // subscription must never become active through it in production.
  allowMockBillingActivation: process.env.ALLOW_MOCK_BILLING_ACTIVATION
    ? process.env.ALLOW_MOCK_BILLING_ACTIVATION === 'true'
    : process.env.NODE_ENV !== 'production',
  allowDevGoogleLogin: process.env.ALLOW_DEV_GOOGLE_LOGIN
    ? process.env.ALLOW_DEV_GOOGLE_LOGIN === 'true'
    : !process.env.GOOGLE_CLIENT_ID,
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'ventas_ia_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  manualCaseInactivityMinutes: Number(process.env.MANUAL_CASE_INACTIVITY_MINUTES ?? 5),
  manualCaseSweepIntervalMs: Number(process.env.MANUAL_CASE_SWEEP_INTERVAL_MS ?? 30_000),
  caseContinuationWindowMinutes: Number(process.env.CASE_CONTINUATION_WINDOW_MINUTES ?? 30),
  integrationOutboxEnabled: process.env.INTEGRATION_OUTBOX_ENABLED === 'true',
  integrationOutboxIntervalMs: Number(process.env.INTEGRATION_OUTBOX_INTERVAL_MS ?? 5000),
  integrationOutboxBatchSize: Number(process.env.INTEGRATION_OUTBOX_BATCH_SIZE ?? 10),
  asyncInboundEnabled: (process.env.WHATSAPP_ASYNC_INBOUND_ENABLED ?? process.env.ASYNC_INBOUND_ENABLED) === 'true',
  backgroundWorkersEnabled: process.env.BACKGROUND_WORKERS_ENABLED
    ? process.env.BACKGROUND_WORKERS_ENABLED === 'true'
    : true,
  integrationOutboxMaxAttempts: Number(process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS ?? 8),
  llmResponseComposerEnabled: process.env.LLM_RESPONSE_COMPOSER_ENABLED !== 'false',
};

export const REQUIRED_EVENTS = [
  'agent.started',
  'agent.completed',
  'agent.failed',
  'decision.requested',
  'decision.resolved',
  'tool.binding.changed',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'fallback.activated',
  'budget.threshold_reached',
  'incident.opened',
  'incident.closed',
];
