import assert from 'node:assert/strict';
import { sanitizeOwnerConfigPatch } from '../services/tenantConfigPolicy.js';

const patch = sanitizeOwnerConfigPatch({
  googleSheets: {
    catalogRange: 'Catalogo!A1:Q1000',
    customerProfilesRange: 'Clientes!A1:H1000',
    ordersRange: 'Pedidos!A1:M1000',
  },
  orderPolicy: {
    deliveryFee: 0,
    deliveryMinimumSubtotal: 10000,
  },
});

assert.equal(patch.googleSheets.catalogRange, 'Catalogo!A1:Q1000');
assert.equal(patch.orderPolicy.deliveryFee, 0);
assert.equal(patch.orderPolicy.deliveryMinimumSubtotal, 10000);
assert.throws(
  () => sanitizeOwnerConfigPatch({ orderPolicy: { deliveryMinimumSubtotal: -1 } }),
  (error) => error.code === 'tenant_config_invalid_value' && error.statusCode === 400,
);
console.log('tenant-config-contract: ok');
