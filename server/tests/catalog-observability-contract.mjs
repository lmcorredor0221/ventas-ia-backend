import assert from 'node:assert/strict';
import { ToolRegistry } from '../services/toolRegistry.js';

const tenantId = 'tenant-catalog-observability';
const events = [];
const state = {
  tenants: [{
    id: tenantId,
    config: { googleSheets: { catalogRange: 'Catalogo!A1:J1000' } },
  }],
  googleConnectionsByTenant: {
    [tenantId]: { status: 'connected', mode: 'live', refreshTokenRef: 'secret-ref' },
  },
  googleWorkspacesByTenant: {
    [tenantId]: { spreadsheet: { id: 'sheet-live-123456789' } },
  },
  productsByTenant: {},
  driveFilesByTenant: {},
};

const store = {
  getState: () => state,
  mutate: (mutator) => mutator(state),
};

const googleWorkspace = {
  refreshAccessToken: async (refreshToken) => {
    assert.equal(refreshToken, 'refresh-token');
    return 'access-token';
  },
  readValues: async ({ accessToken, spreadsheetId, range }) => {
    assert.equal(accessToken, 'access-token');
    assert.equal(spreadsheetId, 'sheet-live-123456789');
    assert.equal(range, 'Catalogo!A1:J1000');
    return [
      ['sku', 'nombre', 'categoria', 'marca', 'presentacion', 'precio', 'stock', 'aliases', 'activo', 'descripcion'],
      ['BOG-BEB-044', 'Coca-Cola original', 'Gaseosas', 'Coca-Cola', '1.5 L', '7200', '24', 'coca cola litro y medio|coca 1.5', 'TRUE', 'Gaseosa original en botella familiar'],
      ['BOG-PAN-019', 'Ponque Chocoramo', 'Panaderia', 'Ramo', '65 g', '2800', '55', 'chocorramo|ponque ramo', 'TRUE', 'Ponque cubierto de chocolate'],
    ];
  },
};

const secretVault = { readSecret: (ref) => (ref === 'secret-ref' ? 'refresh-token' : null) };
const registry = new ToolRegistry({
  store,
  events: { emit: (event) => { events.push(event); return event; } },
  usage: null,
  config: { allowLocalCatalogFallback: false },
  googleWorkspace,
  secretVault,
});

const result = await registry.googleSheetsReadTable(tenantId, {
  filters: { query: 'Coca Cola litro y medio' },
});

assert.equal(result.source, 'google_sheets_live');
assert.equal(result.rows.length, 1);
assert.equal(result.rows[0].sku, 'BOG-BEB-044');

const readEvent = events.find((event) => event.type === 'catalog.source.read');
assert.ok(readEvent, 'catalog.source.read event should be emitted');
assert.equal(readEvent.metadata.status, 'success');
assert.equal(readEvent.metadata.source, 'google_sheets_live');
assert.equal(readEvent.metadata.requestedRange, 'Catalogo!A1:J1000');
assert.equal(readEvent.metadata.effectiveRange, 'Catalogo!A1:J1000');
assert.equal(readEvent.metadata.parsedRowCount, 2);
assert.equal(readEvent.metadata.filteredRowCount, 1);
assert.deepEqual(readEvent.metadata.candidateSkus, ['BOG-BEB-044']);
assert.deepEqual(readEvent.metadata.candidateNames, ['Coca-Cola original']);
assert.equal(readEvent.metadata.filters.query, 'Coca Cola litro y medio');
assert.equal(readEvent.metadata.spreadsheetRef, 'sheet…56789');

const blockedEvents = [];
const blockedRegistry = new ToolRegistry({
  store: { getState: () => ({ tenants: state.tenants }) },
  events: { emit: (event) => { blockedEvents.push(event); return event; } },
  usage: null,
  config: { allowLocalCatalogFallback: false },
  googleWorkspace: null,
  secretVault: null,
});
const blocked = await blockedRegistry.googleSheetsReadTable(tenantId, { filters: { query: 'chocorramo' } });
assert.equal(blocked.status, 'connection_required');
assert.equal(blockedEvents[0].type, 'catalog.source.read');
assert.equal(blockedEvents[0].metadata.status, 'connection_required');
assert.equal(blockedEvents[0].metadata.reason, 'google_connection_required');

console.log('catalog-observability-contract: ok');
