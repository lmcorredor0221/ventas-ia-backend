import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const originalEnv = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,
};
const originalFetch = global.fetch;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-google-live-'));

process.env.GOOGLE_CLIENT_ID = 'google-client-test';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret-test';
process.env.SECRET_ENCRYPTION_KEY = 'test-secret-key-with-enough-entropy';

const outboundCalls = [];
const liveSheets = {
  Catalogo: [
    ['sku', 'nombre', 'categoria', 'marca', 'presentacion', 'precio', 'stock', 'aliases', 'activo', 'drive_file_id'],
    ['LIVE-CHO-01', 'Chocoramo', 'Snacks', 'Ramo', '65 g', '2500', '12', 'chocoramo|ponque ramo', 'TRUE', 'drv-live-chocoramo'],
  ],
  Clientes: [
    ['telefono_whatsapp', 'nombre', 'direccion_principal', 'barrio', 'notas', 'preferencias', 'creado_en', 'actualizado_en'],
  ],
  Pedidos: [
    ['pedido_id', 'telefono_whatsapp', 'cliente', 'direccion', 'items_json', 'subtotal', 'estado', 'handoff_id', 'creado_en', 'actualizado_en', 'origen', 'llm_modelo', 'traza'],
  ],
};
let base = '';

global.fetch = async (url, options = {}) => {
  const href = String(url);
  if (base && href.startsWith(base)) return originalFetch(url, options);
  outboundCalls.push({ url: href, options });

  if (href === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(String(options.body));
    if (body.get('grant_type') === 'authorization_code') {
      return jsonResponse({
        access_token: 'access-token-initial',
        refresh_token: 'refresh-token-sensitive',
        expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
        id_token: fakeIdToken({ email: 'dueno-google-live@example.com' }),
      });
    }
    if (body.get('grant_type') === 'refresh_token') {
      assert.equal(body.get('refresh_token'), 'refresh-token-sensitive');
      return jsonResponse({ access_token: 'access-token-refreshed', expires_in: 3600 });
    }
  }

  if (href.startsWith('https://www.googleapis.com/drive/v3/files') && options.method === 'POST') {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const body = JSON.parse(options.body);
    return jsonResponse({
      id: `drv-${slug(body.name)}`,
      name: body.name,
      webViewLink: `https://drive.google.com/${slug(body.name)}`,
    });
  }

  if (href.startsWith('https://sheets.googleapis.com/v4/spreadsheets') && options.method === 'POST' && href.endsWith('/spreadsheets')) {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const body = JSON.parse(options.body);
    return jsonResponse({
      spreadsheetId: 'sheet-live-ops',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-live-ops',
      sheets: body.sheets.map((sheet, index) => ({
        properties: { title: sheet.properties.title, sheetId: index + 1 },
      })),
    });
  }

  if (href.includes('/values:batchUpdate')) {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const body = JSON.parse(options.body);
    assert.ok(body.data.some((range) => range.range.startsWith('Catalogo!A1')));
    assert.ok(body.data.some((range) => range.range.startsWith('Clientes!A1')));
    assert.ok(body.data.some((range) => range.range.startsWith('Pedidos!A1')));
    return jsonResponse({ totalUpdatedCells: 36 });
  }

  if (href.startsWith('https://sheets.googleapis.com/v4/spreadsheets/') && href.includes('/values/') && href.includes(':clear')) {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    return jsonResponse({ clearedRange: 'Catalogo!A1:J1000' });
  }

  if (href.startsWith('https://sheets.googleapis.com/v4/spreadsheets/') && href.includes('/values/') && options.method === 'GET') {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const range = decodeURIComponent(href.split('/values/')[1].split('?')[0]);
    const sheetName = range.split('!')[0];
    return jsonResponse({ range, values: liveSheets[sheetName] ?? [] });
  }

  if (href.startsWith('https://sheets.googleapis.com/v4/spreadsheets/') && href.includes('/values/') && href.includes(':append')) {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const range = decodeURIComponent(href.split('/values/')[1].split(':append')[0]);
    const sheetName = range.split('!')[0];
    const body = JSON.parse(options.body);
    liveSheets[sheetName] ??= [];
    liveSheets[sheetName].push(...(body.values ?? []));
    return jsonResponse({ updates: { updatedRows: body.values?.length ?? 0 } });
  }

  if (href.startsWith('https://sheets.googleapis.com/v4/spreadsheets/') && href.includes('/values/') && options.method === 'PUT') {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const range = decodeURIComponent(href.split('/values/')[1].split('?')[0]);
    const sheetName = range.split('!')[0];
    const rowNumber = Number(range.match(/![A-Z]+(\d+):/)?.[1]);
    const body = JSON.parse(options.body);
    if (sheetName === 'Catalogo') {
      assert.equal(body.values.length, 3);
      liveSheets[sheetName] = body.values;
      return jsonResponse({ updatedRows: body.values.length });
    }
    if (rowNumber && liveSheets[sheetName]) liveSheets[sheetName][rowNumber - 1] = body.values[0];
    return jsonResponse({ updatedRows: body.values?.length ?? 0 });
  }

  if (href.includes(':batchUpdate')) {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    const body = JSON.parse(options.body);
    assert.ok(body.requests.some((request) => request.setDataValidation));
    return jsonResponse({ replies: [{}] });
  }

  if (href.startsWith('https://www.googleapis.com/drive/v3/files/') && options.method === 'PATCH') {
    assert.equal(options.headers.authorization, 'Bearer access-token-refreshed');
    return jsonResponse({ id: 'sheet-live-ops', parents: ['drv-root'] });
  }

  return jsonResponse({ error: `Unhandled mock URL ${href}` }, 500);
};

const { app, store, secretVault, integrationOutbox } = await createAppAsync({
  dataFile: path.join(tempDir, 'store.json'),
  storageDriver: 'json',
  integrationOutboxEnabled: true,
  backgroundWorkersEnabled: false,
});
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  base = `http://127.0.0.1:${port}`;

  const createdTenant = await postJson(`${base}/api/saas/tenants`, {
    storeName: 'Tienda Google Live',
    ownerEmail: 'dueno-google-live@example.com',
    ownerName: 'Dueño Google Live',
    whatsappNumber: '+57 300 222 0000',
  }, { expectedStatus: 201 });
  const tenantId = createdTenant.tenant.id;

  await postJson(`${base}/api/saas/tenants/${tenantId}/subscription/mock-activate`, {});
  const oauthStart = await getJson(`${base}/api/saas/tenants/${tenantId}/google/oauth/start`);
  assert.equal(oauthStart.ready, true);
  assert.ok(oauthStart.authorizationUrl.includes('client_id=google-client-test'));

  const oauthCallback = await getJson(`${base}/api/saas/google/oauth/callback?state=${oauthStart.state}&code=live-code`);
  assert.equal(oauthCallback.connection.status, 'connected');
  assert.equal(oauthCallback.connection.mode, 'live');
  assert.equal(oauthCallback.connection.accountEmail, 'dueno-google-live@example.com');
  assert.equal(secretVault.readSecret(oauthCallback.connection.refreshTokenRef), 'refresh-token-sensitive');
  assert.equal(JSON.stringify(store.getState()).includes('refresh-token-sensitive'), false);

  const provision = await postJson(`${base}/api/saas/tenants/${tenantId}/google/provision`, {});
  assert.equal(provision.workspace.status, 'provisioned');
  assert.equal(provision.workspace.mode, 'live');
  assert.equal(provision.workspace.spreadsheet.id, 'sheet-live-ops');
  assert.ok(provision.workspace.folders.some((folder) => folder.name === 'Catalogo y soportes'));

  const tenant = store.getState().tenants.find((item) => item.id === tenantId);
  assert.equal(tenant.config.googleSheets.spreadsheetIdRef, `${tenantId.toUpperCase()}_GOOGLE_SHEETS_OPS_SPREADSHEET_ID_REF`);
  assert.ok(outboundCalls.some((call) => call.url.includes('/values:batchUpdate')));

  const catalogSmoke = await postJson(`${base}/api/tools/google_sheets_read_table/smoke-test`, {
    tenantId,
    payload: { filters: { query: 'chocoramo' } },
  });
  assert.equal(catalogSmoke.result.source, 'google_sheets_live');
  assert.equal(catalogSmoke.result.rows[0].sku, 'LIVE-CHO-01');

  const catalogCsv = [
    'sku,nombre,categoria,marca,presentacion,precio,stock,aliases,activo',
    'LIVE-CHO-01,Chocoramo,Snacks,Ramo,65 g,2800,10,chocoramo|ponque ramo,true',
    'LIVE-COC-01,Coca-Cola,Bebidas,Coca-Cola,350 ml,3500,8,coca,true',
  ].join('\n');
  const catalogValidation = await postJson(`${base}/api/saas/tenants/${tenantId}/google/catalog/validate`, { csvText: catalogCsv });
  assert.equal(catalogValidation.valid, true);
  assert.equal(catalogValidation.canImport, true);
  const catalogImport = await postJson(`${base}/api/saas/tenants/${tenantId}/google/catalog/import`, { csvText: catalogCsv, fileName: 'catalogo.csv' });
  assert.equal(catalogImport.source, 'google_sheets_live');
  assert.equal(catalogImport.activeRows, 2);
  assert.equal(liveSheets.Catalogo.length, 3);

  const upsertProfile = await postJson(`${base}/api/tools/google_sheets_customer_profile_upsert/smoke-test`, {
    tenantId,
    payload: {
      wa_id: '573001110001',
      name: 'Cliente Live',
      defaultAddress: 'Calle 123 # 45-67',
      preferences: { channel: 'whatsapp' },
    },
  });
  assert.equal(upsertProfile.result.source_ref, 'Clientes!A:H');

  const profileLookup = await postJson(`${base}/api/tools/google_sheets_customer_profile_lookup/smoke-test`, {
    tenantId,
    payload: { wa_id: '573001110001' },
  });
  assert.equal(profileLookup.result.source, 'google_sheets_live');
  assert.equal(profileLookup.result.profile.name, 'Cliente Live');

  const orderWrite = await postJson(`${base}/api/tools/google_sheets_order_write/smoke-test`, {
    tenantId,
    payload: {
      wa_id: '573001110001',
      customer_name: 'Cliente Live',
      delivery_address: 'Calle 123 # 45-67',
      items: [{ sku: 'LIVE-CHO-01', name: 'Chocoramo', quantity: 2, unitPrice: 2500, lineTotal: 5000 }],
      subtotal: 5000,
    },
  });
  assert.equal(orderWrite.result.source, 'google_sheets_outbox');
  assert.equal(orderWrite.result.projection.status, 'queued');
  assert.equal(liveSheets.Pedidos.length, 1);
  await integrationOutbox.drain();
  assert.equal(liveSheets.Pedidos.length, 2);

  console.log('Google live contract tests passed');
} finally {
  server.close();
  await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
  global.fetch = originalFetch;
  restoreEnv(originalEnv);
}

async function getJson(url) {
  const response = await originalFetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function postJson(url, body, { expectedStatus = 200 } = {}) {
  const response = await originalFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeIdToken(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
