CREATE TABLE IF NOT EXISTS products (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  price NUMERIC(14, 2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  drive_file_id TEXT,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS products_tenant_category_idx ON products (tenant_id, category);
CREATE INDEX IF NOT EXISTS products_payload_gin_idx ON products USING gin (payload);

CREATE TABLE IF NOT EXISTS drive_files (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, file_id)
);

CREATE INDEX IF NOT EXISTS drive_files_tenant_name_idx ON drive_files (tenant_id, name);

CREATE TABLE IF NOT EXISTS customer_profiles (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  name TEXT,
  default_address TEXT,
  phone TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, wa_id)
);

CREATE INDEX IF NOT EXISTS customer_profiles_tenant_name_idx ON customer_profiles (tenant_id, name);

CREATE TABLE IF NOT EXISTS pending_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  urgency TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_requests_tenant_status_idx ON pending_requests (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id TEXT,
  action_name TEXT,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_tenant_created_idx ON transactions (tenant_id, created_at DESC);
