import assert from 'node:assert/strict';
import {
  googleSheetAppendRange,
  googleSheetColumnRange,
  googleSheetOrderStatusRowRange,
  googleSheetRangesForTenant,
  googleSheetRowRange,
} from '../services/googleSheetRanges.js';
import { mergeTenantConfig, sanitizeOwnerConfigPatch } from '../services/tenantConfigPolicy.js';

const tenant = {
  id: 'demo',
  config: {
    googleSheets: {
      range: 'Catalogo!A1:Q1000',
      catalogRange: 'Catalogo!A1:J1000',
      customerProfilesRange: 'Clientes!A1:H1000',
      ordersRange: 'Pedidos!A1:M1000',
    },
  },
};

assert.deepEqual(googleSheetRangesForTenant(tenant), {
  catalogRange: 'Catalogo!A1:J1000',
  customerProfilesRange: 'Clientes!A1:H1000',
  ordersRange: 'Pedidos!A1:M1000',
});
assert.equal(googleSheetAppendRange('Clientes!A1:H1000', 'Clientes', 'A', 'H'), 'Clientes!A:H');
assert.equal(googleSheetRowRange('Clientes!A1:H1000', 7, 'Clientes', 'A', 'H'), 'Clientes!A7:H7');
assert.equal(googleSheetColumnRange('Pedidos!A1:M1000', 'start', 'Pedidos', 'A', 'M'), 'Pedidos!A:A');
assert.equal(googleSheetOrderStatusRowRange('Pedidos!A1:M1000', 9), 'Pedidos!G9:J9');

const merged = mergeTenantConfig(tenant.config, sanitizeOwnerConfigPatch({
  googleSheets: {
    catalogRange: 'Catalogo!A1:P1000',
    customerProfilesRange: 'Clientes!A1:H500',
    ordersRange: 'Pedidos!A1:M500',
  },
}));
assert.equal(merged.googleSheets.catalogRange, 'Catalogo!A1:P1000');
assert.equal(merged.googleSheets.range, 'Catalogo!A1:P1000');
assert.equal(merged.googleSheets.customerProfilesRange, 'Clientes!A1:H500');
assert.equal(merged.googleSheets.ordersRange, 'Pedidos!A1:M500');

const legacyMerged = mergeTenantConfig(tenant.config, sanitizeOwnerConfigPatch({
  googleSheets: { range: 'Catalogo!A1:J500' },
}));
assert.equal(legacyMerged.googleSheets.catalogRange, 'Catalogo!A1:J500');
assert.equal(legacyMerged.googleSheets.range, 'Catalogo!A1:J500');

console.log('google-ranges-contract: saved ranges remain effective for catalog, customer and order operations');
