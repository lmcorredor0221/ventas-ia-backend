-- The published Basic plan includes seven days to configure the tenant before payment.
UPDATE billing_plans
SET trial_enabled = true,
    trial_days = 7,
    updated_at = now()
WHERE id = 'ventas_ia_400_domicilios';
