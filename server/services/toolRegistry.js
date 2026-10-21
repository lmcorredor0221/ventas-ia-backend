import { appendAuditEvent } from './authService.js';
import { assertOrderStatus, fromGoogleSheetStatus, toGoogleSheetStatus } from '../domain/orderStatus.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GOOGLE_ACCESS_TOKEN_CACHE_TTL_MS = 45 * 60 * 1000;
const LIVE_CATALOG_CACHE_TTL_MS = 30 * 1000;

function googleConnectionRequiredError(message) {
  const error = new Error(message);
  error.statusCode = 428;
  error.code = 'google_connection_required';
  return error;
}

function googleConnectionRequiredResult(message) {
  return {
    status: 'connection_required',
    code: 'google_connection_required',
    rows: [],
    files: [],
    source_refs: [],
    message,
  };
}

export class ToolRegistry {
  constructor({ store, events, usage, config, googleWorkspace, secretVault }) {
    this.store = store;
    this.events = events;
    this.usage = usage;
    this.config = config;
    this.googleWorkspace = googleWorkspace;
    this.secretVault = secretVault;
    this.outbox = null;
    this.googleAccessTokenCache = new Map();
    this.liveCatalogCache = new Map();
  }

  setOutbox(outbox) {
    this.outbox = outbox;
  }

  async call(toolName, tenantId, conversationId, payload = {}) {
    const traceId = payload.traceId
      ?? this.store.getState().conversations?.find((conversation) => conversation.id === conversationId)?.traceId
      ?? null;
    this.events.emit({
      type: 'tool.call.started',
      tenantId,
      conversationId,
      detail: `${toolName} started`,
      metadata: { toolName, traceId, payloadSummary: summarize(payload) },
    });
    try {
      const result = await this.invoke(toolName, tenantId, conversationId, payload);
      this.events.emit({
        type: 'tool.call.completed',
        tenantId,
        conversationId,
        detail: `${toolName} completed`,
        metadata: { toolName, traceId, resultSummary: summarize(result) },
      });
      this.usage?.recordToolCall(tenantId, toolName, { conversationId });
      return result;
    } catch (error) {
      this.events.emit({
        type: 'tool.call.failed',
        tenantId,
        conversationId,
        detail: `${toolName} failed: ${error.message}`,
        metadata: { toolName, traceId },
      });
      throw error;
    }
  }

  async invoke(toolName, tenantId, conversationId, payload) {
    if (toolName === 'google_sheets_read_table') return this.googleSheetsReadTable(tenantId, payload);
    if (toolName === 'google_drive_file_picker') return this.googleDriveFilePicker(tenantId, payload);
    if (toolName === 'google_sheets_customer_profile_lookup') return this.googleSheetsCustomerProfileLookup(tenantId, payload);
    if (toolName === 'google_sheets_customer_profile_upsert') return this.googleSheetsCustomerProfileUpsert(tenantId, payload);
    if (toolName === 'google_sheets_order_write') return this.googleSheetsOrderWrite(tenantId, conversationId, payload);
    if (toolName === 'google_drive_customer_profile_lookup') return this.googleDriveCustomerProfileLookup(tenantId, payload);
    if (toolName === 'google_drive_customer_profile_upsert') return this.googleDriveCustomerProfileUpsert(tenantId, payload);
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
    const live = await this.liveGoogleContext(tenantId);
    if (!live && !this.config.allowLocalCatalogFallback) {
      return googleConnectionRequiredResult('No se pudo consultar el catalogo de Google de esta tienda.');
    }
    const rows = live
      ? await this.readLiveCatalogRows({
        tenantId,
        tenant,
        live,
        range: payload.range ?? tenant?.config?.googleSheets?.catalogRange,
      })
      : this.store.listProducts ? await this.store.listProducts(tenantId) : (state.productsByTenant[tenantId] ?? []);
    return {
      status: rows.length ? 'success' : 'error',
      columns: ['sku', 'name', 'price', 'stock', 'category', 'brand', 'presentation', 'normalizedPresentation', 'description', 'tags', 'productFamily', 'attributes', 'driveFileId'],
      rows: filterRows(rows, payload.filters),
      source: live ? 'google_sheets_live' : 'local_test_fixture',
      source_revision: `${live?.spreadsheetId ?? tenant?.config?.googleSheets?.spreadsheetIdRef ?? 'CATALOG_REF'}:${Date.now()}`,
      fetched_at: new Date().toISOString(),
    };
  }

  async googleDriveFilePicker(tenantId, payload) {
    await sleep(25);
    const live = await this.liveGoogleContext(tenantId);
    if (!live && !this.config.allowLocalCatalogFallback) {
      return googleConnectionRequiredResult('No se pudieron consultar los documentos de Google de esta tienda.');
    }
    const files = this.store.listDriveFiles ? await this.store.listDriveFiles(tenantId) : (this.store.getState().driveFilesByTenant[tenantId] ?? []);
    const requested = payload.file_ids?.length ? files.filter((file) => payload.file_ids.includes(file.fileId)) : files;
    return {
      status: requested.length ? 'success' : 'error',
      files: requested,
      source_refs: requested.map((file) => file.fileId),
    };
  }

  async googleSheetsCustomerProfileLookup(tenantId, payload) {
    await sleep(25);
    const state = this.store.getState();
    const tenant = state.tenants.find((item) => item.id === tenantId);
    const live = await this.liveGoogleContext(tenantId);
    if (!live && !this.config.allowLocalCatalogFallback) {
      return googleConnectionRequiredResult('No se pudo consultar el cliente en Google Sheets de esta tienda.');
    }
    const profile = live
      ? await this.lookupLiveCustomerProfile({ tenantId, tenant, live, waId: payload.wa_id })
      : this.store.getCustomerProfile
      ? await this.store.getCustomerProfile(tenantId, payload.wa_id)
      : state.customerProfilesByTenant?.[tenantId]?.[payload.wa_id];
    return {
      status: profile ? 'found' : 'not_found',
      profile: profile ?? null,
      source_ref: profile?.sheetRowId ?? profile?.driveFileId ?? null,
      source: live ? 'google_sheets_live' : 'local_test_fixture',
      sheet_ref: tenant?.config?.googleSheets?.customerProfilesRange ?? 'Clientes!A1:F500',
    };
  }

  async googleSheetsCustomerProfileUpsert(tenantId, payload) {
    await sleep(25);
    const now = new Date().toISOString();
    const live = await this.liveGoogleContext(tenantId);
    if (!live && !this.config.allowLocalCatalogFallback) {
      throw googleConnectionRequiredError('No se pudo guardar el cliente en Google Sheets de esta tienda.');
    }
    const liveSourceRef = live ? await this.upsertLiveCustomerProfile({ tenantId, live, payload, now }) : null;
    let profile;
    this.store.mutate((state) => {
      state.customerProfilesByTenant ??= {};
      state.customerProfilesByTenant[tenantId] ??= {};
      const current = state.customerProfilesByTenant[tenantId][payload.wa_id] ?? {};
      profile = {
        sheetRowId: current.sheetRowId ?? `sheet-customer-${tenantId}-${payload.wa_id}`,
        driveFileId: current.driveFileId ?? `drv-customer-${tenantId}-${payload.wa_id}`,
        phone: payload.wa_id,
        name: payload.name ?? current.name ?? payload.wa_id,
        defaultAddress: payload.defaultAddress ?? current.defaultAddress ?? null,
        addresses: payload.addresses ?? current.addresses ?? [],
        lastOrder: payload.lastOrder ?? current.lastOrder ?? null,
        preferences: { ...(current.preferences ?? {}), ...(payload.preferences ?? {}) },
        createdAt: current.createdAt ?? now,
        updatedAt: now,
      };
      state.customerProfilesByTenant[tenantId][payload.wa_id] = profile;
    });
    await this.store.persistCustomerProfile?.(tenantId, payload.wa_id);
    this.audit(tenantId, 'tool.google_sheets_customer_profile_upsert', 'customer_profile', {
      waId: payload.wa_id,
      sourceRef: profile.sheetRowId,
    });
    return { status: 'saved', profile, source_ref: liveSourceRef ?? profile.sheetRowId, source: live ? 'google_sheets_live' : 'local_test_fixture' };
  }

  async googleSheetsOrderWrite(tenantId, conversationId, payload) {
    await sleep(25);
    const now = new Date().toISOString();
    const connection = this.store.getState().googleConnectionsByTenant?.[tenantId];
    const workspace = this.store.getState().googleWorkspacesByTenant?.[tenantId];
    const hasLiveConnection = connection?.status === 'connected'
      && connection.mode === 'live'
      && Boolean(workspace?.spreadsheet?.id);
    if (!hasLiveConnection && !this.config.allowLocalCatalogFallback) {
      throw googleConnectionRequiredError('No se pudo registrar el pedido en Google Sheets de esta tienda.');
    }
    const status = assertOrderStatus(payload.status ?? 'pending_human_preparation');
    const order = {
      id: `ord-${crypto.randomUUID().slice(0, 10)}`,
      tenantId,
      conversationId,
      waId: payload.wa_id,
      customerName: payload.customer_name,
      deliveryAddress: payload.delivery_address,
      items: payload.items ?? [],
      subtotal: payload.subtotal ?? 0,
      status,
      createdAt: now,
      updatedAt: now,
      statusHistory: [{ status, at: now, actorId: 'assistant' }],
      sheetSyncStatus: hasLiveConnection ? 'queued' : 'not_connected',
    };
    const sheetProjectionEntry = this.createOrderSheetCreateEntry(order);
    this.store.mutate((state) => {
      state.ordersByTenant ??= {};
      state.ordersByTenant[tenantId] ??= [];
      state.ordersByTenant[tenantId].unshift(order);
    });
    // PostgreSQL is the source of truth. A Google token refresh or Sheets
    // outage must never sit between a confirmed order and its local write.
    if (this.store.persistOrderWithOutbox) {
      await this.store.persistOrderWithOutbox(tenantId, order.id, sheetProjectionEntry ? [sheetProjectionEntry] : []);
    } else {
      await this.store.persistOrder?.(tenantId, order.id);
      if (sheetProjectionEntry) await this.store.enqueueOutbox?.(sheetProjectionEntry);
    }
    const projection = { provider: 'google_sheets', status: sheetProjectionEntry ? 'queued' : 'not_queued' };
    this.audit(tenantId, 'tool.google_sheets_order_write', 'order', {
      orderId: order.id,
      conversationId,
      waId: order.waId,
      subtotal: order.subtotal,
      itemCount: order.items.length,
    });
    return {
      status: 'saved',
      order,
      source_ref: order.id,
      source: hasLiveConnection ? 'google_sheets_outbox' : 'local_test_fixture',
      projection,
    };
  }

  createOrderSheetCreateEntry(order) {
    if (!this.outbox) return null;
    return this.outbox.createEntry({
      tenantId: order.tenantId,
      kind: 'order.sheet_create',
      aggregateType: 'order',
      aggregateId: order.id,
      idempotencyKey: `order-sheet-create:${order.id}`,
      payload: {
        tenantId: order.tenantId,
        orderId: order.id,
        conversationId: order.conversationId,
        traceId: this.store.getState().conversations?.find((item) => item.id === order.conversationId)?.traceId ?? null,
      },
    });
  }

  async liveGoogleContext(tenantId) {
    if (!this.googleWorkspace || !this.secretVault) return null;
    const state = this.store.getState();
    const connection = state.googleConnectionsByTenant?.[tenantId];
    const workspace = state.googleWorkspacesByTenant?.[tenantId];
    if (connection?.status !== 'connected' || connection.mode !== 'live') return null;
    const spreadsheetId = workspace?.spreadsheet?.id;
    if (!spreadsheetId) return null;
    const refreshToken = this.secretVault.readSecret(connection.refreshTokenRef);
    if (!refreshToken) return null;
    const accessToken = await this.googleAccessToken({
      tenantId,
      refreshTokenRef: connection.refreshTokenRef,
      refreshToken,
    });
    return { accessToken, spreadsheetId, connection, workspace };
  }

  async googleAccessToken({ tenantId, refreshTokenRef, refreshToken }) {
    const key = `${tenantId}:${refreshTokenRef}`;
    const now = Date.now();
    const cached = this.googleAccessTokenCache.get(key);
    if (cached?.accessToken && cached.expiresAt > now) return cached.accessToken;
    if (cached?.pending) return cached.pending;

    const pending = this.googleWorkspace.refreshAccessToken(refreshToken)
      .then((accessToken) => {
        this.googleAccessTokenCache.set(key, {
          accessToken,
          expiresAt: Date.now() + GOOGLE_ACCESS_TOKEN_CACHE_TTL_MS,
        });
        return accessToken;
      })
      .catch((error) => {
        this.googleAccessTokenCache.delete(key);
        throw error;
      });
    this.googleAccessTokenCache.set(key, { pending });
    return pending;
  }

  async readLiveCatalogRows({ tenantId, tenant, live, range }) {
    const sheetRange = range ?? 'Catalogo!A1:P1000';
    const cacheKey = `${tenantId}:${live.spreadsheetId}:${sheetRange}`;
    const cached = this.liveCatalogCache.get(cacheKey);
    if (cached?.rows && cached.expiresAt > Date.now()) return cached.rows;
    if (cached?.pending) return cached.pending;

    const pending = this.googleWorkspace.readValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range: sheetRange,
    }).then((values) => {
      const rows = parseCatalogRows(values);
      this.store.mutate((state) => {
        state.productsByTenant ??= {};
        state.driveFilesByTenant ??= {};
        state.productsByTenant[tenantId] = mergeByKey(state.productsByTenant[tenantId] ?? [], rows, 'sku');
        state.driveFilesByTenant[tenantId] = mergeByKey(
          state.driveFilesByTenant[tenantId] ?? [],
          rows
            .filter((row) => row.driveFileId)
            .map((row) => ({
              fileId: row.driveFileId,
              name: `${row.name} - ficha comercial`,
              mimeType: 'application/vnd.google-apps.document',
              summary: `${row.name}. Categoria: ${row.category}. Marca: ${row.brand ?? 'N/D'}. Presentacion: ${row.presentation ?? 'N/D'}. Precio: ${row.price}. Stock: ${row.stock}.`,
            })),
          'fileId',
        );
      });
      this.liveCatalogCache.set(cacheKey, {
        rows,
        expiresAt: Date.now() + LIVE_CATALOG_CACHE_TTL_MS,
      });
      return rows;
    }).catch((error) => {
      this.liveCatalogCache.delete(cacheKey);
      throw error;
    });
    this.liveCatalogCache.set(cacheKey, { pending });
    return pending;
  }

  async lookupLiveCustomerProfile({ tenantId, tenant, live, waId }) {
    const range = tenant?.config?.googleSheets?.customerProfilesRange ?? 'Clientes!A1:H1000';
    const values = await this.googleWorkspace.readValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range,
    });
    const profile = parseCustomerProfileRows(values).find((item) => item.phone === waId) ?? null;
    if (profile) {
      this.store.mutate((state) => {
        state.customerProfilesByTenant ??= {};
        state.customerProfilesByTenant[tenantId] ??= {};
        state.customerProfilesByTenant[tenantId][waId] = profile;
      });
      await this.store.persistCustomerProfile?.(tenantId, waId);
    }
    return profile;
  }

  async upsertLiveCustomerProfile({ tenantId, live, payload, now }) {
    const range = 'Clientes!A1:H1000';
    const values = await this.googleWorkspace.readValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range,
    });
    const rows = parseCustomerProfileRows(values);
    const existing = rows.find((item) => item.phone === payload.wa_id);
    const row = customerProfileToSheetRow({
      phone: payload.wa_id,
      name: payload.name ?? existing?.name ?? payload.wa_id,
      defaultAddress: payload.defaultAddress ?? existing?.defaultAddress ?? '',
      neighborhood: payload.neighborhood ?? existing?.neighborhood ?? '',
      notes: payload.notes ?? existing?.notes ?? '',
      preferences: { ...(existing?.preferences ?? {}), ...(payload.preferences ?? {}) },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (existing?.rowNumber) {
      await this.googleWorkspace.updateValues({
        accessToken: live.accessToken,
        spreadsheetId: live.spreadsheetId,
        range: `Clientes!A${existing.rowNumber}:H${existing.rowNumber}`,
        values: [row],
      });
      return `Clientes!A${existing.rowNumber}:H${existing.rowNumber}`;
    }
    await this.googleWorkspace.appendValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range: 'Clientes!A:H',
      values: [row],
    });
    return 'Clientes!A:H';
  }

  async appendLiveOrder({ live, order }) {
    await this.googleWorkspace.appendValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range: 'Pedidos!A:M',
      values: [orderToSheetRow(order)],
    });
    return 'Pedidos!A:M';
  }

  async appendOrderProjection({ tenantId, order }) {
    const connection = this.store.getState().googleConnectionsByTenant?.[tenantId];
    const live = await this.liveGoogleContext(tenantId);
    if (!live) {
      if (connection?.status === 'connected' && connection.mode === 'live') {
        throw googleConnectionRequiredError('La hoja de pedidos figura conectada, pero no podemos acceder a ella. Revisa la conexión y reintentaremos automáticamente.');
      }
      return { provider: 'google_sheets', status: 'not_connected', sourceRef: null };
    }
    const sourceRef = await this.appendLiveOrder({ live, order });
    return { provider: 'google_sheets', status: 'synced', sourceRef };
  }

  async syncLiveOrderStatus({ tenantId, order, status, updatedAt }) {
    const connection = this.store.getState().googleConnectionsByTenant?.[tenantId];
    const live = await this.liveGoogleContext(tenantId);
    if (!live) {
      if (connection?.status === 'connected' && connection.mode === 'live') {
        throw googleConnectionRequiredError('La hoja de pedidos figura conectada, pero no podemos acceder a ella. Revisa la conexión antes de continuar.');
      }
      return { status: 'not_connected' };
    }
    const rows = await this.googleWorkspace.readValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range: 'Pedidos!A:A',
    });
    const rowIndex = rows.findIndex((row) => row[0] === order.id);
    if (rowIndex < 0) {
      const error = new Error('No encontramos el pedido en la hoja. Revisa la conexión antes de continuar.');
      error.statusCode = 409;
      throw error;
    }
    const nextOrder = { ...order, status: assertOrderStatus(status), updatedAt };
    const rowNumber = rowIndex + 1;
    await this.googleWorkspace.updateValues({
      accessToken: live.accessToken,
      spreadsheetId: live.spreadsheetId,
      range: `Pedidos!G${rowNumber}:J${rowNumber}`,
      values: [orderToSheetRow(nextOrder).slice(6, 10)],
    });
    return { status: 'synced' };
  }

  async googleDriveCustomerProfileLookup(tenantId, payload) {
    return this.googleSheetsCustomerProfileLookup(tenantId, payload);
  }

  async googleDriveCustomerProfileUpsert(tenantId, payload) {
    return this.googleSheetsCustomerProfileUpsert(tenantId, payload);
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
    await this.store.persistPendingRequest?.(request.id);
    await this.store.persistConversation?.(conversationId);
    this.events.emit({ type: 'approval.requested', tenantId, conversationId, detail: request.title, metadata: { requestId: request.id } });
    this.audit(tenantId, 'tool.approval_gate.requested', 'pending_request', {
      requestId: request.id,
      conversationId,
      gateKey: request.gateKey,
      urgency: request.urgency,
    });
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
      consequence: payload.context_snapshot?.action === 'prepare_delivery_order'
        ? 'Al marcarlo listo, el tendero toma el pedido para alistarlo y coordinar la entrega.'
        : 'Al responder, el agente retomara el flujo desde el checkpoint guardado.',
      action: payload.context_snapshot?.action ?? 'resolve_handoff',
      contextSnapshot: payload.context_snapshot ?? {},
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
    await this.store.persistPendingRequest?.(request.id);
    await this.store.persistConversation?.(conversationId);
    this.events.emit({ type: 'fallback.activated', tenantId, conversationId, detail: request.title, metadata: { requestId: request.id } });
    this.audit(tenantId, 'tool.human_handoff.created', 'pending_request', {
      requestId: request.id,
      conversationId,
      assignedTeam: request.assignedTeam,
      urgency: request.urgency,
    });
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
    await this.store.persistTransaction?.(transaction.id);
    this.audit(tenantId, 'tool.transactional_write.committed', 'transaction', {
      transactionId: transaction.id,
      conversationId,
      actionName: transaction.actionName,
      status: transaction.status,
    });
    return { status: 'success', transaction_id: transaction.id, receipt: transaction };
  }

  async whatsappBusinessMessaging(tenantId, conversationId, payload) {
    await sleep(20);
    const state = this.store.getState();
    const tenant = state.tenants.find((item) => item.id === tenantId);
    const liveConfig = this.config.whatsappMode === 'live'
      ? await this.sendLiveWhatsAppMessage({ tenant, payload })
      : null;
    const providerMessageId = liveConfig?.providerMessageId ?? `mock-${crypto.randomUUID()}`;
    this.store.mutate((next) => {
      const conversation = next.conversations.find((item) => item.id === conversationId);
      if (conversation) {
        conversation.messages.push({
          id: providerMessageId,
          role: payload.senderRole ?? 'agent',
          text: payload.text ?? payload.interactive?.body ?? payload.template_name ?? 'Mensaje enviado',
          channel: liveConfig ? 'whatsapp_live' : 'whatsapp_mock',
          action: payload.action ?? payload.template_name ?? 'session_message',
          createdAt: new Date().toISOString(),
        });
        conversation.updatedAt = new Date().toISOString();
      }
    });
    await this.store.persistConversation?.(conversationId);
    this.audit(tenantId, 'tool.whatsapp_business_messaging.sent', 'whatsapp_message', {
      conversationId,
      providerMessageId,
      live: Boolean(liveConfig),
      action: payload.action ?? payload.template_name ?? 'session_message',
    });
    return {
      accepted: true,
      provider_message_id: providerMessageId,
      conversation_ref: conversationId,
      delivery_status: liveConfig ? 'accepted_by_provider' : 'mock_accepted',
      timestamp: new Date().toISOString(),
    };
  }

  async sendLiveWhatsAppMessage({ tenant, payload }) {
    const phoneNumberId = tenant?.config?.whatsapp?.phoneNumberId;
    const tokenRef = tenant?.config?.whatsapp?.accessTokenRef;
    const accessToken = this.secretVault?.readSecret(tokenRef);
    if (!phoneNumberId || !accessToken) {
      const error = new Error('WhatsApp live mode requires tenant phoneNumberId and access token');
      error.statusCode = 428;
      error.code = 'whatsapp_live_not_configured';
      throw error;
    }
    const body = buildWhatsAppMessagePayload(payload);
    const response = await fetch(`https://graph.facebook.com/${this.config.whatsappGraphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`WhatsApp Cloud API send failed: ${response.status}`);
      error.statusCode = 502;
      error.code = 'whatsapp_send_failed';
      error.payload = result;
      throw error;
    }
    return {
      providerMessageId: result.messages?.[0]?.id ?? `live-${crypto.randomUUID()}`,
      providerPayload: result,
    };
  }

  audit(tenantId, action, resource, metadata = {}) {
    this.store.mutate((state) => {
      appendAuditEvent(state, {
        tenantId,
        action,
        resource,
        metadata,
      });
    });
  }
}

function filterRows(rows, filters = {}) {
  const entries = Object.entries(filters ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return rows;
  const query = entries.find(([key]) => key === 'query')?.[1];
  const scopedRows = rows.filter((row) =>
    entries
      .filter(([key]) => key !== 'query')
      .every(([key, value]) => {
      if (key === 'category') {
        return categoryMatches(row.category, value);
      }
      return normalizeText(row[key]).includes(normalizeText(value));
      }),
  );
  return query ? rankRowsByQuery(scopedRows, query) : scopedRows;
}

function categoryMatches(actual, expected) {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  if (!normalizedExpected) return true;
  if (normalizedActual.includes(normalizedExpected)) return true;
  if (normalizedExpected === 'bebidas') {
    return ['jugos', 'gaseosas', 'aguas', 'hidratantes', 'maltas', 'te listo'].some((alias) => normalizedActual.includes(alias));
  }
  if (normalizedExpected === 'snacks') {
    return ['snack', 'galletas', 'dulces', 'pasabocas'].some((alias) => normalizedActual.includes(alias));
  }
  if (normalizedExpected === 'aseo') {
    return ['aseo', 'limpieza', 'cuidado personal', 'higiene'].some((alias) => normalizedActual.includes(alias));
  }
  if (normalizedExpected === 'lacteos') {
    return ['lacteo', 'leche', 'queso', 'yogur'].some((alias) => normalizedActual.includes(alias));
  }
  if (normalizedExpected === 'despensa') {
    return ['granos', 'basicos', 'aceite', 'cocina', 'harina', 'pasta', 'enlatado', 'condimento', 'cereal', 'huevo'].some((alias) => normalizedActual.includes(alias));
  }
  if (normalizedExpected === 'cafe') {
    return normalizedActual.includes('cafe');
  }
  return false;
}

function parseCatalogRows(values = []) {
  const [headers = [], ...records] = values;
  const headerMap = headerIndex(headers);
  return records
    .map((row) => {
      const sku = cell(row, headerMap, 'sku');
      if (!sku) return null;
      const name = cell(row, headerMap, 'nombre', 'name');
      return {
        sku,
        name,
        category: cell(row, headerMap, 'categoria', 'category'),
        brand: cell(row, headerMap, 'marca', 'brand'),
        presentation: cell(row, headerMap, 'presentacion', 'presentation'),
        price: numberValue(cell(row, headerMap, 'precio', 'price')),
        stock: numberValue(cell(row, headerMap, 'stock')),
        aliases: splitAliases(cell(row, headerMap, 'aliases', 'alias')),
        active: booleanValue(cell(row, headerMap, 'activo', 'active'), true),
        driveFileId: cell(row, headerMap, 'drive_file_id', 'driveFileId', 'drive_file'),
        description: cell(row, headerMap, 'descripcion', 'description'),
        tags: splitAliases(cell(row, headerMap, 'etiquetas', 'tags', 'tag')),
        productFamily: cell(row, headerMap, 'familia_producto', 'familia', 'product_family'),
        normalizedPresentation: cell(row, headerMap, 'presentacion_normalizada', 'presentation_normalized') || normalizePresentation(cell(row, headerMap, 'presentacion', 'presentation')),
        attributes: parseJsonCell(cell(row, headerMap, 'atributos_json', 'attributes_json', 'atributos'), {}),
        catalogOrigin: cell(row, headerMap, 'origen_catalogo', 'catalog_origin', 'origen'),
      };
    })
    .filter((row) => row?.sku && row.name && row.active !== false);
}

function parseCustomerProfileRows(values = []) {
  const [headers = [], ...records] = values;
  const headerMap = headerIndex(headers);
  return records
    .map((row, index) => {
      const phone = cell(row, headerMap, 'telefono_whatsapp', 'phone', 'wa_id');
      if (!phone) return null;
      const preferences = parseJsonCell(cell(row, headerMap, 'preferencias', 'preferences'), {});
      return {
        sheetRowId: `Clientes!A${index + 2}:H${index + 2}`,
        rowNumber: index + 2,
        phone,
        name: cell(row, headerMap, 'nombre', 'name') || phone,
        defaultAddress: cell(row, headerMap, 'direccion_principal', 'defaultAddress', 'address') || null,
        neighborhood: cell(row, headerMap, 'barrio', 'neighborhood') || null,
        notes: cell(row, headerMap, 'notas', 'notes') || null,
        preferences,
        addresses: [],
        createdAt: cell(row, headerMap, 'creado_en', 'createdAt') || null,
        updatedAt: cell(row, headerMap, 'actualizado_en', 'updatedAt') || null,
      };
    })
    .filter(Boolean);
}

function customerProfileToSheetRow(profile) {
  return [
    profile.phone,
    profile.name,
    profile.defaultAddress ?? '',
    profile.neighborhood ?? '',
    profile.notes ?? '',
    JSON.stringify(profile.preferences ?? {}),
    profile.createdAt ?? '',
    profile.updatedAt ?? '',
  ];
}

function orderToSheetRow(order) {
  return [
    order.id,
    order.waId,
    order.customerName ?? '',
    order.deliveryAddress ?? '',
    JSON.stringify(order.items ?? []),
    order.subtotal ?? 0,
    toGoogleSheetStatus(order.status ?? fromGoogleSheetStatus(order.sheetStatus) ?? 'pending_human_preparation'),
    order.handoffId ?? '',
    order.createdAt,
    order.updatedAt,
    'whatsapp',
    order.llmModel ?? '',
    JSON.stringify({ conversationId: order.conversationId }),
  ];
}

function buildWhatsAppMessagePayload(payload) {
  if (payload.template_name) {
    return {
      messaging_product: 'whatsapp',
      to: payload.wa_id,
      type: 'template',
      template: {
        name: payload.template_name,
        language: { code: payload.languageCode ?? payload.language_code ?? 'es_CO' },
        components: payload.components ?? [],
      },
    };
  }
  if (payload.interactive?.kind === 'button') {
    const buttons = (payload.interactive.buttons ?? []).slice(0, 3).map((button) => ({
      type: 'reply',
      reply: { id: button.id, title: String(button.title).slice(0, 20) },
    }));
    if (!buttons.length) throw new Error('Interactive button messages require at least one button');
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.wa_id,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: payload.interactive.body ?? payload.text ?? 'Elige una opción' },
        action: { buttons },
      },
    };
  }
  if (payload.interactive?.kind === 'list') {
    const rows = (payload.interactive.rows ?? []).slice(0, 10).map((row) => ({
      id: row.id,
      title: String(row.title).slice(0, 24),
      ...(row.description ? { description: String(row.description).slice(0, 72) } : {}),
    }));
    if (!rows.length) throw new Error('Interactive list messages require at least one row');
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: payload.wa_id,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: payload.interactive.body ?? payload.text ?? 'Elige una opción' },
        action: {
          button: String(payload.interactive.buttonLabel ?? 'Ver opciones').slice(0, 20),
          sections: [{ title: String(payload.interactive.sectionTitle ?? 'Opciones').slice(0, 24), rows }],
        },
      },
    };
  }
  return {
    messaging_product: 'whatsapp',
    to: payload.wa_id,
    type: 'text',
    text: {
      preview_url: Boolean(payload.preview_url),
      body: payload.text ?? 'Mensaje enviado',
    },
  };
}

function headerIndex(headers) {
  return headers.reduce((map, header, index) => {
    map[normalizeHeader(header)] = index;
    return map;
  }, {});
}

function cell(row, headerMap, ...names) {
  for (const name of names) {
    const index = headerMap[normalizeHeader(name)];
    if (index === undefined) continue;
    const value = row[index];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/\s+/g, '_');
}

function splitAliases(value) {
  return String(value ?? '')
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePresentation(value) {
  return normalizeText(value)
    .replace(/mililitros?/g, 'ml')
    .replace(/litros?/g, 'l')
    .replace(/gramos?/g, 'g')
    .replace(/kilogramos?/g, 'kg')
    .replace(/unidades?/g, 'und');
}

function numberValue(value) {
  const normalized = String(value ?? '').replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = normalizeText(value);
  if (['false', 'falso', 'no', '0', 'inactivo'].includes(normalized)) return false;
  if (['true', 'verdadero', 'si', '1', 'activo'].includes(normalized)) return true;
  return fallback;
}

function parseJsonCell(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mergeByKey(current, incoming, key) {
  const byKey = new Map((current ?? []).map((item) => [item[key], item]));
  for (const item of incoming ?? []) {
    if (!item?.[key]) continue;
    byKey.set(item[key], { ...(byKey.get(item[key]) ?? {}), ...item });
  }
  return [...byKey.values()];
}

function rankRowsByQuery(rows, query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return rows;
  return rows
    .map((row) => {
      const nameTokens = tokenize([row.name, row.brand].filter(Boolean).join(' '));
      const aliasTokens = tokenize([row.sku, row.productFamily, ...(row.aliases ?? [])].filter(Boolean).join(' '));
      const supportingTokens = tokenize([
        row.category,
        row.presentation,
        row.normalizedPresentation,
        row.description,
        ...(row.tags ?? []),
      ].filter(Boolean).join(' '));
      const nameFirstToken = nameTokens[0] ?? '';
      let score = 0;
      let matched = 0;
      let strongMatches = 0;
      for (const token of queryTokens) {
        let tokenScore = 0;
        if (nameTokens.includes(token)) {
          tokenScore = token === nameFirstToken ? 20 : 12;
          strongMatches += 1;
        } else if (aliasTokens.includes(token)) {
          tokenScore = 11;
          strongMatches += 1;
        } else if (hasCompatiblePrefix(nameTokens, token)) {
          tokenScore = 8;
          strongMatches += 1;
        } else if (hasCompatiblePrefix(aliasTokens, token)) {
          tokenScore = 7;
          strongMatches += 1;
        } else if (supportingTokens.includes(token)) {
          tokenScore = 4;
        } else if (hasCompatiblePrefix(supportingTokens, token)) {
          tokenScore = 3;
        } else if (hasCloseTypo([...nameTokens, ...aliasTokens], token)) {
          tokenScore = 6;
          strongMatches += 1;
        }
        if (tokenScore) {
          score += tokenScore;
          matched += 1;
        }
      }
      const coverage = matched / queryTokens.length;
      return {
        ...row,
        matchScore: Number((score / queryTokens.length).toFixed(2)),
        matchType: strongMatches > 0 && coverage >= 0.5 ? 'exact_or_alias' : 'similar',
      };
    })
    .filter((row) => row.matchScore >= 3)
    .sort((a, b) => b.matchScore - a.matchScore || b.stock - a.stock);
}

function hasCompatiblePrefix(tokens, queryToken) {
  return tokens.some((candidate) => (
    candidate.length >= 4 && queryToken.length >= 4 &&
    (candidate.startsWith(queryToken) || queryToken.startsWith(candidate))
  ));
}

function hasCloseTypo(tokens, queryToken) {
  return tokens.some((candidate) => (
    candidate.length >= 6 && queryToken.length >= 6 &&
    levenshtein(candidate, queryToken) <= (candidate.length >= 8 && queryToken.length >= 8 ? 2 : 1)
  ));
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !CATALOG_STOPWORDS.has(token));
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length][b.length];
}

const CATALOG_STOPWORDS = new Set([
  'algo', 'para', 'domicilio', 'tienes', 'tiene', 'hay', 'con', 'los', 'las',
  'una', 'uno', 'unos', 'unas', 'por', 'favor', 'quiero', 'quieres', 'recomienda',
  'recomiendas', 'regala', 'regalame', 'manda', 'mandame', 'necesito', 'me', 'que',
]);

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
