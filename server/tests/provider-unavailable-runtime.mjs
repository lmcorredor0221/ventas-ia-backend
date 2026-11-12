import assert from 'node:assert/strict';
import { AgentRuntime } from '../services/agentRuntime.js';

const state = {
  tenants: [{ id: 'demo', config: {} }],
  conversations: [],
  pendingRequests: [],
  processedMessages: [],
};
const calls = [];
const store = {
  getState: () => state,
  mutate: (mutator) => mutator(state),
  async persistConversation() {},
  async claimProcessedMessage(messageId) {
    if (state.processedMessages.includes(messageId)) return false;
    state.processedMessages.push(messageId);
    return true;
  },
};
const tools = {
  async call(toolName) {
    calls.push(toolName);
    if (toolName === 'google_sheets_customer_profile_lookup') return { status: 'not_found', profile: null };
    if (toolName === 'whatsapp_business_messaging') return { status: 'sent' };
    if (toolName === 'human_handoff') throw new Error('Una caída del proveedor LLM no debe abrir atención humana');
    throw new Error(`Unexpected tool: ${toolName}`);
  },
};
const runtime = new AgentRuntime({
  store,
  events: { emit: () => ({ id: 'event-test' }) },
  tools,
  planner: {
    async plan() {
      return {
        intent: 'provider_unavailable',
        executionMode: 'provider_unavailable',
        order: { delivery: false, items: [] },
      };
    },
  },
  usage: null,
  config: {},
});

await runtime.processInbound({
  tenantId: 'demo', waId: '573001112233', messageId: 'wamid.provider-unavailable',
  messageType: 'text', text: 'Una gaseosa de manzana',
});

assert.equal(calls.includes('human_handoff'), false);
assert.equal(calls.filter((name) => name === 'whatsapp_business_messaging').length, 1);
assert.equal(state.conversations[0].status, 'waiting');
assert.match(state.conversations[0].nextStep, /reintentar interpretación contextual/i);

console.log('Provider-unavailable runtime contract passed');
