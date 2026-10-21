ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS plan_id TEXT,
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS checkout_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_billing_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS billing_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'COP',
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  billing_frequency TEXT NOT NULL DEFAULT 'monthly',
  included_deliveries INTEGER NOT NULL DEFAULT 400,
  included_interactions INTEGER NOT NULL DEFAULT 2700,
  trial_enabled BOOLEAN NOT NULL DEFAULT false,
  trial_days INTEGER NOT NULL DEFAULT 0,
  grace_days INTEGER NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  mercadopago_plan_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_plans_active_idx ON billing_plans (is_active, is_default);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id TEXT,
  mercadopago_payment_id TEXT,
  mercadopago_preapproval_id TEXT,
  status TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'COP',
  paid_at TIMESTAMPTZ,
  external_reference TEXT,
  receipt_url TEXT,
  raw_status_detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_payments_tenant_paid_idx ON subscription_payments (tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_mp_payment_idx ON subscription_payments (mercadopago_payment_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  subscription_id TEXT,
  provider TEXT NOT NULL DEFAULT 'mercado_pago',
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  status_before TEXT,
  status_after TEXT,
  payload_masked JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_events_tenant_created_idx ON subscription_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_events_external_idx ON subscription_events (external_event_id);

CREATE TABLE IF NOT EXISTS billing_discounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id TEXT,
  discount_type TEXT NOT NULL,
  discount_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_discounts_tenant_status_idx ON billing_discounts (tenant_id, status, ends_at);

CREATE TABLE IF NOT EXISTS billing_access_exceptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS billing_access_exceptions_tenant_status_idx ON billing_access_exceptions (tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS billing_usage_cycles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subscription_id TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  deliveries_used INTEGER NOT NULL DEFAULT 0,
  interactions_used INTEGER NOT NULL DEFAULT 0,
  llm_tokens_used BIGINT NOT NULL DEFAULT 0,
  tool_calls_used INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_usage_cycles_tenant_period_idx ON billing_usage_cycles (tenant_id, period_start DESC);

CREATE TABLE IF NOT EXISTS billing_funnel_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  stage TEXT NOT NULL,
  reason_code TEXT,
  note TEXT,
  actor_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_funnel_events_stage_created_idx ON billing_funnel_events (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_funnel_events_tenant_created_idx ON billing_funnel_events (tenant_id, created_at DESC);
