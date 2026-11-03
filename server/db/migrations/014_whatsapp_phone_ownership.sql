-- Abort on legacy conflicts instead of choosing a tenant or deleting customer data.
DO $$ BEGIN
  IF EXISTS (SELECT phone_number_id FROM whatsapp_bindings
    WHERE phone_number_id IS NOT NULL AND phone_number_id <> ''
    GROUP BY phone_number_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate WhatsApp phone bindings: resolve tenant ownership before migration 014';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_bindings_phone_unique
  ON whatsapp_bindings(phone_number_id) WHERE phone_number_id IS NOT NULL AND phone_number_id <> '';

-- Durable reservation before external registration; snapshots must not release it.
CREATE TABLE IF NOT EXISTS whatsapp_phone_claims (
  phone_number_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO whatsapp_phone_claims(phone_number_id, tenant_id)
  SELECT phone_number_id, tenant_id FROM whatsapp_bindings
  WHERE phone_number_id IS NOT NULL AND phone_number_id <> ''
  ON CONFLICT (tenant_id) DO NOTHING;
ALTER TABLE whatsapp_phone_claims ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE whatsapp_phone_claims FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE whatsapp_phone_claims FROM authenticated;
  END IF;
END $$;
