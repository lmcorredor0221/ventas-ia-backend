-- Align the persisted relational projection with the current Basic plan.
UPDATE billing_plans
SET id = 'ventas_ia_400_domicilios',
    name = 'Ventas IA Basico',
    description = 'Plan mensual base para tiendas con hasta 400 domicilios por ciclo.',
    included_deliveries = 400,
    included_interactions = 2700,
    updated_at = now()
WHERE id = 'ventas_ia_1000_domicilios'
  AND NOT EXISTS (SELECT 1 FROM billing_plans WHERE id = 'ventas_ia_400_domicilios');

UPDATE billing_plans
SET is_active = false,
    is_default = false,
    updated_at = now()
WHERE id = 'ventas_ia_1000_domicilios';

UPDATE subscriptions
SET plan_id = 'ventas_ia_400_domicilios',
    updated_at = now()
WHERE plan_id = 'ventas_ia_1000_domicilios';

UPDATE tenants
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(payload, '{config,saas,planCode}', '"ventas_ia_400_domicilios"'::jsonb, true),
    '{config,saas,includedDeliveries}', '400'::jsonb, true
  ),
  '{config,saas,includedInteractions}', '2700'::jsonb, true
)
WHERE payload #>> '{config,saas,planCode}' = 'ventas_ia_1000_domicilios';

UPDATE billing_usage_cycles
SET payload = jsonb_set(
  jsonb_set(payload, '{includedDeliveries}', '400'::jsonb, true),
  '{includedInteractions}', '2700'::jsonb, true
)
WHERE payload ? 'includedDeliveries'
  AND (payload->>'includedDeliveries')::int = 1000;
