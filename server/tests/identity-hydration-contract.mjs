import assert from 'node:assert/strict';
import { ensureIdentityState } from '../services/authService.js';
import { ensureBillingState } from '../services/billingService.js';

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
  billingPlans: [{
    id: 'ventas_ia_400_domicilios',
    name: 'Ventas IA Basico',
    description: 'Plan base',
    currency: 'COP',
    amount: 99000,
    billingFrequency: 'monthly',
    includedDeliveries: 400,
    includedInteractions: 2700,
    trialEnabled: true,
    trialDays: 7,
    graceDays: 5,
    isActive: true,
    isDefault: true,
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
  }],
  subscriptionPaymentsByTenant: {},
  subscriptionEvents: [],
  billingDiscounts: [],
  billingAccessExceptions: [],
  billingUsageCyclesByTenant: {},
  billingFunnelEvents: [],
};

ensureIdentityState(state);
ensureBillingState(state);
const hydrated = structuredClone(state);
await new Promise((resolve) => setTimeout(resolve, 5));
ensureIdentityState(state);
ensureBillingState(state);

assert.deepEqual(state, hydrated, 'identity hydration must be idempotent across backend restarts');
console.log('identity-hydration-contract: idempotent');
