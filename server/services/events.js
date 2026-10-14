export class EventService {
  constructor(store) {
    this.store = store;
  }

  emit({ type, tenantId, conversationId = 'system', detail, metadata = {} }) {
    const linkedRequest = ensureHumanRequestForEvent(this.store, { type, tenantId, conversationId, detail, metadata });
    const eventMetadata = linkedRequest
      ? { ...metadata, requestId: linkedRequest.id, autoLinkedHumanRequest: linkedRequest.created }
      : metadata;
    const event = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      type,
      tenantId,
      conversationId,
      detail,
      metadata: eventMetadata,
    };
    this.store.mutate((state) => {
      state.events.unshift(event);
      state.events = state.events.slice(0, 500);
    });
    this.store.persistEvent?.(event);
    return event;
  }

  async list({ tenantId, limit = 50 }) {
    if (this.store.listEvents) return this.store.listEvents({ tenantId, limit });
    return this.store
      .getState()
      .events.filter((event) => !tenantId || event.tenantId === tenantId)
      .slice(0, limit);
  }
}

const HUMAN_REQUEST_EVENT_TYPES = new Set(['decision.requested', 'approval.requested', 'human_handoff']);

function ensureHumanRequestForEvent(store, event) {
  if (!shouldCreateHumanRequest(event)) return null;
  if (event.metadata?.requestId) return { id: event.metadata.requestId, created: false };

  let linkedRequest;
  store.mutate((state) => {
    state.pendingRequests ??= [];
    const existing = state.pendingRequests.find((request) => (
      request.tenantId === event.tenantId
      && request.conversationId === event.conversationId
      && request.type === event.type
      && (request.status ?? 'pending') === 'pending'
    ));
    if (existing) {
      linkedRequest = { id: existing.id, created: false };
      return;
    }

    const request = buildHumanRequestFromEvent(event);
    state.pendingRequests.unshift(request);
    const conversation = state.conversations?.find((item) => item.id === event.conversationId);
    if (conversation) {
      conversation.status = event.type === 'human_handoff' ? 'blocked' : 'approval_required';
      conversation.zone = 'approval';
      conversation.humanReason = request.context;
      conversation.nextStep = request.consequence;
    }
    linkedRequest = { id: request.id, created: true, conversationId: request.conversationId };
  });

  if (linkedRequest?.created) {
    store.persistPendingRequest?.(linkedRequest.id);
    store.persistConversation?.(linkedRequest.conversationId);
  }
  return linkedRequest;
}

function shouldCreateHumanRequest(event) {
  return HUMAN_REQUEST_EVENT_TYPES.has(event.type)
    && Boolean(event.tenantId)
    && Boolean(event.conversationId)
    && event.conversationId !== 'system';
}

function buildHumanRequestFromEvent(event) {
  const createdAt = new Date().toISOString();
  const templates = {
    'decision.requested': {
      prefix: 'decision',
      title: 'Decision humana requerida',
      urgency: 'Alta',
      context: 'El agente requiere criterio humano antes de ejecutar la siguiente accion.',
      consequence: 'Al responder, el agente continuara el flujo con la decision registrada.',
    },
    'approval.requested': {
      prefix: 'hitl',
      title: 'Aprobacion humana requerida',
      urgency: 'Alta',
      context: 'El agente requiere autorizacion humana para continuar.',
      consequence: 'Al aprobar, el agente reanudara el flujo desde el punto de control.',
    },
    human_handoff: {
      prefix: 'handoff',
      title: 'Escalamiento humano',
      urgency: 'Critica',
      context: 'El agente escalo la conversacion para intervencion humana.',
      consequence: 'Al responder, el agente retomara el flujo desde el checkpoint guardado.',
    },
  };
  const template = templates[event.type];
  return {
    id: `${template.prefix}-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: event.tenantId,
    conversationId: event.conversationId,
    title: event.metadata?.title ?? event.detail ?? template.title,
    urgency: event.metadata?.urgency ?? template.urgency,
    type: event.type,
    context: event.metadata?.context ?? event.detail ?? template.context,
    consequence: event.metadata?.consequence ?? template.consequence,
    status: 'pending',
    createdAt,
    resolvedAt: null,
    sourceEventType: event.type,
    idempotencyKey: event.metadata?.idempotencyKey ?? null,
  };
}
