import assert from 'node:assert/strict';
import { ensureIdentityState } from '../services/authService.js';

const state = {
  tenants: [{
    id: 'demo',
    lifecycle: {
      ownerEmail: 'owner@example.com',
      ownerName: 'Owner',
      createdAt: '2026-11-05T00:00:00.000Z',
    },
  }],
  subscriptionsByTenant: {},
  users: [],
  tenantMembers: [],
  sessionsById: {},
  auditEvents: [],
};

ensureIdentityState(state);
const hydrated = structuredClone(state);
await new Promise((resolve) => setTimeout(resolve, 5));
ensureIdentityState(state);

assert.deepEqual(state, hydrated, 'identity hydration must be idempotent across backend restarts');
console.log('identity-hydration-contract: idempotent');
