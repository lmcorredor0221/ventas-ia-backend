CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  conversation_id TEXT,
  provider TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS processed_messages_tenant_created_idx ON processed_messages (tenant_id, created_at DESC);
