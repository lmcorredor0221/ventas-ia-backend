import assert from 'node:assert/strict';
import { AgentRuntime } from '../services/agentRuntime.js';

const state = {
  tenants: [{
    id: 'test-local',
    config: { googleSheets: { range: 'Catalogo!A1:J1000' } },
  }],
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
    if (toolName === 'google_sheets_read_table') {
      return {
        status: 'success',
        rows: [{
          sku: 'BOG-PAN-019',
          name: 'Ponque Chocoramo',
          price: 2800,
          stock: 55,
          category: 'Ponques y paquetes',
          driveFileId: '',
        }],
      };
    }
    if (toolName === 'google_drive_file_picker') return { status: 'error', files: [], source_refs: [] };
    if (toolName === 'whatsapp_business_messaging') {
      const error = new Error('WhatsApp Cloud API send failed: 400');
      error.code = 'whatsapp_send_failed';
      error.toolName = toolName;
      error.payload = { error: { code: 131030, message: 'Recipient phone number not in allowed list' } };
      throw error;
    }
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
        intent: 'delivery_order',
        order: {
          delivery: true,
          items: [{
            rawName: 'chocorramo',
            catalogQuery: 'chocorramo',
            quantity: 1,
            requestedPresentation: null,
          }],
        },
        missingFields: [],
      };
    },
  },
  usage: null,
  config: {},
});

await assert.rejects(
  runtime.processInbound({
    tenantId: 'test-local',
    waId: '573219450893',
    messageId: 'wamid.failure-contract',
    messageType: 'text',
    text: 'Quiero un chocorramo a domicilio.',
  }),
  { code: 'whatsapp_send_failed' },
);

const conversation = state.conversations[0];
assert.equal(calls.includes('google_drive_file_picker'), false, 'No debe buscar documentos cuando el producto no tiene referencia Drive.');
assert.equal(conversation.orderDraft.driveStatus, 'not_applicable');
assert.equal(conversation.status, 'degraded');
assert.equal(conversation.lastTool, 'whatsapp_business_messaging');
assert.match(conversation.nextStep, /destinatario de prueba/i);
assert.match(conversation.humanReason, /cat[aá]logo respondi[oó]/i);

console.log('Agent runtime failure contract tests passed');
