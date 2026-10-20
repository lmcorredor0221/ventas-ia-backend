CREATE TABLE IF NOT EXISTS inbound_messages (
  message_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  phone_number_id TEXT,
  wa_id TEXT,
  message_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  result JSONB
);

CREATE INDEX IF NOT EXISTS inbound_messages_tenant_received_idx
  ON inbound_messages (tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS inbound_messages_status_received_idx
  ON inbound_messages (status, received_at ASC);

CREATE TABLE IF NOT EXISTS interaction_offers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  order_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_option_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interaction_offers_lookup_idx
  ON interaction_offers (tenant_id, conversation_id, status, expires_at);
