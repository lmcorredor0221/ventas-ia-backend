import assert from 'node:assert/strict';
import { paymentMethodsForTenant } from '../services/agentRuntime.js';

const methods = paymentMethodsForTenant({
  config: {
    paymentMethods: [
      { id: 'cash', label: 'Efectivo' },
      { id: 'bre_b', label: 'Bre-B' },
      { id: 'breb', label: 'Bre-B alternativo' },
      { id: 'card_terminal', label: 'Tarjeta' },
    ],
  },
});

assert.deepEqual(methods, [
  { id: 'cash', label: 'Efectivo' },
  { id: 'bre_b', label: 'Bre-B' },
  { id: 'card_terminal', label: 'Tarjeta' },
]);

console.log('Payment method contract checks passed');
