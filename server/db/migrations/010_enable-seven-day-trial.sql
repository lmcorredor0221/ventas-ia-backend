-- The commercial Basic plan begins with the documented seven-day free trial.
UPDATE billing_plans
SET trial_enabled = true,
    trial_days = 7,
    updated_at = now()
WHERE id = 'ventas_ia_400_domicilios';
