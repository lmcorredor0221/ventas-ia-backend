import assert from 'node:assert/strict';
import { createAppAsync } from '../index.js';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set POSTGRES_TEST_DATABASE_URL or DATABASE_URL before running this contract');

const kit = await createAppAsync({
  storageDriver: 'postgres',
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL ?? 'disable',
  authRequired: false,
  csrfRequired: false,
});
const { app, store } = kit;
const tenantId = 'andina';
const original = structuredClone(store.getState().tenants.find((tenant) => tenant.id === tenantId));
if (!original) throw new Error(`Missing tenant ${tenantId}`);
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const response = await fetch(`http://127.0.0.1:${port}/api/tenants/${tenantId}/config`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      googleSheets: { catalogRange: 'Catalogo!A1:Q1000' },
      orderPolicy: { deliveryFee: 0, deliveryMinimumSubtotal: 10000 },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.config.googleSheets.catalogRange, 'Catalogo!A1:Q1000');
  assert.equal(body.config.orderPolicy.deliveryFee, 0);
  assert.equal(body.config.orderPolicy.deliveryMinimumSubtotal, 10000);

  const persisted = await store.pool.query('SELECT payload FROM tenants WHERE id = $1', [tenantId]);
  assert.equal(persisted.rows[0].payload.config.googleSheets.catalogRange, 'Catalogo!A1:Q1000');
  assert.equal(persisted.rows[0].payload.config.orderPolicy.deliveryFee, 0);
  assert.equal(persisted.rows[0].payload.config.orderPolicy.deliveryMinimumSubtotal, 10000);
  console.log('tenant-config-postgres: ok');
} finally {
  const liveTenant = store.getState().tenants.find((tenant) => tenant.id === tenantId);
  Object.assign(liveTenant, original);
  store.mutate((state) => {
    const target = state.tenants.find((tenant) => tenant.id === tenantId);
    Object.assign(target, structuredClone(original));
  });
  await store.persistTenantCritical(tenantId);
  server.close();
  await store.close?.();
}
