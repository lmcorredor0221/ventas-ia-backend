import assert from 'node:assert/strict';
import { runContextualScenario } from './helpers/contextualScenarioRunner.js';
import { resetScenarioCatalog } from './helpers/scenarioCatalog.js';

// An evaluator outage must not hide the state that VIA actually persisted.
const originalFetch = global.fetch;
const task = { id: 'task', conversationId: 'c', tenantId: 't', status: 'pending',
  title: 'Revisión', context: 'Producto pendiente', contextSnapshot: { need: 'producto' } };
const conversation = { id: 'c', messages: [{ role: 'customer', text: 'producto' }] };
const outbound = [];
let sends = 0, judgeCalls = 0;
try {
  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:1/api/pending-requests')) return { json: async () => [task] };
    assert.equal(options.headers['x-e2e-role'] === 'customer_actor' || options.headers['x-e2e-role'] === 'semantic_judge', true);
    if (options.headers['x-e2e-role'] === 'customer_actor') throw new Error('The operation was aborted due to timeout');
    judgeCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'pass', issues: [],
      missingNeeds: [], turns: [{ turn: 1, products: [], paymentVerified: false }] }) } }] }) };
  };
  const report = await runContextualScenario({ scenario: { id: 'harness', number: 45, outcome: 'handoff',
    customer: 'new', buyer: {}, basket: [], extraProducts: [], initial: { text: 'producto' }, maxTurns: 2 },
    meta: { baseUrl: 'http://127.0.0.1:1', async sendText() {
      if (++sends === 1) outbound.push({ recipientKey: '57380000045', caseKey: 'harness', at: new Date().toISOString(), text: 'La tienda revisa tu solicitud.' });
      return { body: { queued: sends === 1, duplicate: sends > 1 }, elapsedMs: 2 };
    } },
    runtime: { store: { listEvents: async () => [], getConversation: async () => conversation,
      getState: () => ({ tenants: [], ordersByTenant: {} }), listOutbox: async () => [] }, orders: { findOrder: () => null } },
    shadow: { tenantId: 't', baseCatalog: [] }, runId: 'contract', graphOutbound: outbound,
    resetCatalog: async () => {}, seedCustomer: async () => {},
    drain: async () => ({ status: 'completed', result: { conversationId: 'c' } }),
    summarizeLlm: () => ({}), shopkeeper: async () => { throw new Error('Unexpected order'); } });
  assert.equal(report.databaseSnapshot?.conversation?.id, 'c');
  assert.equal(report.pendingRequests?.length, 1);
  assert.equal(judgeCalls, 1);
  assert.ok(report.assertions.some(a => a.name === 'human_task_with_context' && a.passed));
  assert.ok(report.assertions.some(a => a.name === 'deduplication' && a.passed));
  assert.equal(report.status, 'evaluator_error', 'Collecting evidence must not hide the actor failure');
  assert.equal(report.failureAxes.functional, false, 'An actor interruption is not proof of a VIA functional failure');
  console.log('PASS Actor failure preserves database, human-task, judge and dedup evidence without claiming success');
} finally { global.fetch = originalFetch; }

let dirty = true;
const operations = [], state = { productsByTenant: { t: [{ sku: 'old' }] } };
await resetScenarioCatalog({
  async flush() { dirty = false; operations.push('flush'); },
  mutate(fn) { fn(state); dirty = true; operations.push('mutate'); },
  pool: { async query(_sql, params) { assert.equal(dirty, false, 'DELETE cannot race the queued catalog snapshot');
    assert.deepEqual(params, ['t']); operations.push('delete'); } },
  async listProducts(id) { assert.equal(dirty, false); return state.productsByTenant[id]; },
}, { tenantId: 't', baseCatalog: [{ sku: 'base', price: 100 }] }, [{ sku: 'base', price: 200 }]);
assert.deepEqual(operations, ['flush', 'delete', 'mutate', 'flush']);
assert.equal(state.productsByTenant.t[0].price, 200);
console.log('PASS Scenario catalog drains old writes before DELETE and persists the replacement afterward');
