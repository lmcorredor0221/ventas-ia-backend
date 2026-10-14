import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createAppAsync } from '../server/index.js';

const tenantId = process.env.GOOGLE_LIVE_TENANT_ID ?? process.argv[2] ?? 'tienda-piloto-google';
const runId = Date.now().toString();
const phonePrefix = process.env.GOOGLE_LIVE_AGENT_TEST_WA_PREFIX ?? `57318${runId.slice(-6)}`;

const appRuntime = await createAppAsync();
const { store, runtime: agentRuntime, secretVault, googleWorkspace } = appRuntime;

store.mutate((state) => {
  state.platformSettings ??= {};
  state.platformSettings.llm = {
    ...(state.platformSettings.llm ?? {}),
    provider: 'deepseek',
    model: state.platformSettings.llm?.model ?? 'deepseek-chat',
    simulator: 'codex',
  };
});

try {
  const state = store.getState();
  const connection = state.googleConnectionsByTenant?.[tenantId];
  const workspace = state.googleWorkspacesByTenant?.[tenantId];
  assert.equal(connection?.status, 'connected', `Tenant ${tenantId} must have Google connected`);
  assert.equal(connection?.mode, 'live', `Tenant ${tenantId} must use live Google mode`);
  assert.equal(workspace?.status, 'provisioned', `Tenant ${tenantId} must have a provisioned workspace`);
  assert.ok(workspace?.spreadsheet?.id, `Tenant ${tenantId} must have a Google spreadsheet id`);

  const refreshToken = secretVault.readSecret(connection.refreshTokenRef);
  assert.ok(refreshToken, 'Google refresh token must be available through the secret vault');
  const accessToken = await googleWorkspace.refreshAccessToken(refreshToken);

  const initialCustomerRows = await googleWorkspace.readValues({
    accessToken,
    spreadsheetId: workspace.spreadsheet.id,
    range: 'Clientes!A1:H1000',
  });
  const initialOrderRows = await googleWorkspace.readValues({
    accessToken,
    spreadsheetId: workspace.spreadsheet.id,
    range: 'Pedidos!A1:M1000',
  });

  const traces = [];
  const catalogWaId = `${phonePrefix}01`;
  const customerWaId = `${phonePrefix}02`;
  const handoffWaId = `${phonePrefix}03`;
  const customerName = `Cliente Agent Google Live ${runId.slice(-6)}`;
  const customerAddress = `Carrera ${runId.slice(-2)} # 12-34, Bogota`;

  const catalogRun = await runAgent({
    tenantId,
    waId: catalogWaId,
    profileName: 'Cliente Catalogo Live',
    text: 'Veci, que jugos tiene pa mandar a domicilio?',
    messageId: `agent-google-live-${runId}-catalog`,
  });
  assert.equal(catalogRun.result.plan.intent, 'catalog_query');
  assert.equal(catalogRun.conversation.lastTool, 'google_sheets_read_table');
  assert.equal(catalogRun.result.plan.provider, 'deepseek');
  assert.equal(catalogRun.result.plan.executionMode, 'codex_simulated_deepseek');
  traces.push(traceFromRun('catalog_query_live_sheets', catalogRun));

  const orderRun = await runAgent({
    tenantId,
    waId: customerWaId,
    profileName: '',
    text: 'Buenas tardes, para un domicilio me regalas 1 chocoramo',
    messageId: `agent-google-live-${runId}-order`,
  });
  assert.equal(orderRun.result.plan.intent, 'delivery_order');
  assert.ok(orderRun.conversation.orderDraft?.missingFields?.includes('customer_name'));
  assert.ok(orderRun.conversation.orderDraft?.missingFields?.includes('delivery_address'));
  assert.equal(orderRun.conversation.orderDraft?.driveStatus, 'success');
  traces.push(traceFromRun('new_customer_order_needs_profile', orderRun));

  const profileRun = await runAgent({
    tenantId,
    waId: customerWaId,
    profileName: '',
    text: `Soy ${customerName}, direccion ${customerAddress}`,
    messageId: `agent-google-live-${runId}-profile`,
  });
  assert.equal(profileRun.result.plan.intent, 'order_clarification');
  assert.equal(profileRun.conversation.lastTool, 'google_sheets_customer_profile_upsert');
  assert.equal(profileRun.conversation.orderDraft?.missingFields?.length, 0);
  traces.push(traceFromRun('customer_profile_saved_live_sheets', profileRun));

  const confirmRun = await runAgent({
    tenantId,
    waId: customerWaId,
    profileName: '',
    text: 'Confirmo el pedido, dale',
    messageId: `agent-google-live-${runId}-confirm`,
  });
  assert.equal(confirmRun.result.plan.intent, 'order_confirmation');
  assert.equal(confirmRun.conversation.lastTool, 'google_sheets_order_write');
  assert.ok(confirmRun.conversation.orderId);
  traces.push(traceFromRun('confirmed_order_written_live_sheets', confirmRun));

  const imageRun = await runAgent({
    tenantId,
    waId: handoffWaId,
    profileName: 'Cliente Imagen Live',
    text: '',
    messageType: 'image',
    mediaRef: `media-agent-google-live-${runId}`,
    messageId: `agent-google-live-${runId}-image`,
  });
  assert.equal(imageRun.result.summary, 'Human handoff requested');
  assert.equal(imageRun.conversation.status, 'blocked');
  traces.push(traceFromRun('image_requires_human_handoff', imageRun));

  const customerRows = await googleWorkspace.readValues({
    accessToken,
    spreadsheetId: workspace.spreadsheet.id,
    range: 'Clientes!A1:H1000',
  });
  const orderRows = await googleWorkspace.readValues({
    accessToken,
    spreadsheetId: workspace.spreadsheet.id,
    range: 'Pedidos!A1:M1000',
  });
  assert.ok(customerRows.some((row) => row[0] === customerWaId && row[1] === customerName));
  assert.ok(orderRows.some((row) => row[1] === customerWaId && row[6] === 'pending_human_preparation'));

  const pendingRequests = store.getState().pendingRequests.filter((request) => request.tenantId === tenantId);
  assert.ok(pendingRequests.some((request) => request.conversationId === confirmRun.conversation.id && request.assignedTeam === 'operaciones'));
  assert.ok(pendingRequests.some((request) => request.conversationId === imageRun.conversation.id && request.assignedTeam === 'ventas'));

  const report = {
    generatedAt: new Date().toISOString(),
    tenantId,
    spreadsheetId: workspace.spreadsheet.id,
    llmMode: 'codex_simulated_deepseek',
    scenarios: traces.length,
    customerRowsBefore: initialCustomerRows.length,
    customerRowsAfter: customerRows.length,
    orderRowsBefore: initialOrderRows.length,
    orderRowsAfter: orderRows.length,
    testPhones: { catalogWaId, customerWaId, handoffWaId },
    traces,
  };
  fs.writeFileSync(path.join(process.cwd(), 'test-results-agent-google-live-scenarios.json'), `${JSON.stringify(report, null, 2)}\n`);

  await store.flush?.();
  console.log(`Agent Google live scenarios passed (${traces.length} traced steps). Report: test-results-agent-google-live-scenarios.json`);
} finally {
  await store.close?.();
}

async function runAgent(body) {
  const result = await agentRuntime.processInbound({
    provider: 'local_api',
    workspaceId: body.tenantId,
    timestamp: Date.now(),
    messageType: 'text',
    rawPayloadRef: 'local_agent_google_live_test',
    ...body,
  });
  await store.flush?.();
  return {
    ...result,
    conversation: await store.getConversation?.(result.conversation.id) ?? result.conversation,
  };
}

function traceFromRun(id, run) {
  const plan = run.result.plan ?? {};
  return {
    id,
    conversationId: run.conversation.id,
    summary: run.result.summary,
    intent: plan.intent,
    provider: plan.provider,
    executionMode: plan.executionMode,
    reasoningMode: plan.reasoningMode,
    lastTool: run.conversation.lastTool,
    stage: run.conversation.stage,
    status: run.conversation.status,
    value: run.conversation.value,
    missingFields: run.conversation.orderDraft?.missingFields ?? plan.missingFields ?? [],
    reply: run.conversation.messages.at(-1)?.text ?? '',
  };
}
