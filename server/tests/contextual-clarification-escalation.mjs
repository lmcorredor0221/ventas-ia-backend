import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import {
  getPendingConversationMode,
  hasOpenHumanRequest,
} from '../services/pendingRequestPolicy.js';

// Contract: a catalog ambiguity is still a sales conversation. VIA must ask
// twice before assigning a human, while an actual human handoff continues to
// pause automatic replies and avoid a human/agent race.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-contextual-clarification-'));
const { store, runtime, integrationOutbox, tools } = await createAppAsync({
  storageDriver: 'json',
  whatsappMode: 'mock',
  allowLocalCatalogFallback: false,
  contextualProductSelectionV2: true,
  clarificationMaxAttempts: 2,
  backgroundWorkersEnabled: false,
  dataFile: path.join(dir, 'store.json'),
});

const tenantId = 'andina';
const conversationId = 'contextual-clarification-regression';
const waId = '573000000777';
const originalToolCall = tools.call.bind(tools);
const outbound = [];

tools.call = async (toolName, currentTenantId, currentConversationId, payload) => {
  if (toolName === 'google_sheets_read_table') {
    return { rows: [], source_refs: [], status: 'not_applicable' };
  }
  if (toolName === 'whatsapp_business_messaging') {
    outbound.push(payload);
    return { status: 'sent' };
  }
  return originalToolCall(toolName, currentTenantId, currentConversationId, payload);
};
runtime.composeCustomerReply = async ({ fallbackText }) => fallbackText;

store.mutate((state) => {
  state.conversations.unshift({ id: conversationId, tenantId, waId, messages: [], status: 'live' });
});

function ambiguousPlan() {
  return {
    intent: 'delivery_order',
    order: {
      delivery: true,
      items: [{
        lineId: 'gaseosa-1',
        rawName: 'dos gaseosas',
        catalogQuery: 'gaseosas',
        quantity: 2,
      }],
    },
    missingFields: [],
  };
}

async function sendAmbiguous(attempt) {
  return runtime.handleDeliveryOrder({
    tenantId,
    conversationId,
    normalized: {
      waId,
      text: attempt === 1 ? 'Quiero dos gaseosas' : 'Una gaseosa cualquiera',
      traceId: `trace-contextual-clarification-${attempt}`,
    },
    customerProfile: null,
    plan: ambiguousPlan(),
    replaceDraft: true,
  });
}

try {
  const first = await sendAmbiguous(1);
  let conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(first.summary, 'Structured order needs clarification');
  assert.equal(conversation.status, 'live');
  assert.equal(conversation.clarificationState?.attempts, 1);
  assert.equal((store.getState().pendingRequests ?? []).filter((item) => item.conversationId === conversationId).length, 0);
  assert.match(outbound.at(-1)?.text ?? '', /gaseosa|referencia|producto/i);

  const second = await sendAmbiguous(2);
  conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(second.summary, 'Structured order needs clarification');
  assert.equal(conversation.status, 'live');
  assert.equal(conversation.clarificationState?.attempts, 2);
  assert.equal((store.getState().pendingRequests ?? []).filter((item) => item.conversationId === conversationId).length, 0);

  const third = await sendAmbiguous(3);
  conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(third.summary, 'Structured order escalated to human');
  assert.equal(conversation.status, 'blocked');
  assert.equal(conversation.clarificationState?.attempts, 3);
  assert.ok((store.getState().pendingRequests ?? []).some((item) => (
    item.conversationId === conversationId && item.type === 'human_handoff' && item.status === 'pending'
  )));
  const handoffRequest = (store.getState().pendingRequests ?? []).find((item) => (
    item.conversationId === conversationId && item.type === 'human_handoff' && item.status === 'pending'
  ));
  assert.equal(getPendingConversationMode(store.getState(), conversationId).mode, 'human_takeover');
  assert.equal(hasOpenHumanRequest(store.getState(), conversationId), true);
  await runtime.resolveHumanRequest(handoffRequest.id, { outcome: 'approved' });
  conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(conversation.clarificationState?.status, 'closed');
  assert.equal(getPendingConversationMode(store.getState(), conversationId).mode, 'none');
  assert.equal(hasOpenHumanRequest(store.getState(), conversationId), false);

  const fresh = await sendAmbiguous(4);
  conversation = store.getState().conversations.find((item) => item.id === conversationId);
  assert.equal(fresh.summary, 'Structured order needs clarification');
  assert.equal(conversation.clarificationState?.attempts, 1);

  store.mutate((state) => {
    state.pendingRequests.push({
      id: 'approval-only', tenantId, conversationId: 'approval-conversation',
      type: 'approval.requested', status: 'pending',
    });
  });
  assert.equal(getPendingConversationMode(store.getState(), 'approval-conversation').mode, 'approval_pending');
  assert.equal(hasOpenHumanRequest(store.getState(), 'approval-conversation'), false);

  console.log('Contextual clarification escalation contract passed.');
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
