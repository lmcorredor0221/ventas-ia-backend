-- Keep the runtime document in sync with the relational billing plan.
-- Existing tenants are read from app_state.document, so updating only
-- billing_plans leaves their owner-facing onboarding stuck on payment.
UPDATE app_state
SET document = jsonb_set(
  document,
  '{billingPlans}',
  (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN plan->>'id' = 'ventas_ia_400_domicilios' THEN
            jsonb_set(
              jsonb_set(plan, '{trialEnabled}', 'true'::jsonb, true),
              '{trialDays}',
              '7'::jsonb,
              true
            )
          ELSE plan
        END
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(COALESCE(document->'billingPlans', '[]'::jsonb)) AS plan
  ),
  true
),
updated_at = now()
WHERE id = 'runtime';
