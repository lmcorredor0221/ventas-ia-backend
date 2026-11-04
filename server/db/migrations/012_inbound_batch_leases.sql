CREATE TABLE IF NOT EXISTS inbound_batch_leases (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_batch_leases_expiry_idx
  ON inbound_batch_leases (lease_until);
