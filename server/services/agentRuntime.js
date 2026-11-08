import { appendAuditEvent } from './authService.js';
import { requireWhatsAppRecipient } from '../domain/whatsappIdentity.js';
import { processCoexistenceEvent } from './whatsappCoexistence.js';
import { isClosedConversation, isDispatchedConversation } from '../domain/conversationStatus.js';
import { hasOpenHumanRequest } from './pendingRequestPolicy.js';
import { paymentMethodLabel, paymentMethodOptionsLabel, paymentMethodsForTenant, resolvePaymentMethod } from './paymentMethods.js';
import { assessCommerceItems, WHATSAPP_COMMERCE_NOTICE } from '../domain/whatsappCommercePolicy.js';
import { basketKey, checkoutProgress } from '../domain/orderCheckout.js';
import { CatalogResolutionService } from './catalogResolutionService.js';

export class AgentRuntime {
  constructor({ store, events, tools, planner, usage, config, orders = null, telemetry = null, catalogResolver = null }) {
    this.store = store;
    this.events = events;
    this.tools = tools;
    this.planner = planner;
    this.usage = usage;
    this.config = config;
    this.orders = orders;
    this.telemetry = telemetry;
    this.catalogResolution = catalogResolver ?? new CatalogResolutionService({
      getPlanner: () => this.planner,
      events,
      telemetry,
      enabled: () => this.contextualProductSelectionEnabled(),
    });
    this.manualSweepTimer = null;
    this.conversationEnsureLocks = new Map();
  }

  contextualProductSelectionEnabled() {
    return this.config?.contextualProductSelectionV2 === true
      || process.env.CONTEXTUAL_PRODUCT_SELECTION_V2 === 'true';
  }

  start() {
    if (this.manualSweepTimer) return;
    const intervalMs = Number(this.config.manualCaseSweepIntervalMs ?? 30_000);
    this.manualSweepTimer = setInterval(() => {
      this.closeExpiredManualCases().catch((error) => {
        console.error('Manual case sweep failed:', error.message);
      });
    }, intervalMs);
    this.manualSweepTimer.unref?.();
  }

  stop() {
    if (!this.manualSweepTimer) return;
    clearInterval(this.manualSweepTimer);
    this.manualSweepTimer = null;
  }

  async processInbound(normalized, options = {}) {
    const tenantId = normalized.tenantId ?? this.config.defaultTenantId;
    const traceId = normalized.traceId
      ?? (normalized.messageId ? `wa:${normalized.messageId}` : `inbound:${Date.now()}`);
    normalized.traceId = traceId;
    const trace = this.telemetry?.startTrace({
      traceId,
      tenantId,
      messageId: normalized.messageId ?? null,
      conversationId: normalized.conversationId ?? null,
      source: normalized.provider ?? 'inbound',
    });
    try {
      const result = await this.processInboundCore(normalized, options);
      trace?.complete(result?.duplicate ? 'duplicate' : 'ok', {
        conversationId: result?.conversation?.id ?? normalized.conversationId ?? null,
      });
      return result;
    } catch (error) {
      trace?.complete('error', { errorCode: error.code ?? null, toolName: error.toolName ?? null });
      throw error;
    }
  }

  async processInboundCore(normalized, { skipIdempotency = false } = {}) {
    if (normalized.coexistenceEvent) return processCoexistenceEvent(this, normalized);
    normalized.waId = requireWhatsAppRecipient(normalized.waId);
    const tenantId = normalized.tenantId ?? this.config.defaultTenantId;
    normalized.traceId ??= normalized.messageId ? `wa:${normalized.messageId}` : `inbound:${Date.now()}`;
    await this.closeExpiredManualCases();
    const conversation = await this.ensureConversation(tenantId, normalized);
    if (conversation.traceId !== normalized.traceId) {
      await this.patchConversation(conversation.id, { traceId: normalized.traceId });
    }

    if (!skipIdempotency && await this.isDuplicate(normalized.messageId)) {
      return { duplicate: true, conversation };
    }

    if (conversation.manualMode === 'whatsapp_external' || conversation.status === 'manual_active') {
      const claimed = skipIdempotency || await this.claimProcessed(normalized.messageId, { tenantId, conversationId: conversation.id, provider: normalized.provider });
      if (!claimed) return { duplicate: true, conversation };
      await this.addMessage(conversation.id, {
        role: 'user',
        text: normalized.text || `[${normalized.messageType}]`,
        providerMessageId: normalized.messageId,
      });
      await this.patchConversation(conversation.id, { manualLastActivityAt: new Date().toISOString() });
      return {
        duplicate: false,
        manual: true,
        conversation: await this.getConversation(conversation.id),
        result: { summary: 'Manual WhatsApp conversation recorded' },
      };
    }

    await this.usage?.assertCanProcessInteraction(tenantId, { conversationId: conversation.id });
    const claimed = skipIdempotency || await this.claimProcessed(normalized.messageId, { tenantId, conversationId: conversation.id, provider: normalized.provider });
    if (!claimed) return { duplicate: true, conversation };
    this.usage?.recordAgentInteraction(tenantId, {
      conversationId: conversation.id,
      provider: normalized.provider,
      messageType: normalized.messageType,
    });

    this.events.emit({ type: 'agent.started', tenantId, conversationId: conversation.id, detail: 'Inbound WhatsApp message received', metadata: { traceId: normalized.traceId, messageId: normalized.messageId } });
    await this.addMessage(conversation.id, { role: 'user', text: normalized.text || `[${normalized.messageType}]`, providerMessageId: normalized.messageId });

    try {
      if (isCancellationRequest(normalized.text)) {
        const result = await this.cancelConversation({ tenantId, conversationId: conversation.id, normalized });
        this.events.emit({ type: 'agent.completed', tenantId, conversationId: conversation.id, detail: result.summary, metadata: { traceId: normalized.traceId, messageId: normalized.messageId } });
        return { duplicate: false, conversation: await this.getConversation(conversation.id), result };
      }
      if (hasOpenHumanRequest(this.store.getState(), conversation.id)) {
        await this.patchConversation(conversation.id, {
          need: normalized.text || `[${normalized.messageType}]`,
          nextStep: 'El equipo de la tienda debe resolver la solicitud humana abierta antes de reanudar el agente.',
        });
        const result = { summary: 'Customer message recorded while human review is pending' };
        this.events.emit({ type: 'agent.completed', tenantId, conversationId: conversation.id, detail: result.summary, metadata: { traceId: normalized.traceId, messageId: normalized.messageId } });
        return { duplicate: false, conversation: await this.getConversation(conversation.id), result };
      }
      const result = await this.routeConversation(tenantId, conversation.id, normalized);
      this.events.emit({ type: 'agent.completed', tenantId, conversationId: conversation.id, detail: result.summary, metadata: { traceId: normalized.traceId, messageId: normalized.messageId } });
      return { duplicate: false, conversation: await this.getConversation(conversation.id), result };
    } catch (error) {
      const failure = describeOperationalFailure(error);
      this.events.emit({
        type: 'agent.failed',
        tenantId,
        conversationId: conversation.id,
        detail: error.message,
        metadata: {
          traceId: normalized.traceId,
          messageId: normalized.messageId,
          errorCode: error.code ?? null,
          toolName: error.toolName ?? null,
        },
      });
      await this.patchConversation(conversation.id, {
        status: 'degraded',
        zone: 'observability',
        lastTool: error.toolName ?? conversation.lastTool ?? 'planner',
        nextStep: failure.nextStep,
        humanReason: failure.humanReason,
      });
      throw error;
    }
  }

  async processQueuedInbound(messageId) {
    const inbound = await this.store.getInboundMessage?.(messageId);
    if (!inbound) throw new Error(`Inbound message ${messageId} not found`);
    if (inbound.status === 'completed') return { duplicate: true, inbound };
    const receivedAt = Date.parse(inbound.receivedAt ?? inbound.createdAt ?? inbound.payload?.receivedAt);
    if (Number.isFinite(receivedAt)) {
      this.telemetry?.record('inbound', 'queue_wait', {
        durationMs: Math.max(0, Date.now() - receivedAt),
        status: 'ok',
        tenantId: inbound.tenantId ?? inbound.payload?.tenantId ?? null,
        traceId: inbound.payload?.traceId ?? null,
        metadata: { messageId, status: inbound.status },
      });
    }
    await this.store.markInboundMessageProcessing?.(messageId);
    try {
      const result = await this.processInbound(inbound.payload, { skipIdempotency: true });
      await this.store.completeInboundMessage?.(messageId, {
        duplicate: Boolean(result.duplicate),
        conversationId: result.conversation?.id ?? null,
        summary: result.result?.summary ?? null,
      });
      return result;
    } catch (error) {
      await this.store.failInboundMessage?.(messageId, error);
      throw error;
    }
  }

  async routeConversation(tenantId, conversationId, normalized) {
    if (normalized.interactive?.optionId) {
      return this.handleInteractiveReply({ tenantId, conversationId, normalized });
    }
    const customerLookup = await this.tools.call('google_sheets_customer_profile_lookup', tenantId, conversationId, {
      wa_id: normalized.waId,
      profile_name: normalized.profileName,
    });
    const customerProfile = customerLookup.profile;
    if (customerProfile?.name) {
      await this.patchConversation(conversationId, { customer: customerProfile.name, avatar: initials(customerProfile.name) });
    }

    const currentConversation = await this.getConversation(conversationId);
    const planned = await this.planner.plan({ tenantId, conversationId, normalized, customerProfile, conversation: currentConversation });
    const plan = suppressImplicitProductHandoff(planned, currentConversation);
    if (plan !== planned) {
      this.events.emit({
        type: 'llm.handoff.suppressed',
        tenantId,
        conversationId,
        detail: 'La dificultad de catálogo se mantuvo en el flujo comercial para buscar o aclarar.',
        metadata: { originalIntent: planned.intent, newIntent: plan.intent, traceId: normalized.traceId },
      });
    }
    await this.patchConversation(conversationId, {
      reasoningPlan: plan,
      aiExecution: {
        mode: plan.executionMode,
        provider: plan.provider,
        model: plan.model,
        plannedAt: new Date().toISOString(),
      },
      lastTool: 'llm_core',
      ...(plan.intent === 'greeting' ? {} : {
        stage: 'planning',
        zone: 'agent',
        progress: Math.max(currentConversation?.progress ?? 0, 22),
      }),
    });

    const commerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, plan,
      items: plan.order?.items?.length ? plan.order.items : currentConversation?.orderDraft?.items ?? [] });
    if (commerceResult) return commerceResult;
    if (plan.intent === 'greeting' && !normalized.mediaRef && normalized.messageType !== 'image') {
      return this.handleGreeting({ tenantId, conversationId, normalized, plan, currentConversation });
    }
    if (currentConversation?.commercePolicy?.awaitingContinuation) {
      if (plan.commercePolicy?.continueAllowedItems || plan.intent === 'order_confirmation') {
        return this.continueAllowedOrder({ tenantId, conversationId, normalized, customerProfile });
      }
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized,
        reason: 'Quedaron únicamente los productos permitidos. Usa «Continuar sin ellos» para revisarlos o «Cancelar solicitud».' });
    }
    if (customerLookup.status === 'connection_required') {
      return this.handleGoogleUnavailable({ tenantId, conversationId, normalized, plan });
    }

    if (normalized.messageType === 'image' || normalized.mediaRef || plan.intent === 'human_handoff') {
      const handoff = await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: normalized.messageType === 'image' || normalized.mediaRef ? 'Clasificar imagen enviada por cliente'
          : plan.executionMode === 'provider_unavailable_handoff' ? 'No fue posible obtener una interpretación completa del agente; revisar los mensajes pendientes'
            : 'Solicitud requiere atención de la tienda',
        assigned_team: 'ventas',
        context_snapshot: { summary: normalized.text || 'Caso requiere apoyo humano.', normalized, plan },
      });
      if (!handoff.reused) {
        await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
          action: 'send_session_message',
          wa_id: normalized.waId,
          text: normalized.messageType === 'image' || normalized.mediaRef
            ? 'Recibimos tu imagen. Un asesor la revisara y retomaremos la cotizacion con el producto identificado.'
            : 'Te conecto con un asesor. Dejamos tu solicitud registrada para continuar sin perder el contexto.',
        });
      }
      return { summary: handoff.reused ? 'Human handoff already pending' : 'Human handoff requested', plan };
    }

    if (plan.intent === 'discount_request') {
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
      return { summary: 'Discount approval requested', plan };
    }

    if (plan.intent === 'payment_confirmation') {
      await this.tools.call('approval_gate', tenantId, conversationId, {
        gate_key: 'payment_confirmation',
        proposed_action: 'Registrar confirmacion de pago',
        payload_summary: {
          reason: 'Registrar pago requiere aprobacion antes de escritura transaccional.',
          consequence: 'Al aprobar, se actualizara el estado del pedido.',
        },
      });
      return { summary: 'Payment write approval requested', plan };
    }

    if (plan.intent === 'order_confirmation') {
      return this.handleOrderConfirmation({ tenantId, conversationId, normalized, plan, customerProfile });
    }

    if (plan.intent === 'order_clarification') {
      return this.handleOrderClarification({ tenantId, conversationId, normalized, plan, customerProfile });
    }

    if (plan.intent === 'delivery_order') {
      return this.handleDeliveryOrder({ tenantId, conversationId, normalized, plan, customerProfile });
    }

    return this.handleCatalogQuery({ tenantId, conversationId, normalized, plan });
  }

  async handleGreeting({ tenantId, conversationId, normalized, plan, currentConversation }) {
    // The same interpretation call writes the greeting in the tenant's voice.
    // Keep any active draft, quote, pending interaction and stage untouched.
    const text = plan.greetingReply || '¡Hola! ¿En qué te puedo ayudar?';
    if (!currentConversation?.orderDraft && !currentConversation?.orderId) {
      await this.patchConversation(conversationId, {
        status: 'live', stage: 'conversation', zone: 'agent',
        nextStep: 'Esperar la solicitud del cliente.',
      });
    }
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message', wa_id: normalized.waId, text,
    });
    this.events.emit({ type: 'agent.greeting.replied', tenantId, conversationId,
      detail: 'Saludo atendido sin buscar productos ni modificar el pedido.',
      metadata: { traceId: normalized.traceId, executionMode: plan.executionMode } });
    return { summary: 'Greeting answered', plan };
  }

  async enforceCommercePolicy({ tenantId, conversationId, normalized, plan = {}, items = plan.order?.items ?? [] }) {
    const products = this.store.listProducts ? await this.store.listProducts(tenantId) : this.store.getState().productsByTenant?.[tenantId] ?? [];
    const decision = assessCommerceItems({ items, policy: plan.commercePolicy, products });
    if (!decision.blocked) return null;
    const conversation = await this.getConversation(conversationId);
    // Keep permitted lines already captured, but never retain a restricted
    // product snapshot, quote or total in the draft being continued.
    const previous = assessCommerceItems({ items: conversation?.orderDraft?.items ?? [], products,
      policy: { restrictedItems: decision.restrictedItems, uncertainItems: decision.uncertainItems } });
    const kept = mergeOrderItems(previous.allowedItems, decision.allowedItems);
    const allowedItems = kept.map(({ product, lineTotal, available, presentationOptions, ...item }) => ({
      ...item, skuHint: product?.sku ?? item.skuHint ?? item.sku,
      catalogQuery: product?.name ?? item.catalogQuery ?? item.rawName ?? item.name,
    }));
    const unresolvedItems = mergeOrderItems(previous.unresolvedItems, decision.unresolvedItems)
      .map(({ product, lineTotal, available, presentationOptions, ...item }) => item);
    const awaitingContinuation = decision.restrictedItems.length > 0 && allowedItems.length > 0 && !unresolvedItems.length;
    const notice = decision.restrictedItems.length ? WHATSAPP_COMMERCE_NOTICE : '';
    const clarification = decision.uncertainItems.length
      ? '¿Puedes aclarar el producto y para qué uso lo necesitas? Necesito identificarlo antes de continuar.' : '';
    const continuation = awaitingContinuation ? 'Conservé los demás productos. ¿Deseas continuar únicamente con ellos?' : '';
    const text = [notice, clarification, continuation].filter(Boolean).join(' ');
    await this.patchConversation(conversationId, {
      status: 'live', stage: 'clarification', zone: 'agent', value: 'Pendiente', lastTool: 'whatsapp_commerce_policy',
      nextStep: awaitingContinuation ? 'Esperar aceptación para continuar solo con productos permitidos.'
        : decision.uncertainItems.length ? 'Aclarar clasificación sin cotizar.' : 'Atender únicamente solicitudes permitidas por el canal.',
      commercePolicy: { restrictedItems: decision.restrictedItems, uncertainItems: decision.uncertainItems,
        customerDetails: plan.customerDetails ?? conversation?.commercePolicy?.customerDetails ?? null,
        awaitingContinuation, evaluatedAt: new Date().toISOString() },
      orderDraft: { delivery: Boolean(plan.order?.delivery || conversation?.orderDraft?.delivery), items: [...allowedItems, ...unresolvedItems],
        paymentMethod: plan.order?.paymentMethod ?? conversation?.orderDraft?.paymentMethod ?? null,
        missingFields: allowedItems.length ? [] : ['order_items'] },
    });
    this.events.emit({ type: 'whatsapp.commerce.restricted', tenantId, conversationId,
      detail: decision.restrictedItems.length ? 'Solicitud excluida por política del canal.' : 'Clasificación del producto pendiente de aclaración.',
      metadata: { traceId: normalized.traceId ?? null, categories: [...new Set(decision.restrictedItems.map(i => i.category))],
        restrictedCount: decision.restrictedItems.length, uncertainCount: decision.uncertainItems.length, retainedCount: allowedItems.length } });
    let interactive;
    if (awaitingContinuation && this.store.createInteractionOffer) {
      const id = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const options = [
        { id: `vi:${id}:1`, title: 'Continuar sin ellos', action: 'continue_allowed_order' },
        { id: `vi:${id}:2`, title: 'Cancelar solicitud', action: 'cancel_request' },
      ];
      await this.store.createInteractionOffer({ id, tenantId, conversationId, purpose: 'commerce_policy', options,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      interactive = { kind: 'button', body: text, buttons: options.map(({ id: optionId, title }) => ({ id: optionId, title })) };
    }
    // The compliance notice is fixed; a reply composer must not turn it into
    // an offer to finish a restricted sale through a person or another channel.
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message', wa_id: normalized.waId, text, ...(interactive ? { interactive } : {}),
    });
    return { summary: 'WhatsApp commerce restriction handled', plan };
  }

  async continueAllowedOrder({ tenantId, conversationId, normalized, customerProfile }) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation?.commercePolicy?.awaitingContinuation) {
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized, reason: 'Esa opción ya no corresponde a la solicitud actual.' });
    }
    const draft = structuredClone(conversation.orderDraft ?? { items: [] });
    const blocked = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, items: draft.items });
    if (blocked) return blocked;
    if (!customerProfile) customerProfile = (await this.tools.call('google_sheets_customer_profile_lookup', tenantId, conversationId, { wa_id: normalized.waId })).profile;
    const missingFields = [];
    if (draft.delivery && !customerProfile?.name) missingFields.push('customer_name');
    if (draft.delivery && !customerProfile?.defaultAddress) missingFields.push('delivery_address');
    await this.patchConversation(conversationId, { commercePolicy: { ...conversation.commercePolicy, awaitingContinuation: false } });
    return this.handleDeliveryOrder({ tenantId, conversationId, normalized, customerProfile, replaceDraft: true,
      plan: { intent: 'delivery_order', order: draft, missingFields, customerDetails: conversation.commercePolicy.customerDetails } });
  }

  async cancelConversation({ tenantId, conversationId, normalized }) {
    const now = new Date().toISOString();
    const cancellationMessage = 'Entendido. Cancelé esta solicitud y no se generó ningún pedido. Cuando quieras iniciar uno nuevo, escríbeme por aquí.';
    const cancelledRequestIds = [];

    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      const orderDraft = conversation.orderDraft
        ? { ...conversation.orderDraft, status: 'cancelled' }
        : { status: 'cancelled', items: [] };
      Object.assign(conversation, {
        stage: 'closed',
        zone: 'whatsapp',
        status: 'closed_no_confirmation',
        caseStatus: 'cancelled',
        inboxState: 'closed',
        manualMode: 'none',
        aiPaused: true,
        closedAt: now,
        closeReason: 'customer_cancelled',
        value: 'No confirmado',
        progress: 100,
        need: normalized.text ?? 'cancelar',
        nextStep: 'Solicitud cancelada por el cliente.',
        humanReason: '',
        lastTool: 'whatsapp_business_messaging',
        orderDraft,
      });
      for (const request of state.pendingRequests ?? []) {
        if (request.conversationId !== conversationId || request.status !== 'pending') continue;
        request.status = 'cancelled';
        request.resolvedAt = now;
        request.resolutionNote = 'Cancelado por el cliente desde WhatsApp.';
        cancelledRequestIds.push(request.id);
      }
    }, { snapshot: false, domain: 'conversations', operation: 'cancel' });
    await this.store.persistConversation?.(conversationId);
    await Promise.all(cancelledRequestIds.map((requestId) => this.store.persistPendingRequest?.(requestId)));
    this.events.emit({
      type: 'conversation.cancelled_by_customer',
      tenantId,
      conversationId,
      detail: 'Solicitud cancelada desde WhatsApp; automatización detenida.',
      metadata: { cancelledRequestIds },
    });

    let delivery = null;
    try {
      delivery = await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: cancellationMessage,
      });
    } catch (error) {
      await this.addMessage(conversationId, {
        role: 'system',
        channel: 'platform',
        text: 'Solicitud cancelada. No se pudo enviar la confirmación por WhatsApp.',
      });
      this.events.emit({
        type: 'conversation.cancellation_reply_failed',
        tenantId,
        conversationId,
        detail: error.message,
        metadata: { errorCode: error.code ?? null },
      });
    }

    return { summary: 'Customer cancelled request', delivery };
  }

  async handleGoogleUnavailable({ tenantId, conversationId, normalized, plan }) {
    const message = 'Recibí tu solicitud. En este momento no puedo verificar los productos y precios; le aviso a la tienda para que te ayude a continuar.';
    await this.patchConversation(conversationId, {
      stage: 'handoff',
      zone: 'approval',
      status: 'blocked',
      value: 'Pendiente de validacion',
      progress: 34,
      need: normalized.text,
      nextStep: 'El tendero debe conectar Google o validar el pedido manualmente.',
      lastTool: 'google_sheets_customer_profile_lookup',
    });
    const handoff = await this.tools.call('human_handoff', tenantId, conversationId, {
      reason: 'Google Drive/Sheets no disponible para validar catalogo y pedido',
      urgency: 'Alta',
      assigned_team: 'ventas',
      context_snapshot: {
        summary: message,
        customerWaId: normalized.waId,
        originalText: normalized.text,
        plan,
        action: 'connect_google_or_validate_order_manually',
      },
    });
    if (!handoff.reused) {
      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: message,
      });
    }
    return { summary: handoff.reused ? 'Google unavailable; human handoff already pending' : 'Google unavailable; human handoff requested', plan };
  }

  async resolveDriveContext({ tenantId, conversationId, selectedRows = [], reason } = {}) {
    const fileIds = [...new Set(selectedRows.map((row) => row?.driveFileId).filter(Boolean))];
    if (!fileIds.length) {
      return { status: 'not_applicable', files: [], source_refs: [] };
    }
    return this.tools.call('google_drive_file_picker', tenantId, conversationId, {
      file_ids: fileIds,
      refresh_mode: 'on_demand',
      ...(reason ? { reason } : {}),
    });
  }

  async handleCatalogIndexRequired({ tenantId, conversationId, normalized, plan }) {
    const message = 'Estoy actualizando el catálogo de la tienda para consultar productos y precios correctos. En un momento puedes intentar de nuevo.';
    await this.patchConversation(conversationId, {
      stage: 'catalog',
      zone: 'catalog',
      status: 'waiting',
      value: 'Actualización de catálogo pendiente',
      progress: 28,
      need: normalized.text,
      nextStep: 'El dueño de la tienda debe publicar la versión actualizada del catálogo.',
      lastTool: 'google_sheets_read_table',
    });
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: message,
    });
    return { summary: 'Catalog index publication required', plan };
  }

  async handleCatalogQuery({ tenantId, conversationId, normalized, plan }) {
    const commerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, plan });
    if (commerceResult) return commerceResult;
    const text = normalized.text ?? '';
    const catalogItems = plan.order?.items ?? [];
    const catalogSearches = catalogSearchesFromPlan(plan, catalogItems, text);

    if (catalogSearches.length > 1) {
      const matches = await Promise.all(catalogSearches.map(async (search) => {
        const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
          query: search.query,
          semanticQuery: search.semanticQuery,
          recommendation: search.recommendation === true,
          filters: search.filters,
          retrievalHints: search.retrievalHints,
          cache_policy: 'short_ttl',
        });
        return {
          query: search.query,
          code: catalog.code ?? null,
          restrictedItems: !catalog.rows.length ? catalog.restrictedItems ?? [] : [],
          selected: catalog.rows[0] ?? null,
          alternatives: catalog.rows.slice(1, 2),
        };
      }));
      if (matches.some((match) => match.code === 'catalog_index_required')) {
        return this.handleCatalogIndexRequired({ tenantId, conversationId, normalized, plan });
      }
      const restrictedItems = matches.flatMap(match => match.restrictedItems);
      if (restrictedItems.length) return this.enforceCommercePolicy({ tenantId, conversationId, normalized,
        plan: { ...plan, commercePolicy: { restrictedItems: restrictedItems.filter(i => i.category !== 'uncertain'),
          uncertainItems: restrictedItems.filter(i => i.category === 'uncertain') } } });
      const selectedRows = matches.map((match) => match.selected).filter(Boolean);
      const drive = await this.resolveDriveContext({ tenantId, conversationId, selectedRows });
      const quote = buildMultiCatalogReply({ matches, drive, delivery: Boolean(plan.order?.delivery) });
      const hasMatches = selectedRows.length > 0;

      await this.patchConversation(conversationId, {
        stage: hasMatches ? 'quote' : 'catalog',
        zone: hasMatches ? 'quote' : 'catalog',
        status: hasMatches ? 'live' : 'needs_binding',
        value: hasMatches ? 'Disponibilidad parcial' : 'Pendiente',
        progress: hasMatches ? 68 : 32,
        need: text,
        nextStep: hasMatches ? 'Guiar seleccion y cantidad del cliente.' : 'Solicitar mas informacion o escalar.',
        lastTool: 'google_sheets_read_table',
      });

      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: quote,
      });

      return { summary: hasMatches ? 'Catalog guided options sent' : 'Catalog search needs review', plan };
    }

    const search = catalogSearches[0] ?? { query: text, filters: inferCatalogFilter(text) };
    const query = search.query;
    const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
      query,
      semanticQuery: search.semanticQuery,
      recommendation: search.recommendation === true,
      filters: search.filters,
      retrievalHints: search.retrievalHints,
      cache_policy: 'short_ttl',
    });
    if (catalog.code === 'catalog_index_required') {
      return this.handleCatalogIndexRequired({ tenantId, conversationId, normalized, plan });
    }
    const selected = catalog.rows[0];
    if (!selected && catalog.restrictedItems?.length) return this.enforceCommercePolicy({ tenantId, conversationId, normalized,
      plan: { ...plan, commercePolicy: { restrictedItems: catalog.restrictedItems.filter(i => i.category !== 'uncertain'),
        uncertainItems: catalog.restrictedItems.filter(i => i.category === 'uncertain') } } });
    const alternatives = catalog.rows.slice(1, 4);
    const drive = await this.resolveDriveContext({
      tenantId,
      conversationId,
      selectedRows: selected ? [selected] : [],
    });

    const quote = selected
      ? buildCatalogReply({
        selected,
        alternatives,
        drive,
        delivery: Boolean(plan.order?.delivery),
        query,
        categoryQuery: Boolean(search.categoryQuery),
      })
      : 'No encontre una coincidencia clara en el catalogo. Puedo pedir apoyo humano o buscar con mas detalles.';

    await this.patchConversation(conversationId, {
      stage: selected ? 'quote' : 'catalog',
      zone: selected ? 'quote' : 'catalog',
      status: selected ? 'live' : 'needs_binding',
      value: selected ? formatCurrency(selected.price) : 'Pendiente',
      progress: selected ? 68 : 32,
      need: text,
      nextStep: selected ? 'Esperar confirmacion de compra o pago.' : 'Solicitar mas informacion o escalar.',
      lastTool: 'google_sheets_read_table',
    });

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: quote,
    });

    return { summary: selected ? 'Catalog quote sent' : 'Catalog search needs review', plan };
  }

  async handleDeliveryOrder({ tenantId, conversationId, normalized, plan, customerProfile, replaceDraft = false }) {
    const commerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, plan });
    if (commerceResult) return commerceResult;
    const tenant = await this.getTenant(tenantId);
    const paymentMethods = paymentMethodsForTenant(tenant);
    const collected = collectCustomerDetails({ plan, text: normalized.text, paymentMethods });
    let nextProfile = await this.upsertCapturedCustomerProfile({
      tenantId,
      conversationId,
      normalized,
      customerProfile,
      customerDetails: collected,
      delivery: Boolean(plan.order?.delivery),
    });
    const contextualSelection = this.contextualProductSelectionEnabled()
      && typeof this.planner?.adjudicateCatalogCandidates === 'function';
    const currentConversation = await this.getConversation(conversationId);
    // Delivery orders must use the same retrieval contract as catalog
    // queries. Keeping a second path here had let natural-language
    // hypotheses (for example "litro y medio") leak into hard filters.
    const searchesByCandidateIndex = new Map(
      catalogSearchesFromPlan(plan, plan.order?.items ?? [], normalized.text)
        .map((search) => [search.candidateIndex, search]),
    );
    const orderItemsFromCatalog = await Promise.all((plan.order?.items ?? []).map(async (item, index) => {
      const search = searchesByCandidateIndex.get(index) ?? {
        query: catalogQueryWithPresentation(item.catalogQuery ?? item.rawName, item.requestedPresentation ?? item.presentationHint),
        filters: {},
        retrievalHints: retrievalHintsForCatalogItem(item),
      };
      const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
        query: search.query,
        semanticQuery: search.semanticQuery,
        recommendation: search.recommendation === true,
        filters: search.filters,
        retrievalHints: search.retrievalHints,
        cache_policy: 'short_ttl',
      });
      // The interpreter can leave a compact numeric presentation (for example
      // "coca cola 350") in the product phrase.  Use the catalog results to
      // turn that evidence into a presentation constraint *for resolution
      // only*.  Retrieval stays broad: this must never discard a possible
      // product before the resolver has seen it.
      const itemForResolution = withCatalogPresentationEvidence(item, catalog.rows);
      const product = contextualSelection
        ? selectUniqueAcceptableOrderProduct(catalog.rows, itemForResolution)
        : selectAcceptableOrderProduct(catalog.rows, itemForResolution);
      const catalogCandidates = contextualSelection
        ? catalogEvidenceForItem(catalog.rows, itemForResolution, product)
        : undefined;
      return {
        ...itemForResolution,
        catalogIndexRequired: catalog.code === 'catalog_index_required',
        ...(!catalog.rows.length && catalog.restrictedItems?.length
          ? { commerceCategory: catalog.restrictedItems[0].category } : {}),
        product,
        presentationOptions: presentationOptionsForItem(catalog.rows, itemForResolution, product),
        ...(catalogCandidates ? { catalogCandidates } : {}),
        lineTotal: quotedLineTotal({ ...item, product }),
        available: Boolean(product && product.stock >= (item.quantity ?? 1)),
      };
    }));
    if (orderItemsFromCatalog.some((item) => item.catalogIndexRequired)) {
      return this.handleCatalogIndexRequired({ tenantId, conversationId, normalized, plan });
    }
    const resolution = contextualSelection
      ? await this.catalogResolution.resolve({
        tenantId,
        conversationId,
        normalized,
        conversation: currentConversation,
        items: orderItemsFromCatalog,
      })
      : { items: orderItemsFromCatalog, status: 'legacy_fallback' };
    const orderItems = resolution.items.map((item) => ({
      ...item,
      lineTotal: quotedLineTotal(item),
      available: Boolean(item.product && item.product.stock >= (item.quantity ?? 1)),
    }));
    const previousDraft = currentConversation?.orderDraft;
    const effectiveOrderItems = previousDraft && !replaceDraft && isAdditiveOrderText(normalized.text)
      ? mergeOrderItems(previousDraft.items ?? [], orderItems)
      : orderItems;

    const resolvedCommerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, plan, items: effectiveOrderItems });
    if (resolvedCommerceResult) return resolvedCommerceResult;

    const selectedRows = effectiveOrderItems.map((item) => item.product).filter(Boolean);
    const drive = await this.resolveDriveContext({
      tenantId,
      conversationId,
      selectedRows,
      reason: 'validate_order_product_files',
    });

    const missingFields = [...(!replaceDraft && isAdditiveOrderText(normalized.text) ? previousDraft?.missingFields ?? [] : []), ...(plan.missingFields ?? [])];
    const selectedPaymentMethod = resolvePaymentMethod(normalized.text, paymentMethods)
      ?? resolvePaymentMethod(plan.order?.paymentMethod, paymentMethods)
      ?? resolvePaymentMethod(previousDraft?.paymentMethod, paymentMethods)
      ?? resolvePaymentMethod(collected.paymentMethod, paymentMethods);
    if (!effectiveOrderItems.length) missingFields.push('order_items');
    for (const item of effectiveOrderItems) {
      if (item.product) {
        removeResolvedProductMissingFields(missingFields, item);
        if (item.lineId) removeMissingField(missingFields, `selection:${item.lineId}`);
      }
      if (item.budgetAmount) removeResolvedBudgetMissingFields(missingFields, item);
      if (!item.product && item.selectionStatus === 'pending' && item.catalogCandidates?.length) {
        missingFields.push(`selection:${item.lineId}`);
      } else if (!item.product && item.selectionStatus === 'handoff') {
        missingFields.push(`product:${item.catalogQuery}`);
      } else if (!item.product) {
        missingFields.push(`product:${item.catalogQuery}`);
      }
      if (item.product && !isPositiveAmount(item.product.price)) missingFields.push(`price:${item.catalogQuery}`);
      if (!isPositiveAmount(item.quantity) && !isPositiveAmount(item.budgetAmount)) missingFields.push(`quantity:${item.catalogQuery}`);
      if (item.product && !item.available) missingFields.push(`stock:${item.catalogQuery}`);
      if (item.product && item.requestedPresentation && !productMatchesRequestedPresentation(item.product, item.requestedPresentation)) {
        missingFields.push(`presentation:${item.catalogQuery}`);
      }
    }
    const isDelivery = Boolean(plan.order?.delivery || previousDraft?.delivery);
    if (nextProfile?.name) removeMissingField(missingFields, 'customer_name');
    if (nextProfile?.defaultAddress) removeMissingField(missingFields, 'delivery_address');
    if (selectedPaymentMethod) removeMissingField(missingFields, 'payment_method');
    if (isDelivery && !selectedPaymentMethod) missingFields.push('payment_method');

    const subtotal = effectiveOrderItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
    const checkout = checkoutProgress({
      draft: { items: effectiveOrderItems, missingFields, subtotal, delivery: isDelivery, paymentMethod: selectedPaymentMethod?.id },
      previous: previousDraft?.checkout, collectionComplete: plan.order?.collectionComplete,
    });
    const requiresHumanResolution = needsHumanProductResolution(missingFields);
    const reply = requiresHumanResolution
      ? buildHumanResolutionReply({ orderItems: effectiveOrderItems, missingFields, customerProfile: nextProfile })
      : buildOrderReply({
        orderItems: effectiveOrderItems,
        missingFields,
        customerProfile: nextProfile,
        subtotal,
        paymentMethods,
        paymentMethod: selectedPaymentMethod?.id ?? null,
        checkout,
      });
    const canQuote = checkout.phase === 'confirmation';
    const checkoutOffer = !requiresHumanResolution
      ? await this.createCheckoutOffer({ tenantId, conversationId, paymentMethods, checkout })
      : null;
    const catalogSelectionOffer = !requiresHumanResolution
      ? await this.createCatalogSelectionOffer({ tenantId, conversationId, checkout, items: effectiveOrderItems })
      : null;
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: reply,
      facts: {
        kind: canQuote ? 'order_quote' : 'order_clarification',
        checkoutPhase: checkout.phase,
        products: effectiveOrderItems.map((item) => item.product ?? item),
        subtotal,
        requiredTerms: selectedPaymentMethod?.label ? [selectedPaymentMethod.label] : [],
      },
    });
    const interactiveOffer = catalogSelectionOffer ?? checkoutOffer;
    const checkoutInteractive = interactiveOffer?.interactive
      ? { ...interactiveOffer.interactive, body: customerReply }
      : undefined;

    await this.patchConversation(conversationId, {
      stage: requiresHumanResolution ? 'handoff' : canQuote ? 'quote' : 'clarification',
      zone: requiresHumanResolution ? 'approval' : canQuote ? 'quote' : 'agent',
      status: requiresHumanResolution ? 'blocked' : 'live',
      value: subtotal > 0 ? formatCurrency(subtotal) : 'Pendiente',
      progress: requiresHumanResolution ? 58 : canQuote ? 64 : 42,
      need: normalized.text,
      nextStep: requiresHumanResolution ? 'Humano valida disponibilidad, sustituto o decision comercial.' : canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: collected.name || collected.defaultAddress
        ? 'google_sheets_customer_profile_upsert'
        : drive.status === 'not_applicable' ? 'google_sheets_read_table' : 'google_drive_file_picker',
      customerCapture: {
        nameSource: collected.nameSource,
        addressSource: collected.defaultAddressSource,
        capturedAt: collected.name || collected.defaultAddress ? new Date().toISOString() : null,
      },
      orderDraft: {
        delivery: isDelivery,
        items: effectiveOrderItems,
        missingFields: [...new Set(missingFields)],
        subtotal,
        paymentMethod: selectedPaymentMethod?.id ?? null,
        paymentMethodLabel: selectedPaymentMethod?.label ?? null,
        driveRefs: drive.source_refs ?? [],
        driveStatus: drive.status,
        catalogResolution: resolution.status,
        checkout,
      },
    });

    if (requiresHumanResolution) {
      await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: 'Validar producto no encontrado, no inferible o sin stock',
        urgency: 'Alta',
        assigned_team: 'ventas',
        context_snapshot: {
          summary: buildHumanResolutionSummary({ orderItems: effectiveOrderItems, missingFields, customerProfile: nextProfile, text: normalized.text }),
          orderItems: effectiveOrderItems,
          missingFields: [...new Set(missingFields)],
          customerProfile: nextProfile,
          driveStatus: drive.status,
          driveRefs: drive.source_refs ?? [],
          plan,
        },
      });
    }

    if (!nextProfile && canQuote && normalized.profileName) {
      nextProfile = await this.upsertCapturedCustomerProfile({
        tenantId,
        conversationId,
        normalized,
        customerProfile,
        customerDetails: { name: normalized.profileName, defaultAddress: null },
        delivery: isDelivery,
      });
    }

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: customerReply,
      interactive: checkoutInteractive,
    });

    return { summary: requiresHumanResolution ? 'Structured order escalated to human' : canQuote ? 'Structured order quote sent' : 'Structured order needs clarification', plan };
  }

  async upsertCapturedCustomerProfile({ tenantId, conversationId, normalized, customerProfile, customerDetails, delivery }) {
    if (!customerDetails.name && !customerDetails.defaultAddress) return customerProfile;
    const defaultAddress = customerDetails.defaultAddress ?? customerProfile?.defaultAddress ?? null;
    const addresses = customerDetails.defaultAddress
      ? [
        { label: 'principal', address: customerDetails.defaultAddress },
        ...(customerProfile?.addresses ?? []).filter((item) => normalizeText(item?.address) !== normalizeText(customerDetails.defaultAddress)),
      ]
      : undefined;
    const saved = await this.tools.call('google_sheets_customer_profile_upsert', tenantId, conversationId, {
      wa_id: normalized.waId,
      name: customerDetails.name ?? customerProfile?.name ?? normalized.profileName ?? normalized.waId,
      defaultAddress,
      addresses,
      preferences: { channel: 'whatsapp', deliveryDefault: delivery },
    });
    return saved.profile;
  }

  async handleOrderConfirmation({ tenantId, conversationId, normalized, plan, customerProfile }) {
    const existing = await this.getConversation(conversationId);
    const commerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, plan,
      items: existing?.orderDraft?.items?.length ? existing.orderDraft.items : plan.order?.items ?? [] });
    if (commerceResult) return commerceResult;
    if (existing?.commercePolicy?.awaitingContinuation) return this.continueAllowedOrder({ tenantId, conversationId, normalized, customerProfile });
    await this.usage?.assertCanRecordDelivery(tenantId, { conversationId });
    const tenant = await this.getTenant(tenantId);
    const paymentMethods = paymentMethodsForTenant(tenant);
    // A confirmation message is intentionally terse. Its LLM plan can omit
    // resolved catalog data, so the persisted quote is the authoritative
    // source for the items, amounts and product names being confirmed.
    const conversation = await this.getConversation(conversationId);
    const orderDraft = structuredClone(
      conversation?.orderDraft?.items?.length ? conversation.orderDraft : plan.order ?? {},
    );
    // Old/sparse drafts may have lost their catalog snapshot. Requote before
    // accepting confirmation; never turn a missing amount into a free order.
    const quotedTotal = (orderDraft.items ?? []).reduce((sum, item) => sum + (quotedLineTotal(item) ?? 0), 0);
    if (!orderDraft.items?.length || orderDraft.items.some((item) => quotedLineTotal(item) === null)
      || Number(orderDraft.subtotal) !== quotedTotal) {
      return this.handleDeliveryOrder({ tenantId, conversationId, normalized, customerProfile,
        plan: { ...plan, intent: 'delivery_order', order: orderDraft, missingFields: orderDraft.missingFields ?? [] },
      });
    }
    const selectedPaymentMethod = resolvePaymentMethod(orderDraft.paymentMethod, paymentMethods)
      ?? resolvePaymentMethod(normalized.text, paymentMethods);
    const checkout = checkoutProgress({ draft: { ...orderDraft, paymentMethod: selectedPaymentMethod?.id }, previous: orderDraft.checkout });
    if (checkout.phase !== 'confirmation') {
      return this.handleOrderClarification({
        preserveProductAmbiguity: true,
        tenantId,
        conversationId,
        normalized,
        customerProfile,
        plan: {
          ...plan,
          intent: 'order_clarification',
          order: {
            ...orderDraft,
            collectionComplete: true,
            missingFields: [...new Set([...(orderDraft.missingFields ?? []), ...(orderDraft.delivery && !selectedPaymentMethod ? ['payment_method'] : [])])],
          },
        },
      });
    }
    orderDraft.paymentMethod = selectedPaymentMethod?.id ?? null;
    const paymentLabel = selectedPaymentMethod?.label ?? null;
    const order = await this.tools.call('google_sheets_order_write', tenantId, conversationId, {
      wa_id: normalized.waId,
      customer_name: customerProfile?.name ?? normalized.profileName ?? normalized.waId,
      delivery_address: customerProfile?.defaultAddress,
      items: (orderDraft.items ?? []).map((item) => ({
        sku: item.product?.sku ?? item.skuHint,
        name: item.product?.name ?? item.catalogQuery,
        quantity: item.quantity,
        unitPrice: item.product?.price ?? null,
        lineTotal: item.lineTotal ?? null,
      })),
      subtotal: orderDraft.subtotal,
      payment_method: orderDraft.paymentMethod,
      payment_method_label: paymentLabel,
      status: 'pending_human_preparation',
    });

    // Use the saved commercial facts for every consumer of the confirmation.
    const confirmedItems = order.order.items;
    const confirmedSubtotal = order.order.subtotal;
    const deliveryAddress = order.order.deliveryAddress ?? 'Dirección pendiente por confirmar';
    await this.tools.call('human_handoff', tenantId, conversationId, {
      reason: 'Alistar domicilio confirmado',
      urgency: 'Alta',
      assigned_team: 'operaciones',
      context_snapshot: {
        summary: 'Pedido confirmado por WhatsApp; requiere preparacion y entrega humana.',
        orderId: order.order.id,
        subtotal: confirmedSubtotal,
        action: 'prepare_delivery_order',
        customerName: customerProfile?.name ?? normalized.profileName ?? normalized.waId,
        customerWaId: normalized.waId,
        deliveryAddress,
        items: confirmedItems,
        paymentMethod: orderDraft.paymentMethod,
        paymentMethodLabel: paymentLabel,
      },
    });

    await this.patchConversation(conversationId, {
      stage: 'handoff',
      zone: 'approval',
      status: 'blocked',
      value: formatCurrency(confirmedSubtotal),
      progress: 82,
      nextStep: 'Humano prepara el pedido y coordina entrega.',
      lastTool: 'google_sheets_order_write',
      orderId: order.order.id,
    });

    const confirmationFallback = `Pedido confirmado y registrado: ${formatOrderItems(confirmedItems)}. Subtotal de productos: ${formatCurrency(confirmedSubtotal)}.${paymentLabel ? ` Pago: ${paymentLabel}.` : ''} Dirección: ${deliveryAddress}. La tienda lo alista y coordina la entrega. Referencia: ${order.order.id}.`;
    const confirmationReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: confirmationFallback,
      facts: {
        kind: 'order_confirmed',
        products: confirmedItems,
        subtotal: confirmedSubtotal,
        requiredTerms: [paymentLabel, deliveryAddress, order.order.id].filter(Boolean),
      },
    });
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: confirmationReply,
    });
    this.usage?.recordConfirmedDelivery(tenantId, {
      conversationId,
      orderId: order.order.id,
      subtotal: confirmedSubtotal,
      itemCount: orderDraft.items?.length ?? 0,
    });

    return { summary: 'Confirmed order registered and handed off', plan };
  }

  async handleOrderClarification({ tenantId, conversationId, normalized, plan, customerProfile, preserveProductAmbiguity = false, preserveExistingCatalogSelections = false }) {
    const conversation = await this.getConversation(conversationId);
    const draft = restoreClarificationDraft(conversation?.orderDraft, plan.order);
    const commerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, plan, items: draft.items });
    if (commerceResult) return commerceResult;
    const paymentMethods = paymentMethodsForTenant(await this.getTenant(tenantId));
    const collected = collectCustomerDetails({ plan, text: normalized.text, paymentMethods });
    const plannedPaymentMethod = resolvePaymentMethod(draft.paymentMethod, paymentMethods);
    if (plannedPaymentMethod) draft.paymentMethod = plannedPaymentMethod.id;
    let nextProfile = await this.upsertCapturedCustomerProfile({
      tenantId,
      conversationId,
      normalized,
      customerProfile,
      customerDetails: collected,
      delivery: Boolean(draft.delivery),
    });
    if (collected.paymentMethod) {
      draft.paymentMethod = collected.paymentMethod;
    }

    for (const item of draft.items ?? []) {
      if (!item.quantity && collected.quantity) {
        item.quantity = collected.quantity;
        item.lineTotal = item.product ? item.product.price * item.quantity : null;
        item.available = Boolean(item.product && item.product.stock >= item.quantity);
      }
    }
    if (collected.removeProductQuery) {
      draft.items = (draft.items ?? []).filter((item) => !matchesRemovalQuery(item, collected.removeProductQuery));
    }

    // New/replaced products must pass through the catalog resolver. Existing
    // products keep their verified price even when the LLM returns only SKUs.
    if (!preserveExistingCatalogSelections && draft.items.some((item) => !item.product || !isPositiveAmount(item.product.price)
      || (item.requestedPresentation && !productMatchesRequestedPresentation(item.product, item.requestedPresentation)))) {
      return this.handleDeliveryOrder({ tenantId, conversationId, normalized, customerProfile: nextProfile, replaceDraft: true,
        plan: { ...plan, order: draft, missingFields: draft.missingFields ?? [] },
      });
    }
    for (const item of draft.items) {
      item.lineTotal = quotedLineTotal(item);
      item.available = Boolean(item.product && item.product.stock >= (item.quantity ?? 1));
    }

    const missingFields = (draft.missingFields ?? []).filter((field) => {
      if (field === 'customer_name') return !(nextProfile?.name || collected.name);
      if (field === 'delivery_address') return !(nextProfile?.defaultAddress || collected.defaultAddress);
      if (field === 'payment_method') return !draft.paymentMethod;
      if (field.startsWith('quantity:')) {
        const query = field.replace('quantity:', '');
        const item = (draft.items ?? []).find((candidate) => candidate.catalogQuery === query);
        return !item?.quantity;
      }
      if (field.startsWith('presentation:')) {
        return preserveProductAmbiguity || !confirmsPresentation(normalized.text, field.replace('presentation:', ''));
      }
      return true;
    });
    draft.missingFields = [...new Set(missingFields)];
    for (const item of draft.items ?? []) {
      if (item.product) {
        // A selection callback can arrive after the previous turn stored
        // quantity/stock/selection gaps for the same line. Reconcile those
        // stale gaps before building the next offer; otherwise the selected
        // product is displayed as still unresolved and the conversation loops.
        removeResolvedProductMissingFields(draft.missingFields, item);
        removeResolvedBudgetMissingFields(draft.missingFields, item);
        removeResolvedStockMissingFields(draft.missingFields, item);
        if (item.lineId) removeMissingField(draft.missingFields, `selection:${item.lineId}`);
      }
    }
    if (!draft.items.length) draft.missingFields.push('order_items');
    for (const item of draft.items) {
      if (item.lineTotal === null) draft.missingFields.push(`quantity:${item.catalogQuery}`);
      if (!item.available) draft.missingFields.push(`stock:${item.catalogQuery}`);
    }
    if (needsHumanProductResolution(draft.missingFields) && !preserveExistingCatalogSelections) {
      return this.handleDeliveryOrder({ tenantId, conversationId, normalized, customerProfile: nextProfile, replaceDraft: true,
        plan: { ...plan, order: draft, missingFields: draft.missingFields },
      });
    }
    draft.subtotal = (draft.items ?? []).reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
    if (draft.delivery && !draft.paymentMethod && !draft.missingFields.includes('payment_method')) draft.missingFields.push('payment_method');
    draft.checkout = checkoutProgress({ draft, previous: conversation?.orderDraft?.checkout, collectionComplete: plan.order?.collectionComplete });
    delete draft.collectionComplete; // A semantic signal belongs only to this turn, not future additions.

    const canQuote = draft.checkout.phase === 'confirmation';
    const reply = buildOrderReply({
      orderItems: draft.items ?? [],
      missingFields: draft.missingFields,
      customerProfile: nextProfile,
      subtotal: draft.subtotal,
      paymentMethods,
      paymentMethod: draft.paymentMethod,
      checkout: draft.checkout,
    });
    const checkoutOffer = await this.createCheckoutOffer({ tenantId, conversationId, paymentMethods, checkout: draft.checkout });
    const catalogSelectionOffer = await this.createCatalogSelectionOffer({ tenantId, conversationId, checkout: draft.checkout, items: draft.items ?? [] });
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: reply,
      facts: {
        kind: canQuote ? 'order_quote' : 'order_clarification',
        checkoutPhase: draft.checkout.phase,
        products: draft.items ?? [],
        subtotal: draft.subtotal,
        requiredTerms: draft.paymentMethod ? [paymentMethodLabel(draft.paymentMethod, paymentMethods)] : [],
      },
    });
    const interactiveOffer = catalogSelectionOffer ?? checkoutOffer;
    const checkoutInteractive = interactiveOffer?.interactive
      ? { ...interactiveOffer.interactive, body: customerReply }
      : undefined;

    await this.patchConversation(conversationId, {
      stage: canQuote ? 'quote' : 'clarification',
      zone: canQuote ? 'quote' : 'agent',
      status: 'live',
      value: canQuote ? formatCurrency(draft.subtotal) : 'Pendiente',
      progress: canQuote ? 64 : 48,
      nextStep: canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: collected.name || collected.defaultAddress ? 'google_sheets_customer_profile_upsert' : 'llm_core',
      customerCapture: {
        nameSource: collected.nameSource,
        addressSource: collected.defaultAddressSource,
        capturedAt: collected.name || collected.defaultAddress ? new Date().toISOString() : null,
      },
      orderDraft: draft,
    });

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: customerReply,
      interactive: checkoutInteractive,
    });

    return { summary: canQuote ? 'Order clarified and quote sent' : 'Order still needs clarification', plan };
  }

  async resolveHumanRequest(requestId, { outcome, note, approverId = 'local-admin', responseMode = 'none' }) {
    const normalizedNote = String(note ?? '').trim();
    const normalizedMode = ['platform', 'whatsapp'].includes(responseMode) ? responseMode : 'none';
    const shouldReplyToCustomer = Boolean(normalizedNote && normalizedMode !== 'none');
    const currentState = this.store.getState();
    const currentRequest = currentState.pendingRequests.find((item) => item.id === requestId);
    if (currentRequest?.status !== 'pending') {
      const error = new Error('Esta tarea ya fue atendida. Actualiza la pantalla para ver el estado actual.');
      error.statusCode = currentRequest ? 409 : 404;
      throw error;
    }
    const currentConversation = currentRequest
      ? currentState.conversations.find((item) => item.id === currentRequest.conversationId)
      : null;
    const currentReplyWaId = currentRequest ? resolveHumanReplyWaId(currentState, currentRequest, currentConversation) : null;
    if (shouldReplyToCustomer && normalizedMode === 'whatsapp' && !currentReplyWaId) {
      const error = new Error('WhatsApp response requires a conversation with waId');
      error.statusCode = 428;
      error.code = 'human_reply_missing_wa_id';
      throw error;
    }
    let request;
    let conversationSnapshot;
    const now = new Date().toISOString();
    const isDeliveryOrder = currentRequest.action === 'prepare_delivery_order'
      || currentRequest.contextSnapshot?.action === 'prepare_delivery_order'
      || currentRequest.assignedTeam === 'operaciones'
      || /pedido|domicilio/i.test(currentRequest.title ?? '');
    const currentOrder = isDeliveryOrder
      ? findOrderForDeliveryRequest(currentState, currentRequest)
      : null;
    const orderStatus = outcome === 'approved' ? 'preparing' : 'cancelled';
    const sheetSync = currentOrder && !this.orders
      ? await this.tools.syncLiveOrderStatus({ tenantId: currentRequest.tenantId, order: currentOrder, status: orderStatus, updatedAt: now })
      : null;
    const orderTransition = currentOrder && this.orders
      ? await this.orders.transition({
        orderId: currentOrder.id,
        tenantId: currentRequest.tenantId,
        nextStatus: orderStatus,
        actorId: approverId,
        source: 'human_request',
        allowPendingRequest: true,
      })
      : null;
    this.store.mutate((state) => {
      request = state.pendingRequests.find((item) => item.id === requestId);
      if (!request) throw new Error(`Request not found: ${requestId}`);
      request.status = outcome === 'approved' ? 'resolved' : 'denied';
      request.resolvedAt = now;
      request.resolutionNote = normalizedNote;
      request.approverId = approverId;
      request.responseMode = normalizedMode;
      request.approvalToken = outcome === 'approved' ? `APPROVED-${crypto.randomUUID()}` : null;
      if (currentOrder && !this.orders) {
        const order = (state.ordersByTenant?.[request.tenantId] ?? []).find((item) => item.id === currentOrder.id);
        if (order) {
          order.status = orderStatus;
          order.updatedAt = now;
          order.statusHistory = [...(order.statusHistory ?? []), {
            status: orderStatus,
            at: now,
            actorId: approverId,
          }];
          order.sheetSyncStatus = sheetSync.status === 'synced' ? 'synced' : 'pending';
          if (sheetSync.status === 'synced') order.sheetSyncedAt = now;
        }
      }
      const conversation = state.conversations.find((item) => item.id === request.conversationId);
      if (conversation) {
        conversationSnapshot = { id: conversation.id, waId: resolveHumanReplyWaId(state, request, conversation) };
        if (!this.orders || !currentOrder || outcome !== 'approved') {
          conversation.status = outcome === 'approved' ? 'live' : 'blocked';
          conversation.zone = outcome === 'approved' ? 'agent' : 'approval';
          conversation.progress = outcome === 'approved' ? Math.max(conversation.progress ?? 0, 78) : conversation.progress;
          conversation.nextStep = outcome === 'approved'
            ? 'Flujo reanudado con aprobacion humana.'
            : 'Operacion rechazada; revisar alternativa.';
        }
        if (shouldReplyToCustomer && normalizedMode === 'platform') {
          conversation.messages.push({
            id: `human-${crypto.randomUUID()}`,
            role: 'human',
            text: normalizedNote,
            channel: 'platform',
            requestId,
            createdAt: now,
          });
          request.customerReply = {
            mode: 'platform',
            text: normalizedNote,
            savedAt: now,
            approverId,
          };
        }
        conversation.updatedAt = now;
      }
    }, { snapshot: false, domain: 'pending_requests', operation: 'resolve' });
    await this.store.persistPendingRequest?.(requestId);
    await this.store.persistConversation?.(request.conversationId);
    if (currentOrder && !orderTransition) await this.store.persistOrder?.(request.tenantId, currentOrder.id);
    let responseDelivery = null;
    if (shouldReplyToCustomer && normalizedMode === 'whatsapp') {
      responseDelivery = await this.tools.call('whatsapp_business_messaging', request.tenantId, request.conversationId, {
        action: 'send_human_message',
        wa_id: conversationSnapshot?.waId ?? currentReplyWaId,
        text: normalizedNote,
        senderRole: 'human',
        request_id: requestId,
      });
      const sentAt = new Date().toISOString();
      this.store.mutate((state) => {
        const stored = state.pendingRequests.find((item) => item.id === requestId);
        if (stored) {
          stored.customerReply = {
            mode: 'whatsapp',
            text: normalizedNote,
            sentAt,
            approverId,
            deliveryStatus: responseDelivery.delivery_status,
            providerMessageId: responseDelivery.provider_message_id,
          };
        }
      }, { snapshot: false, domain: 'pending_requests', operation: 'customer_reply' });
      await this.store.persistPendingRequest?.(requestId);
    }
    this.store.mutate((state) => {
      appendAuditEvent(state, {
        tenantId: request.tenantId,
        actorId: approverId,
        action: outcome === 'approved' ? 'approval.granted' : 'approval.denied',
        resource: 'pending_request',
        metadata: {
          requestId,
          conversationId: request.conversationId,
          note: normalizedNote,
          responseMode: normalizedMode,
        },
      });
      if (shouldReplyToCustomer) {
        appendAuditEvent(state, {
          tenantId: request.tenantId,
          actorId: approverId,
          action: normalizedMode === 'whatsapp' ? 'human_response.whatsapp_sent' : 'human_response.platform_saved',
          resource: 'pending_request',
          metadata: {
            requestId,
            conversationId: request.conversationId,
            responseMode: normalizedMode,
            providerMessageId: responseDelivery?.provider_message_id,
          },
        });
      }
    });
    this.events.emit({
      type: outcome === 'approved' ? 'approval.granted' : 'approval.denied',
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      detail: request.title,
      metadata: { requestId, approverId, responseMode: normalizedMode },
    });
    if (shouldReplyToCustomer) {
      this.events.emit({
        type: normalizedMode === 'whatsapp' ? 'human.response.whatsapp_sent' : 'human.response.platform_saved',
        tenantId: request.tenantId,
        conversationId: request.conversationId,
        detail: normalizedMode === 'whatsapp' ? 'Respuesta humana enviada por WhatsApp' : 'Respuesta humana guardada en plataforma',
        metadata: { requestId, approverId, responseMode: normalizedMode },
      });
    }
    return this.store.getState().pendingRequests.find((item) => item.id === requestId) ?? request;
  }

  async deleteConversation(conversationId, { actorId = 'local-owner' } = {}) {
    const currentState = this.store.getState();
    const conversation = currentState.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      const error = new Error('La conversación ya no existe. Actualiza la pantalla.');
      error.statusCode = 404;
      throw error;
    }

    const relatedOrders = (currentState.ordersByTenant?.[conversation.tenantId] ?? [])
      .filter((order) => order.conversationId === conversationId);
    if (relatedOrders.length) {
      const error = new Error('No se puede eliminar una conversación con pedidos registrados. Ciérrala desde el flujo de pedidos para conservar su trazabilidad.');
      error.statusCode = 409;
      throw error;
    }

    const removedRequestIds = currentState.pendingRequests
      .filter((request) => request.conversationId === conversationId)
      .map((request) => request.id);

    this.store.mutate((state) => {
      state.conversations = state.conversations.filter((item) => item.id !== conversationId);
      state.pendingRequests = state.pendingRequests.filter((request) => request.conversationId !== conversationId);
      appendAuditEvent(state, {
        tenantId: conversation.tenantId,
        actorId,
        action: 'conversation.deleted',
        resource: conversationId,
        metadata: {
          customerWaId: conversation.waId ?? null,
          removedPendingRequestIds: removedRequestIds,
          reason: 'owner_requested',
        },
      });
    });
    await this.store.deleteConversation?.(conversationId);
    this.events.emit({
      type: 'conversation.deleted',
      tenantId: conversation.tenantId,
      conversationId,
      detail: 'Conversación eliminada por el propietario.',
      metadata: { actorId, removedPendingRequestIds: removedRequestIds },
    });
    return { id: conversationId, tenantId: conversation.tenantId, removedPendingRequestIds: removedRequestIds };
  }

  async purgeTenantOperationalData(tenantId) {
    const state = this.store.getState();
    const profileCount = Object.keys(state.customerProfilesByTenant?.[tenantId] ?? {}).length;
    const removedMessageIds = new Set(
      Object.entries(state.processedMessagePayloads ?? {})
        .filter(([, payload]) => payload?.tenantId === tenantId)
        .map(([messageId]) => messageId),
    );
    const deleted = {
      conversations: (state.conversations ?? []).filter((item) => item.tenantId === tenantId).length,
      orders: (state.ordersByTenant?.[tenantId] ?? []).length,
      pendingRequests: (state.pendingRequests ?? []).filter((item) => item.tenantId === tenantId).length,
      customerProfiles: profileCount,
      transactions: (state.transactions ?? []).filter((item) => item.tenantId === tenantId).length,
      events: (state.events ?? []).filter((item) => item.tenantId === tenantId).length,
      webhookEvents: (state.webhookEvents ?? []).filter((item) => item.tenantId === tenantId).length,
      outbox: (state.integrationOutbox ?? []).filter((item) => item.tenantId === tenantId).length,
      processedMessages: removedMessageIds.size,
    };

    this.store.mutate((next) => {
      next.conversations = (next.conversations ?? []).filter((item) => item.tenantId !== tenantId);
      next.ordersByTenant ??= {};
      next.ordersByTenant[tenantId] = [];
      next.pendingRequests = (next.pendingRequests ?? []).filter((item) => item.tenantId !== tenantId);
      next.customerProfilesByTenant ??= {};
      next.customerProfilesByTenant[tenantId] = {};
      next.transactions = (next.transactions ?? []).filter((item) => item.tenantId !== tenantId);
      next.events = (next.events ?? []).filter((item) => item.tenantId !== tenantId);
      next.webhookEvents = (next.webhookEvents ?? []).filter((item) => item.tenantId !== tenantId);
      next.integrationOutbox = (next.integrationOutbox ?? []).filter((item) => item.tenantId !== tenantId);
      next.usageCountersByTenant ??= {};
      delete next.usageCountersByTenant[tenantId];
      next.usageBudgetAlertsByTenant ??= {};
      delete next.usageBudgetAlertsByTenant[tenantId];
      next.billingUsageCyclesByTenant ??= {};
      delete next.billingUsageCyclesByTenant[tenantId];
      next.processedMessages = (next.processedMessages ?? []).filter((messageId) => !removedMessageIds.has(messageId));
      for (const messageId of removedMessageIds) delete next.processedMessagePayloads?.[messageId];
    });
    if (this.store.purgeTenantOperationalData) {
      await this.store.purgeTenantOperationalData(tenantId);
    }
    return { tenantId, deleted };
  }

  async ensureConversation(tenantId, normalized) {
    normalized.waId = requireWhatsAppRecipient(normalized.waId);
    const key = `${tenantId}:${normalized.waId}`;
    const inFlight = this.conversationEnsureLocks.get(key);
    if (inFlight) return inFlight;

    const ensure = this.ensureConversationUnlocked(tenantId, normalized);
    this.conversationEnsureLocks.set(key, ensure);
    try {
      return await ensure;
    } finally {
      if (this.conversationEnsureLocks.get(key) === ensure) {
        this.conversationEnsureLocks.delete(key);
      }
    }
  }

  async ensureConversationUnlocked(tenantId, normalized) {
    const cached = this.store
      .getState()
      .conversations
      .find((item) => item.tenantId === tenantId && item.waId === normalized.waId && !isClosedConversation(item));
    if (cached) return cached;

    const existing = this.store.findConversationByWa
      ? await this.store.findConversationByWa(tenantId, normalized.waId)
      : this.store
        .getState()
        .conversations.find((item) => item.tenantId === tenantId && item.waId === normalized.waId && !isClosedConversation(item));
    if (existing) return existing;

    const previous = this.store.findLatestConversationByWa
      ? await this.store.findLatestConversationByWa(tenantId, normalized.waId)
      : this.store
        .getState()
        .conversations
        .filter((item) => item.tenantId === tenantId && item.waId === normalized.waId)
        .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.createdAt ?? 0))[0];
    if (previous && !isDispatchedConversation(previous) && isExplicitCaseContinuation(normalized.text, previous, this.config)) {
      const now = new Date().toISOString();
      this.store.mutate((state) => {
        const conversation = state.conversations.find((item) => item.id === previous.id);
        if (!conversation) return;
        Object.assign(conversation, {
          status: 'live',
          caseStatus: 'active',
          inboxState: 'active',
          manualMode: 'none',
          aiPaused: false,
          closedAt: null,
          closeReason: null,
          reopenedAt: now,
          nextStep: 'Caso anterior reanudado por solicitud explicita del cliente.',
          updatedAt: now,
        });
      }, { snapshot: false, domain: 'conversations', operation: 'reopen' });
      await this.store.persistConversation?.(previous.id);
      return this.getConversation(previous.id);
    }
    const created = {
      id: `wa-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      waId: normalized.waId,
      whatsappUserId: normalized.whatsappUserId ?? null,
      customer: normalized.profileName ?? normalized.waId,
      avatar: initials(normalized.profileName ?? normalized.waId),
      stage: 'inbound',
      zone: 'whatsapp',
      status: 'live',
      caseStatus: 'active',
      inboxState: 'active',
      manualMode: 'none',
      aiPaused: false,
      closedAt: null,
      closeReason: null,
      orderDraft: null,
      value: 'Pendiente',
      progress: 12,
      need: normalized.text ?? normalized.messageType,
      nextStep: 'Planificar siguiente accion.',
      humanReason: '',
      lastTool: 'whatsapp_business_messaging',
      path: ['whatsapp', 'agent', 'catalog', 'quote', 'approval', 'payment'],
      messages: [],
      traceId: normalized.traceId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.mutate((state) => {
      state.conversations.unshift(created);
    }, { snapshot: false, domain: 'conversations', operation: 'create' });
      await this.store.persistConversation?.(created.id);
    return created;
  }

  async addMessage(conversationId, message) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      if (message.providerMessageId && conversation.messages.some((existing) =>
        existing.providerMessageId === message.providerMessageId && existing.role === message.role)) return;
      conversation.messages.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...message });
      conversation.need = message.text ?? conversation.need;
      conversation.updatedAt = new Date().toISOString();
    }, { snapshot: false, domain: 'conversations', operation: 'append_message' });
    await this.store.persistConversation?.(conversationId);
  }

  async patchConversation(conversationId, patch) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (conversation) Object.assign(conversation, patch, { updatedAt: new Date().toISOString() });
    }, { snapshot: false, domain: 'conversations', operation: 'patch' });
    await this.store.persistConversation?.(conversationId);
  }

  async activateManualWhatsApp(conversationId, { actorId = 'local-admin' } = {}) {
    const now = new Date().toISOString();
    let conversation;
    this.store.mutate((state) => {
      conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      conversation.status = 'manual_active';
      conversation.caseStatus = 'active';
      conversation.inboxState = 'active';
      conversation.manualMode = 'whatsapp_external';
      conversation.aiPaused = true;
      conversation.manualStartedAt = conversation.manualStartedAt ?? now;
      conversation.manualLastActivityAt = now;
      conversation.nextStep = 'Atencion manual activa en WhatsApp Web/Desktop.';
      conversation.messages ??= [];
      conversation.messages.push({
        id: `manual-${crypto.randomUUID()}`,
        role: 'system',
        channel: 'platform',
        text: 'La conversacion continua de manera manual en WhatsApp Web/Desktop.',
        actorId,
        createdAt: now,
      });
      conversation.updatedAt = now;
    }, { snapshot: false, domain: 'conversations', operation: 'activate_manual' });
    if (!conversation) return null;
    await this.store.persistConversation?.(conversationId);
    return this.getConversation(conversationId);
  }

  async closeExpiredManualCases(now = Date.now()) {
    const inactivityMs = Number(this.config.manualCaseInactivityMinutes ?? 5) * 60_000;
    const hasExpiredManualCase = (conversation) => {
      if (conversation.manualMode !== 'whatsapp_external' || conversation.status !== 'manual_active') return false;
      if (conversation.orderId) return false;
      const lastActivity = Date.parse(conversation.manualLastActivityAt ?? conversation.updatedAt ?? conversation.createdAt ?? 0);
      return Number.isFinite(lastActivity) && now - lastActivity >= inactivityMs;
    };
    if (!(this.store.getState().conversations ?? []).some(hasExpiredManualCase)) return [];

    const expired = [];
    this.store.mutate((state) => {
      for (const conversation of state.conversations) {
        if (!hasExpiredManualCase(conversation)) continue;
        const closedAt = new Date(now).toISOString();
        conversation.status = 'closed_no_confirmation';
        conversation.caseStatus = 'closed_no_confirmation';
        conversation.inboxState = 'history';
        conversation.manualMode = 'none';
        conversation.aiPaused = false;
        conversation.closedAt = closedAt;
        conversation.closeReason = 'manual_inactivity';
        conversation.orderStatus = 'not_confirmed';
        if (conversation.orderDraft) conversation.orderDraft.status = 'not_confirmed';
        conversation.nextStep = 'Caso cerrado por inactividad. Un nuevo mensaje abrira un caso nuevo.';
        conversation.messages ??= [];
        conversation.messages.push({
          id: `manual-timeout-${crypto.randomUUID()}`,
          role: 'system',
          channel: 'platform',
          text: 'Atencion manual cerrada por inactividad. Pedido no confirmado.',
          createdAt: closedAt,
        });
        conversation.updatedAt = closedAt;
        expired.push(conversation.id);
      }
    }, { snapshot: false, domain: 'conversations', operation: 'close_expired_manual' });
    for (const conversationId of expired) {
      await this.store.persistConversation?.(conversationId);
      this.events.emit({
        type: 'conversation.manual_timeout',
        tenantId: (await this.getConversation(conversationId))?.tenantId,
        conversationId,
        detail: 'Atencion manual cerrada por inactividad; pedido no confirmado.',
      });
    }
    return expired;
  }

  async getConversation(conversationId) {
    if (this.store.getConversation) return this.store.getConversation(conversationId);
    return this.store.getState().conversations.find((item) => item.id === conversationId);
  }

  async createCheckoutOffer({ tenantId, conversationId, paymentMethods, checkout }) {
    if (checkout.phase === 'payment') return this.createPaymentOffer({ tenantId, conversationId, paymentMethods });
    if (checkout.phase === 'confirmation') return this.createOrderConfirmationOffer({ tenantId, conversationId, basket: checkout.basketKey });
    if (checkout.phase !== 'review' || !this.store.createInteractionOffer) return null;
    const id = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const options = [
      { id: `vi:${id}:1`, title: 'Continuar pedido', action: 'continue_checkout', value: checkout.basketKey },
      { id: `vi:${id}:2`, title: 'Agregar productos', action: 'adjust_order' },
      { id: `vi:${id}:3`, title: 'Hablar con la tienda', action: 'human_handoff' },
    ];
    const offer = await this.store.createInteractionOffer({ id, tenantId, conversationId, purpose: 'cart_review', options,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
    return { offer, interactive: { kind: 'button', body: '¿Quieres agregar algo más o continuar con este pedido?', buttons: options.map(({ id, title }) => ({ id, title })) } };
  }

  async createPaymentOffer({ tenantId, conversationId, paymentMethods }) {
    if (!this.store.createInteractionOffer || !paymentMethods.length) return null;
    const offerId = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const options = paymentMethods.map((method, index) => ({
      id: `vi:${offerId}:${index + 1}`,
      title: method.label,
      action: 'set_payment_method',
      value: method.id,
    }));
    const offer = await this.store.createInteractionOffer({
      id: offerId,
      tenantId,
      conversationId,
      purpose: 'payment_method',
      options,
      expiresAt,
    });
    return {
      offer,
      interactive: options.length <= 3
        ? { kind: 'button', body: '¿Cómo prefieres pagar?', buttons: options.map(({ id, title }) => ({ id, title })) }
        : {
          kind: 'list',
          body: '¿Cómo prefieres pagar?',
          buttonLabel: 'Elegir pago',
          sectionTitle: 'Formas de pago',
          rows: options.map(({ id, title }) => ({ id, title })),
        },
    };
  }

  async createCatalogSelectionOffer({ tenantId, conversationId, checkout, items }) {
    if (!this.store.createInteractionOffer || checkout?.phase !== 'collecting') return null;
    const item = (items ?? []).find((candidate) => (
      candidate.selectionStatus === 'pending' && (candidate.catalogCandidates?.length ?? 0) > 0
    ));
    if (!item) return null;
    const candidates = item.catalogCandidates.slice(0, 3);
    const offerId = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const options = candidates.map((candidate, index) => ({
      id: `vi:${offerId}:${index + 1}`,
      title: shortProductOptionTitle(candidate),
      action: 'select_catalog_product',
      value: JSON.stringify({ basketKey: checkout.basketKey, lineId: item.lineId, sku: candidate.sku }),
    }));
    const offer = await this.store.createInteractionOffer({
      id: offerId,
      tenantId,
      conversationId,
      purpose: 'catalog_selection',
      options,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    return {
      offer,
      interactive: options.length <= 3
        ? { kind: 'button', body: item.selectionQuestion ?? '¿Cuál de estas opciones prefieres?', buttons: options.map(({ id, title }) => ({ id, title })) }
        : null,
    };
  }

  async createOrderConfirmationOffer({ tenantId, conversationId, basket }) {
    if (!this.store.createInteractionOffer) return null;
    const offerId = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const options = [
      { id: `vi:${offerId}:1`, title: 'Confirmar pedido', action: 'confirm_order', value: basket ?? basketKey((await this.getConversation(conversationId))?.orderDraft) },
      { id: `vi:${offerId}:2`, title: 'Ajustar pedido', action: 'adjust_order' },
      { id: `vi:${offerId}:3`, title: 'Hablar con la tienda', action: 'human_handoff' },
    ];
    const offer = await this.store.createInteractionOffer({
      id: offerId,
      tenantId,
      conversationId,
      purpose: 'order_confirmation',
      options,
      expiresAt,
    });
    return {
      offer,
      interactive: {
        kind: 'button',
        body: '¿Confirmas el pedido?',
        buttons: options.map(({ id, title }) => ({ id, title })),
      },
    };
  }

  async handleInteractiveReply({ tenantId, conversationId, normalized }) {
    const optionId = normalized.interactive?.optionId;
    const offerId = String(optionId ?? '').match(/^vi:(io-[a-z0-9]+):\d+$/i)?.[1];
    if (!offerId || !this.store.consumeInteractionOffer) {
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized, reason: 'No reconocí esa opción. Escríbeme cómo quieres continuar.' });
    }
    const result = await this.store.consumeInteractionOffer({ offerId, optionId, tenantId, conversationId });
    if (result.status !== 'consumed') {
      return this.replyToInvalidInteraction({
        tenantId,
        conversationId,
        normalized,
        reason: result.status === 'expired'
          ? 'Esa opción ya venció. Escríbeme la forma de pago que prefieres y seguimos.'
          : 'Esa opción ya fue usada o no corresponde a este pedido. Escríbeme cómo quieres continuar.',
      });
    }
    if (result.option?.action === 'cancel_request') return this.cancelConversation({ tenantId, conversationId, normalized });
    if (result.option?.action === 'continue_allowed_order') return this.continueAllowedOrder({ tenantId, conversationId, normalized });
    const current = await this.getConversation(conversationId);
    const commerceResult = await this.enforceCommercePolicy({ tenantId, conversationId, normalized, items: current?.orderDraft?.items ?? [] });
    if (commerceResult) return commerceResult;
    if (current?.commercePolicy?.awaitingContinuation) return this.replyToInvalidInteraction({ tenantId, conversationId, normalized,
      reason: 'El pedido cambió. Usa «Continuar sin ellos» para revisar únicamente los productos permitidos.' });
    if (result.option?.action === 'select_catalog_product') {
      const selection = parseCatalogSelectionValue(result.option.value);
      const currentBasket = basketKey(current?.orderDraft);
      const selectedItem = current?.orderDraft?.items?.find((item) => item.lineId === selection?.lineId);
      const selectedProduct = selectedItem?.catalogCandidates?.find((candidate) => String(candidate.sku) === String(selection?.sku));
      if (!selection || selection.basketKey !== currentBasket || !selectedItem || !selectedProduct) {
        return this.replyToInvalidInteraction({ tenantId, conversationId, normalized,
          reason: 'El catálogo cambió desde esas opciones. Te muestro nuevamente las alternativas disponibles.' });
      }
      const updatedDraft = {
        ...current.orderDraft,
        items: current.orderDraft.items.map((item) => item.lineId === selection.lineId
          ? { ...item, product: selectedProduct, selectionStatus: 'selected', selectionQuestion: null, lineTotal: quotedLineTotal({ ...item, product: selectedProduct }), available: selectedProduct.stock >= (item.quantity ?? 1) }
          : item),
      };
      const lookup = await this.tools.call('google_sheets_customer_profile_lookup', tenantId, conversationId, {
        wa_id: normalized.waId, profile_name: normalized.profileName,
      });
      return this.handleOrderClarification({ tenantId, conversationId, normalized, customerProfile: lookup.profile,
        preserveExistingCatalogSelections: true,
        plan: { intent: 'order_clarification', order: updatedDraft, missingFields: updatedDraft.missingFields ?? [] } });
    }
    if (['continue_checkout', 'confirm_order'].includes(result.option?.action)
      && result.option.value !== basketKey(current?.orderDraft)) {
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized,
        reason: 'El pedido cambió desde ese resumen. Revisa el último total y usa sus opciones para continuar.' });
    }
    if (result.option?.action === 'continue_checkout') {
      const lookup = await this.tools.call('google_sheets_customer_profile_lookup', tenantId, conversationId, {
        wa_id: normalized.waId, profile_name: normalized.profileName,
      });
      return this.handleOrderClarification({ tenantId, conversationId, normalized, customerProfile: lookup.profile,
        plan: { intent: 'order_clarification', order: { collectionComplete: true } } });
    }
    if (result.option?.action === 'confirm_order') {
      return this.confirmOrderFromInteraction({ tenantId, conversationId, normalized, option: result.option });
    }
    if (result.option?.action === 'adjust_order') {
      return this.requestOrderAdjustment({ tenantId, conversationId, normalized, option: result.option });
    }
    if (result.option?.action === 'human_handoff') {
      return this.requestStoreHandoff({ tenantId, conversationId, normalized, option: result.option });
    }
    if (result.option?.action !== 'set_payment_method') {
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized, reason: 'Recibí tu selección. Escríbeme si quieres ajustar algo más.' });
    }
    const methods = paymentMethodsForTenant(await this.getTenant(tenantId));
    if (!methods.some(method => method.id === result.option.value)) return this.replyToInvalidInteraction({ tenantId, conversationId, normalized,
      reason: 'La tienda actualizó sus medios de pago. Escríbeme cómo quieres continuar.' });
    const lookup = await this.tools.call('google_sheets_customer_profile_lookup', tenantId, conversationId, {
      wa_id: normalized.waId, profile_name: normalized.profileName,
    });
    await this.handleOrderClarification({ tenantId, conversationId, normalized, customerProfile: lookup.profile,
      plan: { intent: 'order_clarification', order: { paymentMethod: result.option.value } } });
    return { summary: 'Interactive payment method recorded', interaction: result.option };
  }

  async confirmOrderFromInteraction({ tenantId, conversationId, normalized, option }) {
    const customerLookup = await this.tools.call('google_sheets_customer_profile_lookup', tenantId, conversationId, {
      wa_id: normalized.waId,
      profile_name: normalized.profileName,
    });
    const customerProfile = customerLookup.profile;
    if (customerProfile?.name) {
      await this.patchConversation(conversationId, { customer: customerProfile.name, avatar: initials(customerProfile.name) });
    }
    const conversation = await this.getConversation(conversationId);
    const plan = {
      intent: 'order_confirmation',
      order: structuredClone(conversation?.orderDraft ?? {}),
      executionMode: 'interactive',
      provider: 'whatsapp',
      model: null,
    };
    const result = await this.handleOrderConfirmation({ tenantId, conversationId, normalized, plan, customerProfile });
    return { ...result, interaction: option };
  }

  async requestOrderAdjustment({ tenantId, conversationId, normalized, option }) {
    const current = await this.getConversation(conversationId);
    await this.patchConversation(conversationId, {
      orderDraft: { ...current?.orderDraft, checkout: { phase: 'review', reviewedKey: null } },
      stage: 'clarification',
      zone: 'agent',
      status: 'live',
      progress: 56,
      nextStep: 'Esperar el ajuste solicitado por el cliente.',
      lastTool: 'whatsapp_business_messaging',
    });
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: 'Claro. Dime qué quieres ajustar del pedido y actualizo el total antes de confirmarlo.',
    });
    return { summary: 'Order adjustment requested', interaction: option };
  }

  async requestStoreHandoff({ tenantId, conversationId, normalized, option }) {
    const conversation = await this.getConversation(conversationId);
    const handoff = await this.tools.call('human_handoff', tenantId, conversationId, {
      reason: 'Cliente solicita hablar con la tienda antes de confirmar el pedido',
      urgency: 'Alta',
      assigned_team: 'ventas',
      context_snapshot: {
        summary: 'El cliente eligió hablar con la tienda desde la confirmación del pedido.',
        action: 'resolve_handoff',
        customerWaId: normalized.waId,
        orderDraft: conversation?.orderDraft ?? null,
      },
    });
    if (!handoff.reused) {
      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: 'Listo, ya le avisé a la tienda. Te atenderán por este mismo chat antes de confirmar el pedido.',
      });
    }
    return { summary: handoff.reused ? 'Store handoff already pending' : 'Store handoff requested', interaction: option };
  }

  async replyToInvalidInteraction({ tenantId, conversationId, normalized, reason }) {
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: reason,
    });
    return { summary: 'Interactive selection rejected safely' };
  }

  async composeCustomerReply({ tenantId, conversationId, fallbackText, facts }) {
    if (!this.planner?.composeReply) return fallbackText;
    const composed = await this.planner.composeReply({ tenantId, conversationId, facts, fallbackText });
    return composed.text ?? fallbackText;
  }

  async getTenant(tenantId) {
    if (this.store.getTenant) return this.store.getTenant(tenantId);
    return this.store.getState().tenants.find((item) => item.id === tenantId);
  }

  async isDuplicate(messageId) {
    if (!messageId) return false;
    if (this.store.isMessageProcessed) return this.store.isMessageProcessed(messageId);
    return this.store.getState().processedMessages.includes(messageId);
  }

  async markProcessed(messageId, payload = {}) {
    if (!messageId) return;
    this.store.mutate((state) => {
      state.processedMessages.unshift(messageId);
      state.processedMessages = [...new Set(state.processedMessages)].slice(0, 1000);
    }, { snapshot: false, domain: 'processed_messages', operation: 'mark_processed' });
    await this.store.persistProcessedMessage?.(messageId, payload);
  }

  async claimProcessed(messageId, payload = {}) {
    if (!messageId) return true;
    if (this.store.claimProcessedMessage) return this.store.claimProcessedMessage(messageId, payload);
    if (this.store.getState().processedMessages.includes(messageId)) return false;
    await this.markProcessed(messageId, payload);
    return true;
  }
}

function suppressImplicitProductHandoff(plan, conversation) {
  if (!plan || plan.intent !== 'human_handoff') return plan;
  if (plan.executionMode === 'provider_unavailable_handoff') return plan;
  if (plan.explicitHumanRequest === true || plan.handoffRequested === true) return plan;
  const hasProductContext = Boolean(
    plan.productRequestDetected === true
      || plan.order?.delivery
      || plan.order?.items?.length
      || plan.candidateItems?.length
      || conversation?.orderDraft?.items?.length,
  );
  if (!hasProductContext) return plan;
  const nextIntent = plan.order?.delivery || plan.order?.items?.length
    ? 'delivery_order'
    : 'catalog_query';
  return {
    ...plan,
    intent: nextIntent,
    responseStrategy: 'ask_clarification',
    explicitHumanRequest: false,
    handoffRequested: false,
    handoffSuppressed: true,
    recommendedTools: [...new Set([
      ...(plan.recommendedTools ?? []),
      'google_sheets_read_table',
      'whatsapp_business_messaging',
    ])].filter((tool) => tool !== 'human_handoff'),
  };
}

function isCancellationRequest(text) {
  const normalized = normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return [
    'cancelar',
    'cancela',
    'cancelalo',
    'cancelalo por favor',
    'ya no quiero',
    'no lo quiero',
    'anula el pedido',
    'anular pedido',
    'cancelar pedido',
  ].some((phrase) => normalized === normalizeText(phrase) || normalized.startsWith(`${normalizeText(phrase)} `));
}

function isExplicitCaseContinuation(text, previous, config = {}) {
  if (!isClosedConversation(previous)) return false;
  const windowMs = Number(config.caseContinuationWindowMinutes ?? 30) * 60_000;
  const lastActivity = Date.parse(previous.closedAt ?? previous.updatedAt ?? previous.createdAt ?? 0);
  if (!Number.isFinite(lastActivity) || Date.now() - lastActivity > windowMs) return false;
  const normalized = normalizeText(text);
  return containsAny(normalized, [
    'pedido anterior',
    'pedido de antes',
    'lo de antes',
    'el mismo pedido',
    'continuar el pedido',
    'continua el pedido',
    'retomar el pedido',
    'retoma el pedido',
    'sumale',
    'agregale',
    'agregale al pedido',
  ]);
}

function containsAny(text, words) {
  const normalized = normalizeText(text);
  return words.some((word) => normalized.includes(normalizeText(word)));
}

export function catalogSearchesFromPlan(plan, catalogItems, text) {
  const plannedSearches = (plan.toolPlan ?? [])
    .filter((step) => step.tool === 'google_sheets_read_table')
    .map((step, index) => {
      const item = {
        ...(plan.candidateItems?.[step.candidateIndex ?? index] ?? {}),
        ...(catalogItems[step.candidateIndex ?? index] ?? {}),
      };
      const itemQuery = catalogQueryWithPresentation(
        item.catalogQuery ?? item.rawName,
        item.requestedPresentation ?? item.presentationHint,
      );
      const stepQuery = step.query && step.query !== step.filters?.query ? step.query : null;
      const concreteItem = Boolean(itemQuery && (
        item.requestedPresentation
        || item.presentationHint
        || item.requestedAttributes
        || item.catalogQuery
      ));
      const query = concreteItem
        ? (stepQuery ?? itemQuery)
        : (stepQuery ?? (step.filters?.sku || step.filters?.category
          ? ''
          : step.candidate ?? step.filters?.category ?? text));
      const plannedFilters = step.filters && typeof step.filters === 'object' ? { ...step.filters } : {};
      const recommendation = step.recommendation === true
        || item.recommendation === true
        || item.recommendationIntent === 'recommendation';
      const inferredCandidateCategory = plannedFilters.category
        ?? item.category
        ?? inferCatalogFilter(item.catalogQuery ?? item.rawName ?? '').category
        ?? null;
      const explicitSku = item.explicitSku === true
        || item.skuHintSource === 'explicit'
        || (item.skuHint && normalizeText(text).includes(normalizeText(item.skuHint)));
      // Only an identifier explicitly supplied by the customer is an exact
      // predicate. Everything inferred by the LLM is retrieval evidence: it
      // ranks candidates but cannot erase related products before the graph
      // and semantic retrieval layers inspect them.
      const filters = explicitSku && (item.skuHint ?? plannedFilters.sku)
        ? { sku: item.skuHint ?? plannedFilters.sku }
        : {};
      const retrievalHints = mergeRetrievalHints(
        plannedFilters,
        step.retrievalHints,
        item.retrievalHints,
        { category: inferredCandidateCategory },
        retrievalHintsForCatalogItem(item),
      );
      const semanticQuery = step.semanticQuery ?? item.semanticQuery ?? item.recommendationNeed ?? null;
      return {
        query,
        ...(semanticQuery ? { semanticQuery } : {}),
        ...(recommendation ? { recommendation: true } : {}),
        filters,
        ...(Object.keys(retrievalHints).length ? { retrievalHints } : {}),
        categoryQuery: Boolean(recommendation),
        candidateIndex: step.candidateIndex ?? index,
      };
    })
    .filter((step) => Boolean(step.query || Object.keys(step.filters).length));
  if (plannedSearches.length) return plannedSearches;
  const fallbackItems = catalogItems.length ? catalogItems : [{ catalogQuery: text, rawName: text }];
  return fallbackItems.map((item, index) => {
    const query = catalogQueryWithPresentation(
      item.catalogQuery ?? item.rawName ?? text,
      item.requestedPresentation ?? item.presentationHint,
    );
    const explicitSku = item.explicitSku === true || item.skuHintSource === 'explicit';
    const recommendation = item.recommendation === true || item.recommendationIntent === 'recommendation';
    const inferredFilters = inferCatalogFilter(query);
    const filters = item.skuHint && explicitSku ? { sku: item.skuHint } : {};
    const retrievalHints = mergeRetrievalHints(
      inferredFilters,
      item.retrievalHints,
      retrievalHintsForCatalogItem(item),
    );
    return {
      query,
      ...(item.semanticQuery || item.recommendationNeed ? { semanticQuery: item.semanticQuery ?? item.recommendationNeed } : {}),
      ...(recommendation ? { recommendation: true } : {}),
      filters,
      ...(Object.keys(retrievalHints).length ? { retrievalHints } : {}),
      categoryQuery: Boolean(recommendation && !item.requestedPresentation),
      candidateIndex: index,
    };
  });
}

function retrievalHintsForCatalogItem(item = {}) {
  return {
    category: item.category ?? null,
    brand: item.brand ?? null,
    family: item.familyHypothesis ?? item.productFamily ?? null,
    product: item.productHypothesis ?? null,
    presentation: item.requestedPresentation ?? item.presentationHint ?? null,
    attributes: item.requestedAttributes ?? item.inferredAttributes ?? null,
  };
}

function mergeRetrievalHints(...sources) {
  const result = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (key === 'query' || key === 'sku' || value === undefined || value === null || value === '') continue;
      if (key === 'attributes' && typeof value === 'object' && !Array.isArray(value)) {
        result.attributes = { ...(result.attributes ?? {}), ...value };
      } else if (['category', 'brand', 'family', 'product', 'presentation'].includes(key)) {
        result[key] = value;
      }
    }
  }
  return result;
}

function catalogQueryWithPresentation(base, presentation) {
  const normalizedBase = normalizeText(base);
  const normalizedPresentation = normalizeText(presentation);
  if (!normalizedBase) return presentation ?? '';
  if (!normalizedPresentation || normalizedBase.includes(normalizedPresentation)) return String(base).trim();
  return `${String(base).trim()} ${String(presentation).trim()}`.trim();
}

function deliveryItemFiltersFromPlan(plan, item, index, requestText = '') {
  // A planner SKU is only authoritative when the customer explicitly supplied
  // it. Generic aliases such as "coca" or "chocorramo" are hypotheses; using
  // them as an exact filter suppresses the alternatives the customer still has
  // to choose from.
  const planned = (plan.toolPlan ?? []).find((step) =>
    step.tool === 'google_sheets_read_table' &&
    (step.candidateIndex === index || step.candidate === item.catalogQuery || step.candidate === item.rawName)
  );
  const attributes = item.requestedAttributes ?? planned?.filters?.attributes;
  const explicitSku = item.explicitSku === true
    || item.skuHintSource === 'explicit'
    || (item.skuHint && normalizeText(requestText).includes(normalizeText(item.skuHint)));
  if (explicitSku && item.skuHint) {
    return attributes ? { sku: item.skuHint, attributes } : { sku: item.skuHint };
  }

  const requestedPresentation = item.requestedPresentation ?? item.presentationHint ?? null;
  const query = catalogQueryWithPresentation(item.catalogQuery ?? item.rawName, requestedPresentation);
  const plannedFilters = planned?.filters && typeof planned.filters === 'object'
    ? { ...planned.filters }
    : {};
  delete plannedFilters.sku;
  const filters = {
    ...plannedFilters,
    ...(query ? { query } : inferCatalogFilter(item.catalogQuery ?? item.rawName)),
  };
  return attributes ? { ...filters, attributes } : filters;
}

function isAdditiveOrderText(text) {
  const normalized = normalizeText(text);
  return containsAny(normalized, [
    'agrega',
    'agregame',
    'agrégame',
    'anade',
    'añade',
    'sumale',
    'súmale',
    'tambien',
    'también',
    'y me regalas',
    'y manda',
    'y mandame',
    'y mándame',
    'y adiciona',
  ]);
}

function mergeOrderItems(previousItems = [], nextItems = []) {
  const byKey = new Map();
  for (const item of previousItems) {
    byKey.set(orderItemKey(item), item);
  }
  for (const item of nextItems) {
    const key = orderItemKey(item);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      continue;
    }
    const quantity = Number(current.quantity ?? 0) + Number(item.quantity ?? 0);
    byKey.set(key, {
      ...current,
      ...item,
      quantity: quantity || (item.quantity ?? current.quantity),
      lineTotal: item.product && quantity ? item.product.price * quantity : item.lineTotal ?? current.lineTotal,
      available: item.product && quantity ? item.product.stock >= quantity : item.available ?? current.available,
    });
  }
  return [...byKey.values()];
}

function resolveHumanReplyWaId(state, request, conversation) {
  if (conversation?.waId) return conversation.waId;
  if (request?.contextSnapshot?.customerWaId) return request.contextSnapshot.customerWaId;
  if (request?.context_snapshot?.customerWaId) return request.context_snapshot.customerWaId;
  if (request?.customerWaId) return request.customerWaId;
  const order = (state.ordersByTenant?.[request?.tenantId] ?? []).find((item) => (
    item.conversationId === request?.conversationId || item.id === request?.contextSnapshot?.orderId || item.id === request?.context_snapshot?.orderId
  ));
  return order?.waId ?? null;
}

function findOrderForDeliveryRequest(state, request) {
  const snapshot = request?.contextSnapshot ?? request?.context_snapshot ?? {};
  const orderId = snapshot.orderId ?? snapshot.order_id;
  if (!orderId) return null;
  return (state.ordersByTenant?.[request?.tenantId] ?? []).find((order) => order.id === orderId) ?? null;
}

function orderItemKey(item) {
  return normalizeText(item.product?.sku ?? item.skuHint ?? item.catalogQuery ?? item.rawName);
}

function inferCatalogFilter(text) {
  const normalized = normalizeText(text);
  if (normalized.includes('chocoramo') || normalized.includes('chocorramo')) return { query: 'chocoramo' };
  if (normalized.includes('cifrut') || normalized.includes('granadilla')) return { query: 'cifrut granadilla' };
  if (normalized.includes('gaseosa') || normalized.includes('coca')) return { query: 'gaseosa' };
  if (normalized.includes('savital')) return { query: 'savital' };
  if (normalized === 'queso' || normalized.includes('queso campesino')) return { query: 'queso' };
  if (normalized === 'pan' || normalized.includes('pan tajado')) return { query: 'pan' };
  if (normalized === 'jamon' || normalized.includes('jamon')) return { query: 'jamon' };
  if (containsAny(normalized, ['salchichon'])) return { query: 'salchichon carnes frias' };
  if (containsAny(normalized, ['salchicha'])) return { query: 'salchicha carnes frias' };
  if (containsAny(normalized, ['carnes frias', 'mortadela'])) return { category: 'Carnes frias' };
  if (containsAny(normalized, ['cerveza', 'club colombia', 'sixpack', 'six pack'])) return { query: normalized };
  if (containsAny(normalized, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos'])) return { query: normalized };
  if (containsAny(normalized, ['jugo', 'jugos'])) return { query: 'jugo' };
  if (containsAny(normalized, ['bebida', 'bebidas', 'sed', 'tomar', 'gaseosa', 'coca', 'frio', 'fria'])) return { category: 'bebidas' };
  if (containsAny(normalized, ['mecato', 'snack', 'snacks', 'dulce', 'antojo', 'galleta', 'papas', 'barato', 'economico', 'economica', 'lonchera', 'refrigerio', 'picar'])) return { category: 'snacks' };
  if (containsAny(normalized, ['cafe', 'cafes', 'tinto', 'tintico'])) return { category: 'cafe' };
  if (containsAny(normalized, ['aseo', 'limpieza', 'jabon', 'shampoo', 'papel'])) return { category: 'aseo' };
  if (containsAny(normalized, ['pan', 'panaderia', 'panadería', 'onces', 'arepa', 'desayuno'])) return { category: 'panaderia' };
  if (containsAny(normalized, ['leche', 'queso', 'yogur', 'yogurt', 'lacteo', 'lácteo'])) return { category: 'lacteos' };
  if (containsAny(normalized, ['arroz', 'aceite', 'huevos', 'despensa', 'mercado'])) return { category: 'despensa' };
  if (normalized.includes('mostrador')) return { category: 'mobiliario' };
  if (normalized.includes('vitrina')) return { category: 'exhibicion' };
  if (normalized.includes('repuesto') || normalized.includes('motor')) return { category: 'repuestos' };
  if (normalized.includes('hogar')) return { category: 'hogar' };
  return { query: text };
}

function removeResolvedProductMissingFields(missingFields, item) {
  const candidates = [
    item.rawName,
    item.catalogQuery,
    item.product?.name,
    ...(item.product?.aliases ?? []),
  ].map(normalizeText).filter(Boolean);
  for (let index = missingFields.length - 1; index >= 0; index -= 1) {
    const field = missingFields[index];
    const normalizedField = normalizeText(field);
    const looksLikeProductGap = field.startsWith('product:') || containsAny(normalizedField, ['producto', 'referencia', 'presentacion']);
    if (!looksLikeProductGap) continue;
    const missing = normalizeText(field.replace('product:', ''));
    if (candidates.some((candidate) => candidate.includes(missing) || missing.includes(candidate))) {
      missingFields.splice(index, 1);
    }
  }
}

function removeResolvedBudgetMissingFields(missingFields, item) {
  const candidates = [
    item.rawName,
    item.catalogQuery,
    item.product?.name,
    ...(item.product?.aliases ?? []),
  ].map(normalizeText).filter(Boolean);
  for (let index = missingFields.length - 1; index >= 0; index -= 1) {
    const field = missingFields[index];
    if (!field.startsWith('quantity:') && !field.startsWith('presentation:')) continue;
    const missing = normalizeText(field.replace(/^quantity:|^presentation:/, ''));
    if (candidates.some((candidate) => candidate.includes(missing) || missing.includes(candidate))) {
      missingFields.splice(index, 1);
    }
  }
}

function removeResolvedStockMissingFields(missingFields, item) {
  const candidates = [
    item.rawName,
    item.catalogQuery,
    item.product?.name,
    ...(item.product?.aliases ?? []),
  ].map(normalizeText).filter(Boolean);
  for (let index = missingFields.length - 1; index >= 0; index -= 1) {
    const field = missingFields[index];
    if (!field.startsWith('stock:')) continue;
    const missing = normalizeText(field.replace('stock:', ''));
    if (candidates.some((candidate) => candidate.includes(missing) || missing.includes(candidate))) {
      missingFields.splice(index, 1);
    }
  }
}

function selectAcceptableOrderProduct(rows = [], item = {}) {
  const eligible = rows.filter((row) => isAcceptableOrderProduct(row, item));
  if (!item.requestedPresentation) return eligible[0];
  return eligible.find((row) => productMatchesRequestedPresentation(row, item.requestedPresentation)) ?? null;
}

function selectUniqueAcceptableOrderProduct(rows = [], item = {}) {
  const eligible = rows.filter((row) => isAcceptableOrderProduct(row, item));
  if (item.requestedPresentation) {
    const matches = eligible.filter((row) => productMatchesRequestedPresentation(row, item.requestedPresentation));
    return matches.length === 1 ? matches[0] : null;
  }
  return eligible.length === 1 ? eligible[0] : null;
}

function withCatalogPresentationEvidence(item = {}, rows = []) {
  if (item.requestedPresentation || item.presentationHint) return item;
  const requestedPresentation = inferPresentationFromCatalogEvidence(item, rows);
  if (!requestedPresentation) return item;
  return {
    ...item,
    requestedPresentation,
    // This remains a resolver-level inference. It is deliberately not copied
    // to catalog-search filters, where it could suppress compatible variants.
    presentationEvidence: 'catalog_candidate_match',
  };
}

function inferPresentationFromCatalogEvidence(item = {}, rows = []) {
  const source = normalizeText([item.rawName, item.catalogQuery, item.productHypothesis]
    .filter(Boolean)
    .join(' '));
  if (!source || !rows.length) return null;

  const presentationFor = (product) => product?.presentation
    || [product?.name, ...(product?.aliases ?? [])].filter(Boolean).join(' ');
  const fieldsFor = (product) => [product?.name, product?.presentation, ...(product?.aliases ?? [])]
    .filter(Boolean)
    .map(normalizeText);

  // Prefer quantities accompanied by a unit (including Colombian phrasing
  // such as "litro y medio"). They are direct evidence of presentation.
  const volumes = presentationVolumesInMilliliters(source);
  if (volumes.length) {
    const matched = rows.filter((product) => {
      const productVolumes = fieldsFor(product).flatMap(presentationVolumesInMilliliters);
      return volumes.some((volume) => productVolumes.includes(volume));
    });
    if (matched.length) return presentationFor(matched[0]);
  }

  // Some customers omit the unit but preserve a useful number: "coca 350".
  // Treat it as presentation evidence only when it can be grounded in a
  // catalog candidate. Quantity and an amount that the interpreter already
  // identified as a budget are conversation facts, never presentations.
  // There is intentionally no fixed list of sizes or product families here.
  const nonPresentationAmounts = new Set([item.quantity, item.budgetAmount]
    .map(Number)
    .filter(Number.isFinite));
  const numericMentions = presentationNumbers(source)
    .filter((amount) => !nonPresentationAmounts.has(amount));
  if (!numericMentions.length) return null;
  const matched = rows.filter((product) => {
    const numbers = fieldsFor(product).flatMap(presentationNumbers);
    return numericMentions.some((amount) => numbers.includes(amount));
  });
  return matched.length ? presentationFor(matched[0]) : null;
}

function catalogEvidenceForItem(rows = [], item = {}, selectedProduct = null) {
  const eligible = rows.filter((row) => isAcceptableOrderProduct(row, item));
  // Never reintroduce incompatible rows as evidence. That fallback made a
  // failed constrained search look like a valid alternative and could result
  // in a product with a different presentation reaching the basket.
  const candidates = eligible;
  const unique = new Map();
  for (const row of [selectedProduct, ...candidates].filter(Boolean)) {
    const key = String(row.sku ?? `${row.name ?? 'product'}:${row.presentation ?? ''}`);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()].slice(0, 8);
}

function presentationOptionsForItem(rows = [], item = {}, selectedProduct = null) {
  const familyTokens = productFamilyTokens(item.rawName ?? item.catalogQuery);
  const candidates = rows.filter((row) => {
    if (!row) return false;
    if (!familyTokens.length) return row.sku === selectedProduct?.sku;
    const productText = normalizeText([
      row.name,
      row.brand,
      row.presentation,
      row.description,
      row.productFamily,
      ...(row.aliases ?? []),
      ...(row.tags ?? []),
      typeof row.attributes === 'object' ? JSON.stringify(row.attributes) : row.attributes,
    ].filter(Boolean).join(' '));
    return familyTokens.every((token) => productText.includes(token));
  });
  const unique = new Map();
  for (const product of [selectedProduct, ...candidates].filter(Boolean)) {
    unique.set(product.sku ?? `${product.name}:${product.presentation}`, product);
  }
  return [...unique.values()];
}

function productFamilyTokens(value) {
  return normalizeText(value)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|l|litro|litros|g|gr|kg)\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !['para', 'domicilio', 'pedido', 'quiero', 'una', 'uno'].includes(token));
}

function isAcceptableOrderProduct(product, item = {}) {
  if (!product) return false;
  const query = normalizeText([item.rawName, item.catalogQuery, item.requestedPresentation].filter(Boolean).join(' '));
  const productText = normalizeText([product.name, product.brand, product.category, product.presentation, ...(product.aliases ?? [])].filter(Boolean).join(' '));
  if (item.requestedPresentation && !productMatchesRequestedPresentation(product, item.requestedPresentation)) return false;
  if (item.requestedAttributes && !matchesRequestedCatalogAttributes(product, item.requestedAttributes)) return false;
  if (containsAny(query, ['cerveza', 'club colombia', 'sixpack', 'six pack']) && !containsAny(productText, ['cerveza', 'club colombia'])) return false;
  if (containsAny(query, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos']) && !containsAny(productText, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos'])) return false;
  if (containsAny(query, ['salchichon', 'salchicha']) && !containsAny(productText, ['salchicha', 'salchichon', 'carnes frias'])) return false;
  if (product.matchType === 'similar' && Number(product.matchScore ?? 0) <= 2) {
    const productTokens = new Set(productText.split(/\s+/).filter((token) => token.length >= 4));
    const queryTokens = query.split(/\s+/).filter((token) => token.length >= 4);
    return queryTokens.some((token) => productTokens.has(token));
  }
  // Retrieval intentionally remains broad: a graph or semantic search may
  // return products which share a presentation, category or occasion. Before
  // any of those rows becomes a selectable order option, however, it needs
  // enough evidence that it is the product the LLM interpreted. This is not a
  // catalog filter and contains no family-specific rules; it simply prevents
  // a shared unit such as "500 g" from turning Cafe into an alternative for
  // "Arroz Diana 500 g".
  const identityTokens = requestedProductIdentityTokens(item);
  if (identityTokens.length) {
    const productIdentity = normalizeText([
      product.name,
      product.brand,
      product.productFamily,
      ...(product.aliases ?? []),
    ].filter(Boolean).join(' ')).split(/\s+/).filter(Boolean);
    const matched = identityTokens.filter((token) => productIdentity.some((candidate) => (
      candidate === token
      || (candidate.length >= 4 && token.length >= 4 && (candidate.startsWith(token) || token.startsWith(candidate)))
    ))).length;
    // A request can include descriptive context (for example, "jabon para
    // lavar ropa") that is absent from the name. Half of its identity terms
    // must still be grounded in the product name, brand, family or aliases.
    if ((matched / identityTokens.length) < 0.5) return false;
  }
  return true;
}

function requestedProductIdentityTokens(item = {}) {
  const source = [item.rawName, item.catalogQuery, item.productHypothesis]
    .filter(Boolean)
    .join(' ');
  return [...new Set(normalizeText(source)
    // Sizes and units describe a requested variant, not the identity of a
    // product. Presentation compatibility is validated independently.
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|l|lt|litro|litros|g|gr|kg|unidades?)\b/g, ' ')
    .replace(/\bx\s*\d+\b/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => ![
      'para', 'domicilio', 'pedido', 'quiero', 'quieres', 'regala', 'regalame',
      'manda', 'mandame', 'necesito', 'una', 'uno', 'unos', 'unas', 'con', 'por',
      'favor', 'del', 'que', 'tiene', 'hay', 'me', 'de', 'la', 'el', 'los', 'las',
    ].includes(token)))];
}

function matchesRequestedCatalogAttributes(product, requestedAttributes = {}) {
  if (!requestedAttributes || typeof requestedAttributes !== 'object') return true;
  const actual = normalizeText([
    product.brand,
    product.category,
    product.presentation,
    product.productFamily,
    product.description,
    ...(product.aliases ?? []),
    ...(product.tags ?? []),
    typeof product.attributes === 'object' ? JSON.stringify(product.attributes) : product.attributes,
  ].filter(Boolean).join(' '));
  return Object.entries(requestedAttributes).every(([key, value]) => {
    if (value === null || value === undefined || value === '') return true;
    const expected = normalizeText(`${key} ${value}`);
    return actual.includes(normalizeText(value)) || actual.includes(expected);
  });
}

function buildCatalogReply({ selected, alternatives, drive, delivery, query, categoryQuery = false }) {
  const categoryOptions = [selected, ...alternatives];
  // Solo el intérprete puede declarar que se trata de una exploración de
  // categoría. Que una consulta concreta contenga la palabra "café" o
  // "gaseosa" no la convierte en una recomendación genérica.
  if (categoryOptions.length > 1 && categoryQuery) {
    const options = categoryOptions
      .map((item) => `${item.name} (${formatCurrency(item.price)}, stock ${item.stock})`)
      .join('; ');
    const deliveryAsk = delivery ? ' ¿Cual quieres y cuantas unidades para el domicilio?' : ' ¿Cual quieres que te cotice?';
    return `Tenemos estas opciones: ${options}.${deliveryAsk}`;
  }
  const matchIntro = selected.matchType === 'similar'
    ? `No encontre exacto "${query}", pero el mas cercano es ${selected.name}`
    : `Tengo disponible ${selected.name}`;
  const deliveryAsk = delivery ? ' ¿Cuantas unidades quieres para el domicilio?' : ' ¿Quieres que te cotice una cantidad?';
  const alternativeText = alternatives.length
    ? ` Tambien podria ofrecerte: ${alternatives.map((item) => item.name).join(', ')}.`
    : '';
  return `${matchIntro} por ${formatCurrency(selected.price)}. Stock actual: ${selected.stock}. ${drive.files[0]?.summary ?? ''}${alternativeText}${deliveryAsk}`;
}

function buildMultiCatalogReply({ matches, delivery }) {
  const found = matches.filter((match) => match.selected);
  const missing = matches.filter((match) => !match.selected).map((match) => match.query);
  const seen = new Set();
  const foundLines = found
    .filter((match) => {
      if (seen.has(match.selected.sku)) return false;
      seen.add(match.selected.sku);
      return true;
    })
    .map((match) => `${match.selected.name} (${formatCurrency(match.selected.price)}, stock ${match.selected.stock})`);
  const alternatives = found
    .flatMap((match) => match.alternatives ?? [])
    .filter((item) => item && !seen.has(item.sku))
    .slice(0, 2)
    .map((item) => item.name);

  const parts = [];
  if (foundLines.length) parts.push(`Encontre estas coincidencias: ${foundLines.join('; ')}.`);
  if (missing.length) parts.push(`No encontre en el catalogo actual: ${missing.join(', ')}.`);
  if (alternatives.length) parts.push(`Tambien podria servirte: ${alternatives.join(', ')}.`);
  const ask = delivery
    ? '¿Quieres que te cotice alguno para domicilio y en que cantidad?'
    : '¿Quieres que te cotice alguno o prefieres que valide con un asesor lo que no aparece?';
  return `${parts.join(' ')} ${ask}`.trim();
}

function isCategoryQuery(query) {
  const normalized = normalizeText(query);
  return containsAny(normalized, [
    'jugo',
    'jugos',
    'bebida',
    'bebidas',
    'sed',
    'tomar',
    'gaseosa',
    'frio',
    'fria',
    'mecato',
    'snack',
    'snacks',
    'dulce',
    'antojo',
    'barato',
    'economico',
    'economica',
    'lonchera',
    'refrigerio',
    'picar',
    'aseo',
    'limpieza',
    'panaderia',
    'panadería',
    'onces',
    'desayuno',
    'lacteo',
    'lácteo',
    'despensa',
    'mercado',
  ]);
}

function describeOperationalFailure(error) {
  const providerCode = Number(error?.payload?.error?.code);
  const providerMessage = String(error?.payload?.error?.message ?? error?.message ?? '');
  if (error?.code === 'whatsapp_send_failed' && (
    providerCode === 131030 || providerMessage.includes('Recipient phone number not in allowed list')
  )) {
    return {
      nextStep: 'Meta bloqueó la respuesta porque este número no está autorizado para pruebas. Agrégalo como destinatario de prueba en Meta y envía un mensaje nuevo.',
      humanReason: 'El catálogo respondió, pero Meta no permite responder a este número hasta registrarlo como destinatario de prueba.',
    };
  }
  if (error?.code === 'whatsapp_send_failed') {
    return {
      nextStep: 'No se pudo enviar la respuesta por WhatsApp. Revisa el canal de Meta y vuelve a intentar con un mensaje nuevo.',
      humanReason: 'La respuesta fue preparada, pero el proveedor de WhatsApp rechazó el envío.',
    };
  }
  return {
    nextStep: 'Revisar incidente y reintentar.',
    humanReason: 'El agente no pudo completar el siguiente paso operativo.',
  };
}

function isPositiveAmount(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;
}

function quotedLineTotal(item) {
  if (!isPositiveAmount(item.product?.price)) return null;
  if (isPositiveAmount(item.quantity)) return Number(item.product.price) * Number(item.quantity);
  return isPositiveAmount(item.budgetAmount) ? Number(item.budgetAmount) : null;
}

function restoreClarificationDraft(saved = {}, planned = {}) {
  const previous = saved ?? {};
  const update = planned ?? {};
  const items = update.items?.length ? update.items : previous.items ?? [];
  return structuredClone({
    ...previous,
    ...update,
    paymentMethod: update.paymentMethod ?? previous.paymentMethod,
    missingFields: previous.missingFields ?? update.missingFields ?? [],
    items: items.map((item) => {
      const sku = item.skuHint ?? item.product?.sku;
      const matches = (previous.items ?? []).filter((candidate) => sku
        ? [candidate.product?.sku, candidate.skuHint].includes(sku)
        : [candidate.catalogQuery, candidate.rawName, candidate.product?.name].filter(Boolean)
          .some((name) => [item.catalogQuery, item.rawName].filter(Boolean).some((query) => normalizeText(name) === normalizeText(query))));
      const known = matches.length === 1 ? matches[0] : null;
      const plannedProduct = item.product ?? null;
      const knownProduct = known?.product ?? null;
      const plannedSku = item.skuHint ?? plannedProduct?.sku ?? null;
      const product = knownProduct && (!plannedSku || String(knownProduct.sku) === String(plannedSku))
        ? knownProduct
        : plannedProduct;
      return { ...known, ...item,
        quantity: item.quantity ?? known?.quantity,
        budgetAmount: item.budgetAmount ?? known?.budgetAmount,
        product,
        lineTotal: null,
      };
    }),
  });
}

function buildOrderReply({ orderItems, missingFields, customerProfile, subtotal, paymentMethods, paymentMethod, checkout }) {
  const uniqueMissing = [...new Set(missingFields)].filter(field => field !== 'payment_method' || checkout?.phase === 'payment');
  const foundLines = orderItems
    .filter((item) => item.product && !hasMissingPresentation(item, uniqueMissing))
    .map((item) => {
      const name = item.product.name;
      if (item.budgetAmount) return `${formatCurrency(item.budgetAmount)} de ${name}`;
      const price = Number(item.product?.price ?? 0);
      const unitPrice = price > 0 ? ` (${formatCurrency(price)} c/u)` : '';
      return `${item.quantity ?? 'cantidad pendiente'} x ${name}${unitPrice}`;
    });
  const quotedSubtotal = uniqueMissing.some((missing) => missing.startsWith('presentation:'))
    ? orderItems
      .filter((item) => item.product && !hasMissingPresentation(item, uniqueMissing))
      .reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0)
    : Number(subtotal ?? 0);
  const subtotalLine = quotedSubtotal > 0 ? ` Subtotal de productos: ${formatCurrency(quotedSubtotal)}.` : '';
  if (uniqueMissing.length) {
    const asks = [];
    const presentationNotes = [];
    if (uniqueMissing.includes('customer_name')) asks.push('tu nombre');
    if (uniqueMissing.includes('delivery_address')) asks.push('la direccion del domicilio');
    if (uniqueMissing.includes('payment_method')) asks.push(`cómo prefieres pagar: ${paymentMethodOptionsLabel(paymentMethods)}`);
    if (uniqueMissing.includes('order_items')) asks.push('que productos quieres pedir');
    for (const missing of uniqueMissing.filter((item) => item.startsWith('quantity:'))) {
      asks.push(`la cantidad de ${missing.replace('quantity:', '')}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('presentation:'))) {
      const query = missing.replace('presentation:', '');
      const item = orderItems.find((candidate) => matchesMissingPresentation(candidate, query));
      const options = item?.presentationOptions?.map(describeProductOption).filter(Boolean) ?? [];
      if (options.length) {
        const requestedName = requestedProductName(item, query);
        const requestedPresentation = item?.requestedPresentation ? ` de ${item.requestedPresentation}` : '';
        presentationNotes.push(`Pediste ${requestedName}${requestedPresentation}. Tengo ${joinSpanish(options)}. ¿Cual prefieres?`);
      } else {
        asks.push(`confirmar la presentacion de ${query}`);
      }
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('selection:'))) {
      const lineId = missing.replace('selection:', '');
      const item = orderItems.find((candidate) => candidate.lineId === lineId);
      const options = item?.catalogCandidates?.map(describeProductOption).filter(Boolean) ?? [];
      const question = item?.selectionQuestion || `Para ${requestedProductName(item, item?.catalogQuery)}, ¿cuál opción prefieres?`;
      if (options.length) presentationNotes.push(`${question} Opciones: ${joinSpanish(options)}.`);
      else asks.push(`aclarar el producto ${item?.catalogQuery ?? lineId}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('product:'))) {
      asks.push(`una referencia mas clara para ${missing.replace('product:', '')}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('stock:'))) {
      asks.push(`confirmar alternativa para ${missing.replace('stock:', '')}`);
    }
    const prefix = foundLines.length ? `Claro. Tengo en la solicitud: ${foundLines.join(', ')}.` : 'Claro, te ayudo con el domicilio.';
    const optionsReply = presentationNotes.length ? ` ${presentationNotes.join(' ')}` : '';
    const dataAsk = asks.length ? ` Para continuar necesito ${joinSpanish(asks)}.` : '';
    return `${prefix}${subtotalLine}${optionsReply}${dataAsk}`;
  }
  const address = customerProfile?.defaultAddress ? ` a tu direccion guardada (${customerProfile.defaultAddress})` : '';
  const payment = paymentMethodLabel(paymentMethod, paymentMethods);
  return buildStructuredOrderSummary({
    orderItems,
    customerProfile,
    subtotal,
    payment,
    checkout,
    address,
  });
}

function buildStructuredOrderSummary({ orderItems, customerProfile, subtotal, payment, checkout, address }) {
  const lines = [checkout?.phase === 'review' ? 'Resumen del pedido' : 'Resumen final del pedido'];
  if (customerProfile?.name) lines.push(`Cliente: ${customerProfile.name}`);
  if (customerProfile?.defaultAddress) lines.push(`Dirección: ${customerProfile.defaultAddress}`);
  lines.push('', 'Productos:');
  for (const item of orderItems.filter((candidate) => candidate.product)) {
    const quantity = item.budgetAmount ? formatCurrency(item.budgetAmount) : `${item.quantity ?? 0} x`;
    const unitPrice = item.budgetAmount ? '' : ` x ${formatCurrency(item.product.price)}`;
    const lineTotal = item.lineTotal !== null && item.lineTotal !== undefined ? ` = ${formatCurrency(item.lineTotal)}` : '';
    lines.push(`- ${quantity} ${item.product.name}${unitPrice}${lineTotal}`.replace(/\s+/g, ' ').trim());
  }
  lines.push(`Subtotal de productos: ${formatCurrency(subtotal)}`);
  if (payment) lines.push(`Pago: ${payment}`);
  if (checkout?.phase === 'review') {
    lines.push('', '¿Quieres agregar algo más o continuar con este pedido?');
  } else {
    lines.push('', `¿Confirmas el pedido?${address ? '' : ' Necesito confirmar la dirección si aún no está registrada.'}`);
  }
  return lines.join('\n');
}

function needsHumanProductResolution(missingFields) {
  return missingFields.some((field) =>
    field.startsWith('product:') ||
    field.startsWith('price:') ||
    field.startsWith('stock:')
  );
}

function productMatchesRequestedPresentation(product, requestedPresentation) {
  const requestedVolume = presentationVolumeInMilliliters(requestedPresentation);
  const fields = [product.name, product.presentation, ...(product.aliases ?? [])]
    .filter(Boolean)
    .map(normalizeText);
  if (requestedVolume) {
    const productVolumes = fields.flatMap(presentationVolumesInMilliliters);
    if (productVolumes.includes(requestedVolume)) return true;

    // Some imported catalogs put "Coca-Cola 1.5" in the name but leave the
    // presentation cell blank. A matching numeric presentation is still a
    // precise match, not a reason to ask the customer to choose it again.
    const requestedAmounts = presentationNumbers(requestedPresentation);
    return requestedAmounts.some((amount) => fields.some((field) => presentationNumbers(field).includes(amount)));
  }
  const fieldsText = fields.join(' ');
  const requestedNumber = normalizeText(requestedPresentation).match(/\d{2,4}/)?.[0];
  if (!requestedNumber) return true;
  return fieldsText.includes(requestedNumber);
}

function presentationVolumeInMilliliters(value) {
  return presentationVolumesInMilliliters(value)[0] ?? null;
}

function presentationVolumesInMilliliters(value) {
  const normalized = normalizeText(value);
  const volumes = [];
  for (const match of normalized.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(ml|cc|l|litro|litros)\b/g)) {
    const amount = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(amount)) continue;
    volumes.push(['l', 'litro', 'litros'].includes(match[2]) ? Math.round(amount * 1000) : Math.round(amount));
  }
  if (/\blitro\s+y\s+medio\b/.test(normalized)) volumes.push(1500);
  if (/\bmedio\s+litro\b/.test(normalized)) volumes.push(500);
  return [...new Set(volumes)];
}

function presentationNumbers(value) {
  return [...normalizeText(value).matchAll(/\b(\d+(?:[.,]\d+)?)\b/g)]
    .map((match) => Number(match[1].replace(',', '.')))
    .filter(Number.isFinite);
}

function hasMissingPresentation(item, missingFields) {
  return missingFields.some((missing) => (
    missing.startsWith('presentation:') && matchesMissingPresentation(item, missing.replace('presentation:', ''))
  ));
}

function describeProductOption(product) {
  if (!product?.name) return null;
  const presentation = product.presentation && !normalizeText(product.name).includes(normalizeText(product.presentation))
    ? ` ${product.presentation}`
    : '';
  return `${product.name}${presentation} (${formatCurrency(product.price)})`;
}

function shortProductOptionTitle(product) {
  const text = describeProductOption(product) ?? 'Elegir producto';
  return text.length <= 20 ? text : `${text.slice(0, 17).trim()}...`;
}

function parseCatalogSelectionValue(value) {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    if (!parsed?.basketKey || !parsed?.lineId || !parsed?.sku) return null;
    return parsed;
  } catch {
    return null;
  }
}

function requestedProductName(item, fallback) {
  const raw = String(item?.rawName ?? item?.catalogQuery ?? fallback ?? '').trim();
  const withoutPresentation = raw
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|l|litro|litros|g|gr|kg)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutPresentation || fallback;
}

function buildHumanResolutionReply({ orderItems, missingFields, customerProfile }) {
  const uniqueMissing = [...new Set(missingFields)];
  const unavailable = uniqueMissing
    .filter((field) => field.startsWith('product:') || field.startsWith('stock:') || field.startsWith('price:'))
    .map((field) => field.replace(/^product:|^stock:|^price:/, ''));
  const understood = orderItems.map(describeUnderstoodItem).filter(Boolean);
  const validationNotes = orderItems.map(describeValidationDoubt).filter(Boolean);
  const asks = [];
  if (!customerProfile?.name && uniqueMissing.includes('customer_name')) asks.push('tu nombre');
  if (!customerProfile?.defaultAddress && uniqueMissing.includes('delivery_address')) asks.push('la direccion del domicilio');
  const intro = understood.length
    ? `Claro, veci. Te entiendo: ${joinSpanish(understood)}.`
    : 'Claro, veci. Te ayudo con el domicilio.';
  const validation = validationNotes.length
    ? ` ${joinSentences(validationNotes)}`
    : unavailable.length
      ? ` Voy a validar con la tienda ${joinSpanish(unavailable)} porque no aparece disponible con seguridad.`
      : ' Voy a validar con la tienda porque no tengo suficiente seguridad para resolverlo automaticamente.';
  const dataAsk = asks.length ? ` Para avanzar con el domicilio, me regalas ${joinSpanish(asks)} mientras lo valido.` : '';
  return `${intro}${validation}${dataAsk}`;
}

function describeUnderstoodItem(item) {
  if (item.budgetAmount && item.product) return `${formatCurrency(item.budgetAmount)} de ${item.product.name}`;
  if (item.budgetAmount && (item.catalogQuery || item.rawName)) return `${formatCurrency(item.budgetAmount)} de algo tipo ${item.catalogQuery ?? item.rawName}`;
  if (item.requestedPresentation && (item.rawName || item.catalogQuery)) return `${item.quantity ?? 1} ${cleanRequestedName(item.rawName ?? item.catalogQuery)}`;
  if (item.product && item.quantity) return `${item.quantity} ${item.product.name}`;
  if (item.rawName || item.catalogQuery) return cleanRequestedName(item.rawName ?? item.catalogQuery);
  return null;
}

function cleanRequestedName(value) {
  return String(value ?? '')
    .trim()
    .replace(/^(un|una|unos|unas)\s+/i, '')
    .replace(/^paquete\s+de\s+/i, 'paquete de ');
}

function describeValidationDoubt(item) {
  if (item.budgetAmount && item.rawName && item.product) {
    return `Encontré ${item.product.name} como posible coincidencia, pero quiero validar si eso era lo que querías decir con "${item.rawName}".`;
  }
  if (item.requestedPresentation && item.product && !productMatchesRequestedPresentation(item.product, item.requestedPresentation)) {
    return `También encontré ${item.product.name}, pero la presentación registrada es ${item.product.presentation ?? 'otra'}, no ${item.requestedPresentation}.`;
  }
  if (!item.product && (item.rawName || item.catalogQuery)) {
    return `No encontré una coincidencia segura para ${item.rawName ?? item.catalogQuery}, entonces lo subo a validación con la tienda.`;
  }
  if (item.product && !item.available) {
    return `${item.product.name} aparece sin stock suficiente, entonces valido alternativa con la tienda.`;
  }
  return null;
}

function buildHumanResolutionSummary({ orderItems, missingFields, customerProfile, text }) {
  const missing = [...new Set(missingFields)];
  const requested = orderItems
    .map((item) => `${item.quantity ?? '?'} x ${item.catalogQuery}${item.product ? ` -> ${item.product.name}` : ' -> sin coincidencia'}`)
    .join('; ');
  return [
    `Mensaje cliente: ${text}`,
    `Canasta interpretada: ${requested || 'sin items confiables'}`,
    `Faltantes: ${missing.join(', ') || 'ninguno'}`,
    customerProfile?.name ? `Cliente: ${customerProfile.name}` : 'Cliente no identificado completamente',
  ].join(' | ');
}

function matchesMissingPresentation(item, query) {
  const normalizedQuery = normalizeText(query);
  return normalizeText(item.rawName) === normalizedQuery ||
    normalizeText(item.catalogQuery) === normalizedQuery ||
    normalizeText(item.product?.name).includes(normalizedQuery);
}

function joinSpanish(items) {
  if (!items.length) return 'los datos faltantes';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
}

function joinSentences(sentences) {
  return sentences.map((sentence) => String(sentence ?? '').trim()).filter(Boolean).join(' ');
}

function collectCustomerDetails({ plan, text, paymentMethods }) {
  const fromText = extractClarification(text, paymentMethods);
  const fromPlan = normalizePlannedCustomerDetails(plan?.customerDetails);
  return {
    ...fromText,
    name: fromText.name ?? fromPlan.name,
    defaultAddress: fromText.defaultAddress ?? fromPlan.defaultAddress,
    nameSource: fromText.name ? 'text' : fromPlan.name ? 'llm' : null,
    defaultAddressSource: fromText.defaultAddress ? 'text' : fromPlan.defaultAddress ? 'llm' : null,
  };
}

function normalizePlannedCustomerDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { name: null, defaultAddress: null };
  }
  return {
    name: normalizeCapturedCustomerText(value.name ?? value.customerName, { maxLength: 120 }),
    defaultAddress: normalizeCapturedCustomerText(value.deliveryAddress ?? value.defaultAddress ?? value.address, { maxLength: 220 }),
  };
}

function normalizeCapturedCustomerText(value, { maxLength }) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function extractClarification(text, paymentMethods) {
  const value = String(text ?? '').trim();
  const explicitName = value.match(/\b(?:me llamo|soy|mi nombre es|nombre)\s+([^,.]+)/i)?.[1]?.trim();
  const labeledAddress = value.match(/\b(?:direccion|dirección|dir)\s*(?:es|:)?\s+(.+)$/i)?.[1]?.trim();
  const streetMatch = value.match(/\b(?:calle|cl\.?|carrera|cra\.?|kr\.?|avenida|av\.?|transversal|tv\.?|diagonal|dg\.?)\s*\d[^\n]*$/i);
  const defaultAddress = normalizeCapturedCustomerText(labeledAddress ?? streetMatch?.[0], { maxLength: 220 })
    ?.replace(/\s*[,.]?\s*(?:pago|pagar[ée]?|efectivo|tarjeta|bre[- ]?b|transferencia)\b.*$/i, '')
    .trim()
    .replace(/[.,;]+$/, '') || null;
  const precedingText = streetMatch?.index > 0 ? value.slice(0, streetMatch.index).replace(/[,:;\-\s]+$/, '') : '';
  const inferredName = isLikelyCustomerName(precedingText) ? precedingText : null;
  const name = normalizeCapturedCustomerText(explicitName ?? inferredName, { maxLength: 120 });
  const quantity = Number(value.match(/^\s*(\d+)\b/)?.[1] ?? 0) || null;
  return {
    name,
    defaultAddress,
    quantity,
    paymentMethod: resolvePaymentMethod(value, paymentMethods)?.id ?? null,
    removeProductQuery: extractRemovalQuery(value),
  };
}

function isLikelyCustomerName(value) {
  const candidate = String(value ?? '').replace(/^(?:mi nombre es|soy|me llamo|nombre)\s+/i, '').trim();
  const normalized = normalizeText(candidate);
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (containsAny(normalized, ['quiero', 'necesito', 'domicilio', 'direccion', 'dirección', 'pago', 'efectivo', 'tarjeta', 'breb'])) return false;
  return words.every((word) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/u.test(word));
}

function removeMissingField(fields, field) {
  let index = fields.indexOf(field);
  while (index >= 0) {
    fields.splice(index, 1);
    index = fields.indexOf(field);
  }
}

function extractRemovalQuery(text) {
  const match = String(text ?? '').match(/\b(?:sin|quita|quitar|quitale|quítale)\s+(?:ese|esa|el|la)?\s*([^,.]+)/i);
  return match?.[1]?.trim() ?? null;
}

function matchesRemovalQuery(item, query) {
  const normalized = normalizeText(query);
  if (!normalized) return false;
  // A product attribute such as "sin alcohol" is not an instruction to
  // remove the product. Explicit removal of its full name still matches.
  return [item.rawName, item.catalogQuery, item.product?.name].filter(Boolean)
    .map(normalizeText).some(name => name.includes(normalized) && !name.includes(`sin ${normalized}`));
}

function confirmsPresentation(text, productName) {
  const normalized = normalizeText(text);
  if (containsAny(normalized, ['si', 'sirve', 'esa', 'ese', 'correcto', 'confirmo'])) return true;
  const size = normalizeText(productName).match(/\b\d+\s*(ml|l|litro|litros|g|gr|kg)\b/)?.[0];
  return Boolean(size && normalized.includes(size));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
}

function formatOrderItems(items = []) {
  const lines = (items ?? [])
    .filter((item) => item?.name)
    .map((item) => `${item.quantity ?? 1} x ${item.name}`);
  if (!lines.length) return 'pedido registrado';
  if (lines.length <= 3) return lines.join(', ');
  return `${lines.slice(0, 3).join(', ')} y ${lines.length - 3} producto(s) mas`;
}

function initials(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'WA';
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
