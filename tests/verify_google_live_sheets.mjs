import assert from 'node:assert/strict';
import { createAppAsync } from '../server/index.js';

const tenantId = process.env.GOOGLE_LIVE_TENANT_ID ?? process.argv[2] ?? 'tienda-piloto-google';
const testPhone = process.env.GOOGLE_LIVE_TEST_WA_ID ?? `57300${Date.now().toString().slice(-7)}`;

const runtime = await createAppAsync();
const { store, tools, secretVault, googleWorkspace } = runtime;

try {
  const state = store.getState();
  const connection = state.googleConnectionsByTenant?.[tenantId];
  const workspace = state.googleWorkspacesByTenant?.[tenantId];
  assert.equal(connection?.status, 'connected', `Tenant ${tenantId} must have Google connected`);
  assert.equal(connection?.mode, 'live', `Tenant ${tenantId} must use live Google mode`);
  assert.equal(workspace?.status, 'provisioned', `Tenant ${tenantId} must have a provisioned workspace`);
  assert.ok(workspace?.spreadsheet?.id, `Tenant ${tenantId} must have a Google spreadsheet id`);

  const refreshToken = secretVault.readSecret(connection.refreshTokenRef);
  assert.ok(refreshToken, 'Google refresh token must be available through the secret vault');
  const accessToken = await googleWorkspace.refreshAccessToken(refreshToken);

  const catalog = await tools.call('google_sheets_read_table', tenantId, 'google-live-sheets-e2e', {
    filters: { query: 'chocoramo' },
  });
  assert.equal(catalog.source, 'google_sheets_live');
  assert.ok(catalog.rows.length > 0, 'Catalogo query should return rows from Google Sheets');
  assert.ok(catalog.rows.some((row) => /chocoramo/i.test(row.name) || row.aliases?.some((alias) => /chocoramo/i.test(alias))));

  const upsert = await tools.call('google_sheets_customer_profile_upsert', tenantId, 'google-live-sheets-e2e', {
    wa_id: testPhone,
    name: 'Cliente Prueba Google Live',
    defaultAddress: 'Calle 127 # 15-30',
    neighborhood: 'Cedritos',
    notes: 'Prueba automatizada local',
    preferences: { canal: 'whatsapp', prueba: 'google_live_sheets' },
  });
  assert.equal(upsert.source, 'google_sheets_live');

  const lookup = await tools.call('google_sheets_customer_profile_lookup', tenantId, 'google-live-sheets-e2e', {
    wa_id: testPhone,
  });
  assert.equal(lookup.source, 'google_sheets_live');
  assert.equal(lookup.status, 'found');
  assert.equal(lookup.profile.name, 'Cliente Prueba Google Live');

  const order = await tools.call('google_sheets_order_write', tenantId, 'google-live-sheets-e2e', {
    wa_id: testPhone,
    customer_name: 'Cliente Prueba Google Live',
    delivery_address: 'Calle 127 # 15-30',
    items: [
      {
        sku: catalog.rows[0].sku,
        name: catalog.rows[0].name,
        quantity: 2,
        unitPrice: catalog.rows[0].price,
        lineTotal: catalog.rows[0].price * 2,
      },
    ],
    subtotal: catalog.rows[0].price * 2,
    status: 'confirmado',
  });
  assert.equal(order.source, 'google_sheets_live');
  assert.equal(order.source_ref, 'Pedidos!A:M');

  const customerRows = await googleWorkspace.readValues({
    accessToken,
    spreadsheetId: workspace.spreadsheet.id,
    range: 'Clientes!A1:H1000',
  });
  const orderRows = await googleWorkspace.readValues({
    accessToken,
    spreadsheetId: workspace.spreadsheet.id,
    range: 'Pedidos!A1:M1000',
  });
  assert.ok(customerRows.some((row) => row[0] === testPhone && row[1] === 'Cliente Prueba Google Live'));
  assert.ok(orderRows.some((row) => row[1] === testPhone && row[6] === 'confirmado'));

  await store.flush?.();
  console.log(JSON.stringify({
    tenantId,
    spreadsheetId: workspace.spreadsheet.id,
    catalogMatches: catalog.rows.length,
    customerRef: lookup.source_ref,
    orderRef: order.source_ref,
    testPhone,
  }, null, 2));
} finally {
  await store.close?.();
}
