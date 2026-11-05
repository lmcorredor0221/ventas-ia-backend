import assert from 'node:assert/strict';
import { PostgresStore } from '../store/postgresStore.js';
import { createSeedState } from '../data/seed.js';
import { ensureSaasState } from '../services/saasControlPlane.js';

// This is intentionally a storage-queue contract test. It does not open a
// database: a tenant configuration write must not wait behind a deferred
// snapshot or another unrelated general write.
const store = Object.create(PostgresStore.prototype);
store.saveQueue = Promise.resolve();
store.criticalQueue = Promise.resolve();
store.criticalWrites = new Set();

let releaseGeneral;
let generalStarted;
const generalBarrier = new Promise((resolve) => { releaseGeneral = resolve; });
const generalEntered = new Promise((resolve) => { generalStarted = resolve; });
const generalWrite = store.queueWrite(async () => {
  generalStarted();
  await generalBarrier;
}, 'blocked general write');
await generalEntered;

const criticalWrite = store.queueCriticalWrite(async () => 'tenant-config-saved', 'critical tenant write');
const result = await Promise.race([
  criticalWrite,
  new Promise((resolve) => setTimeout(() => resolve('timed-out'), 250)),
]);

assert.equal(result, 'tenant-config-saved', 'tenant config was blocked by an unrelated general write');
releaseGeneral();
await generalWrite;
await criticalWrite;
await store.criticalQueue;
console.log('PASS tenant configuration writes bypass the general persistence queue');

const state = createSeedState();
for (const tenant of state.tenants) {
  tenant.config.orderPolicy.deliveryFee = null;
  tenant.config.orderPolicy.deliveryMinimumSubtotal = null;
}
const customTenant = state.tenants[0];
customTenant.config.orderPolicy.deliveryFee = 3500;
customTenant.config.orderPolicy.deliveryMinimumSubtotal = 25000;
ensureSaasState(state);
for (const tenant of state.tenants) {
  if (tenant === customTenant) {
    assert.equal(tenant.config.orderPolicy.deliveryFee, 3500);
    assert.equal(tenant.config.orderPolicy.deliveryMinimumSubtotal, 25000);
  } else {
    assert.equal(tenant.config.orderPolicy.deliveryFee, 0);
    assert.equal(tenant.config.orderPolicy.deliveryMinimumSubtotal, 10000);
  }
}
console.log('PASS missing tenant delivery policy values migrate to 0 / 10000 without overwriting custom values');
