import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-catalog-'));
const { app, controlPlane, store } = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  allowLocalCatalogFallback: true,
});
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const created = controlPlane.createTenant({
    storeName: 'Tienda Catalogo CSV',
    ownerEmail: 'catalogo@example.com',
    ownerName: 'Prueba Catalogo',
  });
  const tenantId = created.tenant.id;
  controlPlane.mockActivateSubscription(tenantId);
  const oauth = controlPlane.beginGoogleOAuth(tenantId, { loginHint: 'catalogo@example.com' });
  await fetch(`${base}/api/saas/google/oauth/callback?state=${oauth.state}&code=dev-mock-code&mockAccountEmail=catalogo%40example.com`);
  await fetch(`${base}/api/saas/tenants/${tenantId}/google/provision`, { method: 'POST' });

  const csv = [
    'sku,nombre,categoria,marca,presentacion,precio,stock,aliases,activo',
    'CAT-001,Chocoramo,Pasabocas,Ramo,65 g,2800,12,chocorramo|ponque,true',
    'CAT-002,Coca-Cola,Bebidas,Coca-Cola,350 ml,3500,8,coca|gaseosa,true',
  ].join('\n');
  const validationResponse = await fetch(`${base}/api/saas/tenants/${tenantId}/google/catalog/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csvText: csv }),
  });
  assert.equal(validationResponse.status, 200);
  const validation = await validationResponse.json();
  assert.equal(validation.valid, true);
  assert.equal(validation.totalRows, 2);
  assert.equal(validation.canImport, true);

  const importResponse = await fetch(`${base}/api/saas/tenants/${tenantId}/google/catalog/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csvText: csv, fileName: 'catalogo.csv' }),
  });
  assert.equal(importResponse.status, 200);
  const imported = await importResponse.json();
  assert.equal(imported.status, 'imported');
  assert.equal(imported.source, 'local_test_fixture');
  assert.equal(imported.activeRows, 2);
  assert.equal(store.getState().productsByTenant[tenantId][0].name, 'Chocoramo');

  const invalidResponse = await fetch(`${base}/api/saas/tenants/${tenantId}/google/catalog/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csvText: 'sku,nombre,precio,stock\nCAT-001,Duplicado,not-a-price,4\nCAT-001,Otro,2000,1' }),
  });
  const invalid = await invalidResponse.json();
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((item) => item.field === 'precio'));
  assert.ok(invalid.errors.some((item) => item.field === 'sku'));
} finally {
  server.close();
}

console.log('Catalog CSV import checks passed');
