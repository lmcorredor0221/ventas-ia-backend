const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ToolRegistry {
  constructor({ store, events, config }) {
    this.store = store;
    this.events = events;
    this.config = config;
  }

  async call(toolName, tenantId, conversationId, payload = {}) {
    this.events.emit({
      type: 'tool.call.started',
      tenantId,
      conversationId,
      detail: `${toolName} started`,
      metadata: { toolName, payloadSummary: summarize(payload) },
    });
    try {
      const result = await this.invoke(toolName, tenantId, conversationId, payload);
      this.events.emit({
        type: 'tool.call.completed',
        tenantId,
        conversationId,
        detail: `${toolName} completed`,
        metadata: { toolName, resultSummary: summarize(result) },
      });
      return result;
    } catch (error) {
      this.events.emit({
        type: 'tool.call.failed',
        tenantId,
        conversationId,
        detail: `${toolName} failed: ${error.message}`,
        metadata: { toolName },
      });
      throw error;
    }
  }

  async invoke(toolName, tenantId, conversationId, payload) {
    if (toolName === 'google_sheets_read_table') return this.googleSheetsReadTable(tenantId, payload);
    if (toolName === 'google_drive_file_picker') return this.googleDriveFilePicker(tenantId, payload);
    if (toolName === 'approval_gate') return this.approvalGate(tenantId, conversationId, payload);
    if (toolName === 'human_handoff') return this.humanHandoff(tenantId, conversationId, payload);
    if (toolName === 'transactional_write') return this.transactionalWrite(tenantId, conversationId, payload);
    if (toolName === 'whatsapp_business_messaging') return this.whatsappBusinessMessaging(tenantId, conversationId, payload);
    throw new Error(`Unknown tool: ${toolName}`);
  }

  async googleSheetsReadTable(tenantId, payload) {
    await sleep(30);
    const state = this.store.getState();
    const tenant = state.tenants.find((item) => item.id === tenantId);
    const rows = state.productsByTenant[tenantId] ?? [];
    return {
      status: rows.length ? 'success' : 'error',
      columns: ['sku', 'name', 'price', 'stock', 'category', 'driveFileId'],
      rows: filterRows(rows, payload.filters),
      source_revision: `${tenant?.config?.googleSheets?.spreadsheetIdRef ?? 'CATALOG_REF'}:${Date.now()}`,
      fetched_at: new Date().toISOString(),
    };
  }

  async googleDriveFilePicker(tenantId, payload) {
    await sleep(25);
    const files = this.store.getState().driveFilesByTenant[tenantId] ?? [];
    const requested = payload.file_ids?.length ? files.filter((file) => payload.file_ids.includes(file.fileId)) : files;
    return {
      status: requested.length ? 'success' : 'error',
      files: requested,
      source_refs: requested.map((file) => file.fileId),
    };
  }

  async approvalGate(tenantId, conversationId, payload) {
    const request = {
      id: `hitl-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      conversationId,
      title: payload.proposed_action ?? 'Aprobacion requerida',
      urgency: payload.urgency ?? 'Alta',
      type: 'approval.requested',
      context: payload.payload_summary?.reason ?? 'El agente requiere autorizacion humana para continuar.',
      consequence: payload.payload_summary?.consequence ?? 'Al aprobar, el agente reanudara el flujo.',
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      gateKey: payload.gate_key,
      approvalToken: null,
    };
    this.store.mutate((state) => {
      state.pendingRequests.unshift(request);
      updateConversation(state, conversationId, {
        status: 'approval_required',
        zone: 'approval',
        humanReason: request.context,
        nextStep: request.consequence,
      });
    });
    this.events.emit({ type: 'approval.requested', tenantId, conversationId, detail: request.title, metadata: { requestId: request.id } });
    return { approved: false, approver_id: null, resolution_note: 'pending_human_approval', request_id: request.id };
  }

  async humanHandoff(tenantId, conversationId, payload) {
    const request = {
      id: `handoff-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      conversationId,
      title: payload.reason ?? 'Escalamiento humano',
      urgency: payload.urgency ?? 'Critica',
      type: 'human_handoff',
      context: payload.context_snapshot?.summary ?? 'Caso fuera de contrato autonomo.',
      consequence: 'Al responder, el agente retomara el flujo desde el checkpoint guardado.',
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      assignedTeam: payload.assigned_team ?? 'ventas',
    };
    this.store.mutate((state) => {
      state.pendingRequests.unshift(request);
      updateConversation(state, conversationId, {
        status: 'blocked',
        zone: 'approval',
        humanReason: request.context,
        nextStep: request.consequence,
      });
    });
    this.events.emit({ type: 'fallback.activated', tenantId, conversationId, detail: request.title, metadata: { requestId: request.id } });
    return { handoff_id: request.id, assigned_user: 'equipo.ventas@example.local', ticket_ref: `VENTAS-${request.id.slice(-4)}` };
  }

  async transactionalWrite(tenantId, conversationId, payload) {
    if (!payload.approval_token?.startsWith('APPROVED-')) {
      throw new Error('transactional_write requires a valid approval token');
    }
    const transaction = {
      id: `tx-${crypto.randomUUID().slice(0, 10)}`,
      tenantId,
      conversationId,
      actionName: payload.action_name,
      payload: payload.payload,
      status: 'success',
      createdAt: new Date().toISOString(),
    };
    this.store.mutate((state) => {
      state.transactions.unshift(transaction);
    });
    return { status: 'success', transaction_id: transaction.id, receipt: transaction };
  }

  async whatsappBusinessMessaging(tenantId, conversationId, payload) {
    await sleep(20);
    const state = this.store.getState();
    const tenant = state.tenants.find((item) => item.id === tenantId);
    const canSendLive = this.config.whatsappMode === 'live' && process.env.WHATSAPP_ACCESS_TOKEN && tenant?.config?.whatsapp?.phoneNumberId;
    const providerMessageId = canSendLive ? `live-${crypto.randomUUID()}` : `mock-${crypto.randomUUID()}`;
    this.store.mutate((next) => {
      const conversation = next.conversations.find((item) => item.id === conversationId);
      if (conversation) {
        conversation.messages.push({
          id: providerMessageId,
          role: 'agent',
          text: payload.text ?? payload.template_name ?? 'Mensaje enviado',
          createdAt: new Date().toISOString(),
        });
        conversation.updatedAt = new Date().toISOString();
      }
    });
    return {
      accepted: true,
      provider_message_id: providerMessageId,
      conversation_ref: conversationId,
      delivery_status: canSendLive ? 'accepted_by_provider' : 'mock_accepted',
      timestamp: new Date().toISOString(),
    };
  }
}

function filterRows(rows, filters = {}) {
  const entries = Object.entries(filters ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return rows;
  return rows.filter((row) =>
    entries.every(([key, value]) => String(row[key] ?? '').toLowerCase().includes(String(value).toLowerCase())),
  );
}

function summarize(value) {
  if (!value) return {};
  const json = JSON.stringify(value);
  return json.length > 240 ? `${json.slice(0, 240)}...` : value;
}

function updateConversation(state, conversationId, patch) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  Object.assign(conversation, patch, { updatedAt: new Date().toISOString() });
}
