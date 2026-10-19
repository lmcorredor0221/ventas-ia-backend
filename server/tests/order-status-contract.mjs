import assert from 'node:assert/strict';
import {
  ORDER_STATUSES,
  SHEET_ORDER_STATUSES,
  canTransition,
  fromGoogleSheetStatus,
  toGoogleSheetStatus,
} from '../domain/orderStatus.js';

assert.equal(canTransition(ORDER_STATUSES.PENDING_HUMAN_PREPARATION, ORDER_STATUSES.PREPARING), true);
assert.equal(canTransition(ORDER_STATUSES.PREPARING, ORDER_STATUSES.DISPATCHED), true);
assert.equal(canTransition(ORDER_STATUSES.DISPATCHED, ORDER_STATUSES.DELIVERED), true);
assert.equal(canTransition(ORDER_STATUSES.PENDING_HUMAN_PREPARATION, ORDER_STATUSES.DELIVERED), false);
assert.equal(canTransition(ORDER_STATUSES.DELIVERED, ORDER_STATUSES.PREPARING), false);

for (const status of Object.values(ORDER_STATUSES)) {
  const sheetStatus = toGoogleSheetStatus(status);
  assert.ok(SHEET_ORDER_STATUSES.includes(sheetStatus));
  assert.equal(fromGoogleSheetStatus(sheetStatus), status);
}

assert.equal(fromGoogleSheetStatus('confirmado'), ORDER_STATUSES.PENDING_HUMAN_PREPARATION);
assert.equal(fromGoogleSheetStatus('preparando'), ORDER_STATUSES.PREPARING);
assert.equal(fromGoogleSheetStatus('despachado'), ORDER_STATUSES.DISPATCHED);
assert.equal(fromGoogleSheetStatus('desconocido'), null);

console.log('Order status contract tests passed');
