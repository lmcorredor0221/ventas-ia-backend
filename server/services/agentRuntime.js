export class AgentRuntime {
  constructor({ store, events, tools, config }) {
    this.store = store;
    this.events = events;
    this.tools = tools;
    this.config = config;
  }

  async processInbound(normalized) {
    const tenantId = normalized.tenantId ?? this.config.defaultTenantId;
    const conversation = this.ensureConversation(tenantId, normalized);

    if (this.isDuplicate(normalized.messageId)) {
      return { duplicate: true, conversation };
    }
    this.markProcessed(normalized.messageId);

    this.events.emit({ type: 'agent.started', tenantId, conversationId: conversation.id, detail: 'Inbound WhatsApp message received' });
    this.addMessage(conversation.id, { role: 'user', text: normalized.text || `[${normalized.messageType}]`, providerMessageId: normalized.messageId });

    try {
      const result = await this.routeConversation(tenantId, conversation.id, normalized);
      this.events.emit({ type: 'agent.completed', tenantId, conversationId: conversation.id, detail: result.summary });
      return { duplicate: false, conversation: this.getConversation(conversation.id), result };
    } catch (error) {
      this.events.emit({ type: 'agent.failed', tenantId, conversationId: conversation.id, detail: error.message });
      this.patchConversation(conversation.id, { status: 'degraded', zone: 'observability', nextStep: 'Revisar incidente y reintentar.' });
      throw error;
    }
  }

  async routeConversation(tenantId, conversationId, normalized) {
    const text = (normalized.text ?? '').toLowerCase();

    if (normalized.messageType === 'image' || normalized.mediaRef) {
      await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: 'Clasificar imagen enviada por cliente',
        assigned_team: 'ventas',
        context_snapshot: { summary: 'El ACP define que imagen entrante requiere escalamiento humano.', normalized },
      });
      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: 'Recibimos tu imagen. Un asesor la revisara y retomaremos la cotizacion con el producto identificado.',
      });
      return { summary: 'Image escalated to human handoff' };
    }

    if (containsAny(text, ['humano', 'asesor', 'persona', 'ayuda'])) {
      await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: 'Cliente solicita asesor humano',
        assigned_team: 'ventas',
        context_snapshot: { summary: normalized.text },
      });
      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: 'Te conecto con un asesor. Dejamos tu solicitud registrada para continuar sin perder el contexto.',
      });
      return { summary: 'Customer requested human advisor' };
    }

    if (containsAny(text, ['descuento', 'rebaja', 'excepcion', 'excepción'])) {
      await this.tools.call('approval_gate', tenantId, conversationId, {
        gate_key: 'discount_exception',
        proposed_action: 'Aprobar descuento comercial',
        payload_summary: {
          reason: 'El cliente solicita una excepcion de descuento fuera de politica delegada.',
          consequence: 'Al aprobar, el agente enviara cotizacion ajustada y esperara confirmacion.',
        },
      });
      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: 'Estoy validando el descuento con el equipo comercial. Te aviso apenas quede aprobado.',
      });
      return { summary: 'Discount approval requested' };
    }

    if (containsAny(text, ['pago', 'pagado', 'transferencia', 'comprobante', 'confirmo'])) {
      await this.tools.call('approval_gate', tenantId, conversationId, {
        gate_key: 'payment_confirmation',
        proposed_action: 'Registrar confirmacion de pago',
        payload_summary: {
          reason: 'Registrar pago requiere aprobacion antes de escritura transaccional.',
          consequence: 'Al aprobar, se actualizara el estado del pedido.',
        },
      });
      return { summary: 'Payment write approval requested' };
    }

    const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
      range: this.getTenant(tenantId)?.config?.googleSheets?.range,
      filters: inferCatalogFilter(text),
      cache_policy: 'short_ttl',
    });
    const selected = catalog.rows[0];
    const drive = await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
      file_ids: selected?.driveFileId ? [selected.driveFileId] : [],
      refresh_mode: 'on_demand',
    });

    const quote = selected
      ? `Tengo disponible ${selected.name} por ${formatCurrency(selected.price)}. Stock actual: ${selected.stock}. ${drive.files[0]?.summary ?? ''}`
      : 'No encontre una coincidencia clara en el catalogo. Puedo pedir apoyo humano o buscar con mas detalles.';

    this.patchConversation(conversationId, {
      stage: selected ? 'quote' : 'catalog',
      zone: selected ? 'quote' : 'catalog',
      status: selected ? 'live' : 'needs_binding',
      value: selected ? formatCurrency(selected.price) : 'Pendiente',
      progress: selected ? 68 : 32,
      need: normalized.text,
      nextStep: selected ? 'Esperar confirmacion de compra o pago.' : 'Solicitar mas informacion o escalar.',
      lastTool: 'google_sheets_read_table',
    });

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: quote,
    });

    return { summary: selected ? 'Catalog quote sent' : 'Catalog search needs review' };
  }

  resolveHumanRequest(requestId, { outcome, note, approverId = 'local-admin' }) {
    let request;
    this.store.mutate((state) => {
      request = state.pendingRequests.find((item) => item.id === requestId);
      if (!request) throw new Error(`Request not found: ${requestId}`);
      request.status = outcome === 'approved' ? 'resolved' : 'denied';
      request.resolvedAt = new Date().toISOString();
      request.resolutionNote = note ?? '';
      request.approverId = approverId;
      request.approvalToken = outcome === 'approved' ? `APPROVED-${crypto.randomUUID()}` : null;
      const conversation = state.conversations.find((item) => item.id === request.conversationId);
      if (conversation) {
        conversation.status = outcome === 'approved' ? 'live' : 'blocked';
        conversation.zone = outcome === 'approved' ? 'agent' : 'approval';
        conversation.progress = outcome === 'approved' ? Math.max(conversation.progress ?? 0, 78) : conversation.progress;
        conversation.nextStep = outcome === 'approved' ? 'Flujo reanudado con aprobacion humana.' : 'Operacion rechazada; revisar alternativa.';
        conversation.updatedAt = new Date().toISOString();
      }
    });
    this.events.emit({
      type: outcome === 'approved' ? 'approval.granted' : 'approval.denied',
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      detail: request.title,
      metadata: { requestId, approverId },
    });
    return request;
  }

  ensureConversation(tenantId, normalized) {
    const existing = this.store
      .getState()
      .conversations.find((item) => item.tenantId === tenantId && item.waId === normalized.waId);
    if (existing) return existing;
    const created = {
      id: `wa-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      waId: normalized.waId,
      customer: normalized.profileName ?? normalized.waId,
      avatar: initials(normalized.profileName ?? normalized.waId),
      stage: 'inbound',
      zone: 'whatsapp',
      status: 'live',
      value: 'Pendiente',
      progress: 12,
      need: normalized.text ?? normalized.messageType,
      nextStep: 'Planificar siguiente accion.',
      humanReason: '',
      lastTool: 'whatsapp_business_messaging',
      path: ['whatsapp', 'agent', 'catalog', 'quote', 'approval', 'payment'],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.mutate((state) => {
      state.conversations.unshift(created);
    });
    return created;
  }

  addMessage(conversationId, message) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      conversation.messages.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...message });
      conversation.need = message.text ?? conversation.need;
      conversation.updatedAt = new Date().toISOString();
    });
  }

  patchConversation(conversationId, patch) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (conversation) Object.assign(conversation, patch, { updatedAt: new Date().toISOString() });
    });
  }

  getConversation(conversationId) {
    return this.store.getState().conversations.find((item) => item.id === conversationId);
  }

  getTenant(tenantId) {
    return this.store.getState().tenants.find((item) => item.id === tenantId);
  }

  isDuplicate(messageId) {
    if (!messageId) return false;
    return this.store.getState().processedMessages.includes(messageId);
  }

  markProcessed(messageId) {
    if (!messageId) return;
    this.store.mutate((state) => {
      state.processedMessages.unshift(messageId);
      state.processedMessages = [...new Set(state.processedMessages)].slice(0, 1000);
    });
  }
}

function containsAny(text, words) {
  return words.some((word) => text.includes(word));
}

function inferCatalogFilter(text) {
  if (text.includes('mostrador')) return { category: 'mobiliario' };
  if (text.includes('vitrina')) return { category: 'exhibicion' };
  if (text.includes('repuesto') || text.includes('motor')) return { category: 'repuestos' };
  if (text.includes('hogar')) return { category: 'hogar' };
  return {};
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
}

function initials(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'WA';
}
