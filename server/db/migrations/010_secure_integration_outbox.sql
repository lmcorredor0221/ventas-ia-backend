ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE integration_outbox FROM anon, authenticated;
