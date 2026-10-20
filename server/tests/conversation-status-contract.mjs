import assert from 'node:assert/strict';
import { AgentRuntime } from '../services/agentRuntime.js';
import { PostgresStore } from '../store/postgresStore.js';
import { CLOSED_CONVERSATION_STATUSES, isClosedConversation } from '../domain/conversationStatus.js';

assert.equal(isClosedConversation({ status: 'closed_dispatched' }), true);
assert.equal(isClosedConversation({ caseStatus: 'completed', status: 'closed_dispatched' }), true);
assert.equal(isClosedConversation({ status: 'live' }), false);

const state = {
  conversations: [{
    id: 'wa-dispatched-case',
    tenantId: 'test-local',
    waId: '573219450893',
    status: 'closed_dispatched',
    caseStatus: 'completed',
    closeReason: 'order_dispatched',
    closedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }],
};
const runtime = new AgentRuntime({
  store: {
    getState: () => state,
    mutate: (mutator) => mutator(state),
    persistConversation: async () => {},
  },
  config: { caseContinuationWindowMinutes: 30 },
});
const nextConversation = await runtime.ensureConversation('test-local', {
  waId: '573219450893',
  profileName: 'Luis',
  text: 'Agrégale una gaseosa al pedido',
  messageType: 'text',
  traceId: 'wa:new-after-dispatch',
});
assert.notEqual(nextConversation.id, 'wa-dispatched-case');
assert.equal(nextConversation.status, 'live');
assert.equal(state.conversations.find((item) => item.id === 'wa-dispatched-case').status, 'closed_dispatched');

const queries = [];
const postgresStore = Object.create(PostgresStore.prototype);
postgresStore.pool = {
  async query(query, params) {
    queries.push({ query, params });
    return { rows: [] };
  },
};
await postgresStore.findConversationByWa('test-local', '573219450893');
assert.match(queries[0].query, /<> ALL\(\$3::text\[\]\)/);
assert.deepEqual(queries[0].params, ['test-local', '573219450893', CLOSED_CONVERSATION_STATUSES]);

console.log('Conversation status contract tests passed');
