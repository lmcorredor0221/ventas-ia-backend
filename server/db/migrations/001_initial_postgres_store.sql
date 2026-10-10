CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL,
  schema_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  plan TEXT,
  whatsapp_number TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  lifecycle JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'mercado_pago',
  status TEXT NOT NULL,
  payer_email TEXT,
  mercado_pago_preapproval_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS google_connections (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  account_email TEXT,
  refresh_token_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS google_workspaces (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  spreadsheet_id TEXT,
  root_folder_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  provisioned_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_bindings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  phone_number_id_ref TEXT,
  phone_number_id TEXT,
  access_token_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_id TEXT,
  status TEXT NOT NULL,
  stage TEXT,
  value TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_tenant_updated_idx ON conversations (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversations_tenant_wa_idx ON conversations (tenant_id, wa_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT,
  wa_id TEXT,
  status TEXT NOT NULL,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_tenant_created_idx ON orders (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  conversation_id TEXT,
  type TEXT NOT NULL,
  detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_tenant_created_idx ON events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_type_created_idx ON events (type, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period, metric)
);

CREATE TABLE IF NOT EXISTS secret_references (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'environment',
  purpose TEXT NOT NULL,
  ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);
