import assert from 'node:assert/strict';
import { AgentRuntime } from '../services/agentRuntime.js';

const state = { conversations: [] };
const store = {
  getState() {
    return state;
  },
  mutate(mutator) {
    mutator(state);
  },
  async findConversationByWa() {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return null;
  },
  async persistConversation() {},
};

const runtime = new AgentRuntime({
  store,
  events: { emit: () => ({ id: 'event-test' }) },
  tools: {},
  planner: {},
  usage: null,
  config: {},
});

const inbound = {
  tenantId: 'test-local',
  waId: '573219450893',
  profileName: 'Cliente de prueba',
  messageId: 'wamid.concurrent-retry',
  traceId: 'wa:wamid.concurrent-retry',
  messageType: 'text',
  text: 'Necesito un domicilio.',
};

const [first, retry] = await Promise.all([
  runtime.ensureConversation('test-local', inbound),
  runtime.ensureConversation('test-local', inbound),
]);

assert.equal(first.id, retry.id, 'Los reintentos simultaneos deben reutilizar el mismo caso');
assert.equal(state.conversations.length, 1, 'Un mensaje de WhatsApp solo puede crear una conversacion');
console.log('Agent runtime concurrency tests passed');
