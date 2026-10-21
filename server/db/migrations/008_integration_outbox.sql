CREATE TABLE IF NOT EXISTS integration_outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  kind TEXT NOT NULL,
  aggregate_type TEXT,
  aggregate_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS integration_outbox_pending_idx
  ON integration_outbox (status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS integration_outbox_tenant_idx
  ON integration_outbox (tenant_id, created_at DESC);
