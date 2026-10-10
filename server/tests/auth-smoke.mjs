import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-auth-'));
const { app, store } = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  authRequired: true,
  csrfRequired: true,
});
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  await getJson(`${base}/api/ops/overview?tenantId=andina`, { expectedStatus: 401 });

  const login = await postJson(`${base}/api/auth/google`, {
    idToken: 'dev-google-id-token',
    profile: {
      sub: 'google-auth-smoke-andina',
      email: 'andina@example.local',
      name: 'Owner Andina',
    },
  });
  const cookie = login.cookie;
  const csrfToken = login.body.session.csrfToken;
  assert.ok(cookie.includes('ventas_ia_session='));
  assert.ok(csrfToken);
  assert.ok(login.body.memberships.some((member) => member.tenantId === 'andina' && member.role === 'owner'));

  const me = await getJson(`${base}/api/auth/me`, { cookie });
  assert.equal(me.body.user.email, 'andina@example.local');

  const tenants = await getJson(`${base}/api/tenants`, { cookie });
  assert.ok(tenants.body.some((tenant) => tenant.id === 'andina'));
  assert.equal(tenants.body.some((tenant) => tenant.id === 'norte'), false);

  const allowedOverview = await getJson(`${base}/api/ops/overview?tenantId=andina`, { cookie });
  assert.equal(allowedOverview.body.tenant.id, 'andina');

  await getJson(`${base}/api/ops/overview?tenantId=norte`, { cookie, expectedStatus: 403 });

  await postJson(`${base}/api/saas/tenants`, {
    storeName: 'Tienda Auth Smoke',
    whatsappNumber: '+57 300 222 3333',
  }, { cookie, expectedStatus: 403 });

  const created = await postJson(`${base}/api/saas/tenants`, {
    storeName: 'Tienda Auth Smoke',
    whatsappNumber: '+57 300 222 3333',
  }, { cookie, csrfToken, expectedStatus: 201 });
  assert.equal(created.body.tenant.lifecycle.ownerEmail, 'andina@example.local');

  const afterCreate = await getJson(`${base}/api/tenants`, { cookie });
  assert.ok(afterCreate.body.some((tenant) => tenant.id === created.body.tenant.id));

  const state = store.getState();
  assert.ok(state.auditEvents.some((event) => event.action === 'auth.login'));
  assert.ok(state.auditEvents.some((event) => event.action === 'tenant.create'));

  console.log('Auth smoke tests passed');
} finally {
  server.close();
  await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

async function getJson(url, { cookie, expectedStatus = 200 } = {}) {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  return { body: text ? JSON.parse(text) : {}, headers: response.headers };
}

async function postJson(url, body, { cookie, csrfToken, expectedStatus = 200 } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  return {
    body: text ? JSON.parse(text) : {},
    headers: response.headers,
    cookie: response.headers.get('set-cookie') ?? '',
  };
}
