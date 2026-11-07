CREATE TABLE IF NOT EXISTS usage_budget_alerts (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  alert_key TEXT NOT NULL,
  threshold NUMERIC(6, 4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period, alert_key)
);

CREATE INDEX IF NOT EXISTS usage_budget_alerts_tenant_period_idx
  ON usage_budget_alerts (tenant_id, period);
