import { createAppAsync } from '../server/index.js';

const now = process.argv[2] ?? new Date().toISOString();
const runtime = await createAppAsync();

try {
  const result = runtime.controlPlane.runBillingMaintenance({
    now,
    actor: { id: 'local-maintenance', email: 'local-maintenance@ventas-ia.local' },
  });
  await runtime.store.flush?.();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await runtime.store.close?.();
}
