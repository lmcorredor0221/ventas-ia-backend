ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;

-- Render/local PostgreSQL instances do not necessarily include Supabase roles.
-- Revoke privileges when those roles exist without making a fresh deployment
-- depend on a Supabase-only role catalogue.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE integration_outbox FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE integration_outbox FROM authenticated;
  END IF;
END
$$;
