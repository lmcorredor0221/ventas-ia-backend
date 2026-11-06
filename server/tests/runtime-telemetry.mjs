import assert from 'node:assert/strict';
import { RuntimeTelemetry } from '../services/runtimeTelemetry.js';

const telemetry = new RuntimeTelemetry({
  maxSamples: 100,
  maxTraces: 20,
  slowThresholdMs: 10_000,
  logTraces: false,
});

const trace = telemetry.startTrace({
  traceId: 'wa:test-message-1',
  tenantId: 'tenant-demo',
  messageId: 'test-message-1',
  conversationId: 'conversation-1',
  source: 'whatsapp',
});
assert.ok(trace);
trace.mark('webhook.ack');
await trace.span('catalog', 'lookup', { tenantId: 'tenant-demo' }, async () => ({ status: 'success' }));
await trace.span('llm', 'plan', { tenantId: 'tenant-demo' }, async () => ({ intent: 'delivery_order' }));
trace.complete('ok', { status: 'ok' });

telemetry.record('postgres', 'snapshot', {
  durationMs: 125,
  tenantId: 'tenant-demo',
  metadata: { serializedBytes: 1234, includeMirrors: false },
});
telemetry.setGauge('postgres.pool', { totalCount: 2, idleCount: 1, waitingCount: 0 });

const snapshot = telemetry.snapshot({ tenantId: 'tenant-demo' });
assert.equal(snapshot.activeTraces.length, 0);
assert.equal(snapshot.recentTraces.length, 1);
assert.ok(snapshot.operations['trace.inbound']);
assert.ok(snapshot.operations['catalog.lookup']);
assert.equal(snapshot.operations['postgres.snapshot'].count, 1);
assert.equal(snapshot.gauges['postgres.pool'].value.waitingCount, 0);
assert.equal(JSON.stringify(snapshot).includes('test only'), false, 'trace metadata must not expose arbitrary text');

console.log('Runtime telemetry contract tests passed');
