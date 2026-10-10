CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  tenant_id TEXT,
  event_type TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  idempotency_key TEXT,
  payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  headers_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  conversation_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS webhook_events_received_idx ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_tenant_received_idx ON webhook_events (tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_provider_status_idx ON webhook_events (provider, status, received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_external_idx ON webhook_events (external_id);
