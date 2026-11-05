process.env.E2E_CAMPAIGN = 'contextual50';
process.env.E2E_CATALOG_REFERENCE_FIXTURE = 'colombia300';
process.env.E2E_MAX_DEEPSEEK_CALLS ??= '1200';
process.env.E2E_RESULT_DIR ??= 'test-results/contextual-acceptance';
await import('./e2e-local-deepseek-40.mjs');
