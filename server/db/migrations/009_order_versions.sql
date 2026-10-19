ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS orders_tenant_version_idx
  ON orders (tenant_id, version DESC);
