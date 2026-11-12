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
  // Drive/Sheets is tenant-managed source data. PostgreSQL is the operational
  // catalog in production, so a WhatsApp interaction never depends on Drive.
  catalogReadSource: process.env.CATALOG_READ_SOURCE
    ?? (process.env.NODE_ENV === 'production' ? 'postgres' : 'google'),
  // Customer profiles follow the same operational rule in production. Google
  // may remain an administration mirror, but a new inbound conversation must
  // not wait on it to learn whether a customer profile exists.
  customerProfileReadSource: process.env.CUSTOMER_PROFILE_READ_SOURCE
    ?? (process.env.NODE_ENV === 'production' ? 'postgres' : 'google'),
  // Catalog publication is an explicit tenant action. The scheduled worker is
  // opt-in only for controlled maintenance jobs and must never be enabled by
  // an old CATALOG_SYNC_WORKER_ENABLED variable alone.
  catalogSyncMode: process.env.CATALOG_SYNC_MODE === 'scheduled' ? 'scheduled' : 'on_demand',
  catalogSyncWorkerEnabled: process.env.CATALOG_SYNC_WORKER_ENABLED === 'true',
  // A catalog read must not publish or rebuild an index as a side effect.
  // Legacy/local callers may opt in explicitly for compatibility tests.
  catalogAutoSyncOnRead: process.env.CATALOG_AUTO_SYNC_ON_READ === 'true',
  catalogSyncIntervalMs: Number(process.env.CATALOG_SYNC_INTERVAL_MS ?? 300000),
  defaultTenantId: process.env.DEFAULT_TENANT_ID ?? 'andina',
  timezone: process.env.AGENT_TIMEZONE ?? 'America/Bogota',
  // Keep the default aligned with the webhook version configured in Meta.
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v26.0',
  whatsappTenantTokenLifetimeDays: Number(process.env.WHATSAPP_TENANT_TOKEN_LIFETIME_DAYS ?? 60),
  whatsappTenantTokenRenewalWindowDays: Number(process.env.WHATSAPP_TENANT_TOKEN_RENEWAL_WINDOW_DAYS ?? 14),
  whatsappMode: process.env.WHATSAPP_PROVIDER_MODE ?? 'mock',
  llmRequestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 8000),
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 600),
  llmJsonRetryMaxTokens: Number(process.env.LLM_JSON_RETRY_MAX_TOKENS ?? 1800),
  // The contextual catalog adjudication is opt-in until the local contracts
  // validate the new evidence/selection state. The legacy resolver remains
  // the safe fallback when this flag is false.
  contextualProductSelectionV2: process.env.CONTEXTUAL_PRODUCT_SELECTION_V2 === 'true',
  // A non-empty allowlist takes precedence over the global switch. It lets us
  // validate contextual selection with one tenant before any wider rollout.
  contextualProductSelectionTenants: String(process.env.CONTEXTUAL_PRODUCT_SELECTION_TENANTS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean),
  // A vague commercial request remains an autonomous conversation for two
  // contextual clarification turns before it becomes a human case.
  clarificationMaxAttempts: Number(process.env.CLARIFICATION_MAX_ATTEMPTS ?? 2),
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
  // Kept only for backwards-compatible configuration introspection. The
  // PostgreSQL store now enforces incremental persistence regardless of the
  // old flag, so a normal mutation can never fall back to app_state snapshot.
  postgresIncrementalPersistenceEnabled: true,
  asyncInboundEnabled: (process.env.WHATSAPP_ASYNC_INBOUND_ENABLED ?? process.env.ASYNC_INBOUND_ENABLED) === 'true',
  backgroundWorkersEnabled: process.env.BACKGROUND_WORKERS_ENABLED
    ? process.env.BACKGROUND_WORKERS_ENABLED === 'true'
    : true,
  integrationOutboxMaxAttempts: Number(process.env.INTEGRATION_OUTBOX_MAX_ATTEMPTS ?? 8),
  llmResponseComposerEnabled: process.env.LLM_RESPONSE_COMPOSER_ENABLED !== 'false',
  // Context and product inference are separate provider calls. Keep an
  // explicit rollback switch while the new contracts are validated locally.
  llmTwoStageInterpretationEnabled: process.env.LLM_TWO_STAGE_INTERPRETATION_ENABLED !== 'false',
  catalogKnowledgeIndexEnabled: process.env.CATALOG_KNOWLEDGE_INDEX_ENABLED !== 'false',
  // PostgreSQL is the operational retrieval engine for published catalogs.
  // Keep this opt-in until a tenant has been published into the native
  // projection (FTS + trigram + relations); legacy graph snapshots remain a
  // safe rollback path while the migration is rolled out.
  catalogNativeSearchEnabled: process.env.CATALOG_NATIVE_SEARCH_ENABLED === 'true',
  catalogNativeSearchCandidateLimit: Number(process.env.CATALOG_NATIVE_SEARCH_CANDIDATE_LIMIT ?? 40),
  // A 3,000-product graph snapshot is materially larger than a normal cache
  // entry. Bound resident tenant indexes so a busy store cannot evict every
  // other request through memory pressure. Operators may raise this only after
  // measuring the instance's memory headroom.
  catalogIndexMaxCachedTenants: Number(process.env.CATALOG_INDEX_MAX_CACHED_TENANTS
    ?? (process.env.NODE_ENV === 'production' ? 2 : 8)),
  // Count alone is not a safe multitenant memory limit: catalogs can have
  // very different sizes. The cache enforces this conservative resident
  // budget in addition to the tenant count.
  catalogIndexMaxCachedBytes: Number(process.env.CATALOG_INDEX_MAX_CACHED_BYTES
    ?? (process.env.NODE_ENV === 'production' ? 64 * 1024 * 1024 : 256 * 1024 * 1024)),
  telemetryMaxSamples: Number(process.env.TELEMETRY_MAX_SAMPLES ?? 4000),
  telemetryMaxTraces: Number(process.env.TELEMETRY_MAX_TRACES ?? 1000),
  telemetrySlowThresholdMs: Number(process.env.TELEMETRY_SLOW_THRESHOLD_MS ?? 1000),
  telemetryLogTraces: process.env.TELEMETRY_LOG_TRACES !== 'false',
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
