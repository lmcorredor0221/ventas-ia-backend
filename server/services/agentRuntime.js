import { appendAuditEvent } from './authService.js';
import { isClosedConversation, isDispatchedConversation } from '../domain/conversationStatus.js';
import { hasOpenHumanRequest } from './pendingRequestPolicy.js';
import { paymentMethodLabel, paymentMethodOptionsLabel, paymentMethodsForTenant, resolvePaymentMethod } from './paymentMethods.js';

export class AgentRuntime {
  constructor({ store, events, tools, planner, usage, config, orders = null }) {
    this.store = store;
    this.events = events;
    this.tools = tools;
    this.planner = planner;
    this.usage = usage;
    this.config = config;
    this.orders = orders;
    this.manualSweepTimer = null;
    this.conversationEnsureLocks = new Map();
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

  async processInbound(normalized, { skipIdempotency = false } = {}) {
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
    const plan = await this.planner.plan({ tenantId, conversationId, normalized, customerProfile, conversation: currentConversation });
    await this.patchConversation(conversationId, {
      reasoningPlan: plan,
      aiExecution: {
        mode: plan.executionMode,
        provider: plan.provider,
        model: plan.model,
        plannedAt: new Date().toISOString(),
      },
      lastTool: 'llm_core',
      stage: 'planning',
      zone: 'agent',
      progress: Math.max(currentConversation?.progress ?? 0, 22),
    });

    if (customerLookup.status === 'connection_required' && ['catalog_query', 'delivery_order', 'order_confirmation', 'order_clarification'].includes(plan.intent)) {
      return this.handleGoogleUnavailable({ tenantId, conversationId, normalized, plan });
    }

    if (normalized.messageType === 'image' || normalized.mediaRef || plan.intent === 'human_handoff') {
      const handoff = await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: normalized.messageType === 'image' || normalized.mediaRef ? 'Clasificar imagen enviada por cliente' : 'Cliente solicita asesor humano',
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
    });
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
    const message = 'No puedo confirmar el catalogo en este momento porque la tienda no esta conectada a Google. Dejo tu solicitud en manos del tendero para validarla y continuar contigo.';
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

  async handleCatalogQuery({ tenantId, conversationId, normalized, plan }) {
    const text = normalized.text ?? '';
    const catalogItems = plan.order?.items ?? [];
    const catalogSearches = catalogSearchesFromPlan(plan, catalogItems, text);

    if (catalogSearches.length > 1) {
      const matches = await Promise.all(catalogSearches.map(async (search) => {
        const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
          range: (await this.getTenant(tenantId))?.config?.googleSheets?.range,
          filters: search.filters,
          cache_policy: 'short_ttl',
        });
        return {
          query: search.query,
          selected: catalog.rows[0] ?? null,
          alternatives: catalog.rows.slice(1, 2),
        };
      }));
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
      range: (await this.getTenant(tenantId))?.config?.googleSheets?.range,
      filters: search.filters,
      cache_policy: 'short_ttl',
    });
    const selected = catalog.rows[0];
    const alternatives = catalog.rows.slice(1, 4);
    const drive = await this.resolveDriveContext({
      tenantId,
      conversationId,
      selectedRows: selected ? [selected] : [],
    });

    const quote = selected
      ? buildCatalogReply({ selected, alternatives, drive, delivery: Boolean(plan.order?.delivery), query })
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

  async handleDeliveryOrder({ tenantId, conversationId, normalized, plan, customerProfile }) {
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
    const orderItems = await Promise.all((plan.order?.items ?? []).map(async (item, index) => {
      const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
        range: tenant?.config?.googleSheets?.range,
        filters: deliveryItemFiltersFromPlan(plan, item, index),
        cache_policy: 'short_ttl',
      });
      const product = selectAcceptableOrderProduct(catalog.rows, item);
      return {
        ...item,
        product,
        presentationOptions: presentationOptionsForItem(catalog.rows, item, product),
        lineTotal: product && item.quantity ? product.price * item.quantity : product && item.budgetAmount ? item.budgetAmount : null,
        available: Boolean(product && product.stock >= (item.quantity ?? 1)),
      };
    }));

    const currentConversation = await this.getConversation(conversationId);
    const previousDraft = currentConversation?.orderDraft;
    const effectiveOrderItems = previousDraft && isAdditiveOrderText(normalized.text)
      ? mergeOrderItems(previousDraft.items ?? [], orderItems)
      : orderItems;

    const selectedRows = effectiveOrderItems.map((item) => item.product).filter(Boolean);
    const drive = await this.resolveDriveContext({
      tenantId,
      conversationId,
      selectedRows,
      reason: 'validate_order_product_files',
    });

    const missingFields = [...(isAdditiveOrderText(normalized.text) ? previousDraft?.missingFields ?? [] : []), ...(plan.missingFields ?? [])];
    const selectedPaymentMethod = resolvePaymentMethod(normalized.text, paymentMethods)
      ?? resolvePaymentMethod(plan.order?.paymentMethod, paymentMethods)
      ?? resolvePaymentMethod(previousDraft?.paymentMethod, paymentMethods)
      ?? resolvePaymentMethod(collected.paymentMethod, paymentMethods);
    if (!effectiveOrderItems.length) missingFields.push('order_items');
    for (const item of effectiveOrderItems) {
      if (item.product) removeResolvedProductMissingFields(missingFields, item);
      if (item.budgetAmount) removeResolvedBudgetMissingFields(missingFields, item);
      if (!item.product) missingFields.push(`product:${item.catalogQuery}`);
      if (item.product && !item.available) missingFields.push(`stock:${item.catalogQuery}`);
      if (item.product && item.requestedPresentation && !productMatchesRequestedPresentation(item.product, item.requestedPresentation)) {
        missingFields.push(`presentation:${item.catalogQuery}`);
      }
    }
    const isDelivery = Boolean(plan.order?.delivery || previousDraft?.delivery);
    if (nextProfile?.name) removeMissingField(missingFields, 'customer_name');
    if (nextProfile?.defaultAddress) removeMissingField(missingFields, 'delivery_address');
    if (isDelivery && !selectedPaymentMethod) missingFields.push('payment_method');

    const subtotal = effectiveOrderItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
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
      });
    const canQuote = missingFields.length === 0;
    const paymentOffer = !requiresHumanResolution && !selectedPaymentMethod && missingFields.includes('payment_method')
      ? await this.createPaymentOffer({ tenantId, conversationId, paymentMethods })
      : null;
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: reply,
      facts: {
        kind: canQuote ? 'order_quote' : 'order_clarification',
        products: effectiveOrderItems.map((item) => item.product ?? item),
        subtotal,
        requiredTerms: selectedPaymentMethod?.label ? [selectedPaymentMethod.label] : [],
      },
    });

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
      interactive: paymentOffer?.interactive,
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
    const selectedPaymentMethod = resolvePaymentMethod(orderDraft.paymentMethod, paymentMethods)
      ?? resolvePaymentMethod(normalized.text, paymentMethods);
    if (orderDraft.delivery && !selectedPaymentMethod) {
      return this.handleOrderClarification({
        tenantId,
        conversationId,
        normalized,
        customerProfile,
        plan: {
          ...plan,
          intent: 'order_clarification',
          order: {
            ...orderDraft,
            missingFields: [...new Set([...(orderDraft.missingFields ?? []), 'payment_method'])],
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

    const confirmedItems = (orderDraft.items ?? []).map((item) => ({
      name: item.product?.name ?? item.catalogQuery ?? item.skuHint ?? 'Producto por validar',
      quantity: item.quantity ?? 1,
      unitPrice: item.product?.price ?? null,
      lineTotal: item.lineTotal ?? null,
    }));
    const deliveryAddress = customerProfile?.defaultAddress ?? 'Dirección pendiente por confirmar';
    await this.tools.call('human_handoff', tenantId, conversationId, {
      reason: 'Alistar domicilio confirmado',
      urgency: 'Alta',
      assigned_team: 'operaciones',
      context_snapshot: {
        summary: 'Pedido confirmado por WhatsApp; requiere preparacion y entrega humana.',
        orderId: order.order.id,
        subtotal: orderDraft.subtotal,
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
      value: formatCurrency(orderDraft.subtotal ?? 0),
      progress: 82,
      nextStep: 'Humano prepara el pedido y coordina entrega.',
      lastTool: 'google_sheets_order_write',
      orderId: order.order.id,
    });

    const confirmationFallback = `Pedido confirmado y registrado: ${formatOrderItems(confirmedItems)}. Subtotal de productos: ${formatCurrency(orderDraft.subtotal ?? 0)}.${paymentLabel ? ` Pago: ${paymentLabel}.` : ''} Dirección: ${deliveryAddress}. La tienda lo alista y coordina la entrega. Referencia: ${order.order.id}.`;
    const confirmationReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: confirmationFallback,
      facts: {
        kind: 'order_confirmed',
        products: confirmedItems,
        subtotal: orderDraft.subtotal ?? 0,
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
      subtotal: orderDraft.subtotal ?? 0,
      itemCount: orderDraft.items?.length ?? 0,
    });

    return { summary: 'Confirmed order registered and handed off', plan };
  }

  async handleOrderClarification({ tenantId, conversationId, normalized, plan, customerProfile }) {
    const draft = structuredClone(plan.order);
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
        return !confirmsPresentation(normalized.text, field.replace('presentation:', ''));
      }
      return true;
    });
    draft.missingFields = [...new Set(missingFields)];
    draft.subtotal = (draft.items ?? []).reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);

    const canQuote = draft.missingFields.length === 0;
    const reply = buildOrderReply({
      orderItems: draft.items ?? [],
      missingFields: draft.missingFields,
      customerProfile: nextProfile,
      subtotal: draft.subtotal,
      paymentMethods,
      paymentMethod: draft.paymentMethod,
    });
    const paymentOffer = !draft.paymentMethod && draft.missingFields.includes('payment_method')
      ? await this.createPaymentOffer({ tenantId, conversationId, paymentMethods })
      : null;
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: reply,
      facts: {
        kind: canQuote ? 'order_quote' : 'order_clarification',
        products: draft.items ?? [],
        subtotal: draft.subtotal,
        requiredTerms: draft.paymentMethod ? [paymentMethodLabel(draft.paymentMethod, paymentMethods)] : [],
      },
    });

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
      interactive: paymentOffer?.interactive,
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
    });
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
      });
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
      next.processedMessages = (next.processedMessages ?? []).filter((messageId) => !removedMessageIds.has(messageId));
      for (const messageId of removedMessageIds) delete next.processedMessagePayloads?.[messageId];
    });
    if (this.store.purgeTenantOperationalData) {
      await this.store.purgeTenantOperationalData(tenantId);
    }
    return { tenantId, deleted };
  }

  async ensureConversation(tenantId, normalized) {
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
      });
      await this.store.persistConversation?.(previous.id);
      return this.getConversation(previous.id);
    }
    const created = {
      id: `wa-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      waId: normalized.waId,
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
    });
      await this.store.persistConversation?.(created.id);
    return created;
  }

  async addMessage(conversationId, message) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      conversation.messages.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...message });
      conversation.need = message.text ?? conversation.need;
      conversation.updatedAt = new Date().toISOString();
    });
    await this.store.persistConversation?.(conversationId);
  }

  async patchConversation(conversationId, patch) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (conversation) Object.assign(conversation, patch, { updatedAt: new Date().toISOString() });
    });
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
    });
    if (!conversation) return null;
    await this.store.persistConversation?.(conversationId);
    return this.getConversation(conversationId);
  }

  async closeExpiredManualCases(now = Date.now()) {
    const inactivityMs = Number(this.config.manualCaseInactivityMinutes ?? 5) * 60_000;
    const expired = [];
    this.store.mutate((state) => {
      for (const conversation of state.conversations) {
        if (conversation.manualMode !== 'whatsapp_external' || conversation.status !== 'manual_active') continue;
        const lastActivity = Date.parse(conversation.manualLastActivityAt ?? conversation.updatedAt ?? conversation.createdAt ?? 0);
        if (!Number.isFinite(lastActivity) || now - lastActivity < inactivityMs) continue;
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
    });
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
    if (result.option?.action !== 'set_payment_method') {
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized, reason: 'Recibí tu selección. Escríbeme si quieres ajustar algo más.' });
    }
    const conversation = await this.getConversation(conversationId);
    const tenant = await this.getTenant(tenantId);
    const paymentMethods = paymentMethodsForTenant(tenant);
    const draft = structuredClone(conversation?.orderDraft ?? {});
    draft.paymentMethod = result.option.value;
    draft.paymentMethodLabel = paymentMethodLabel(result.option.value, paymentMethods);
    draft.missingFields = (draft.missingFields ?? []).filter((field) => field !== 'payment_method');
    const fallbackText = `Listo, queda ${draft.paymentMethodLabel} como forma de pago. ${draft.missingFields.length ? 'Aún necesito completar los datos pendientes para continuar.' : `El subtotal es ${formatCurrency(draft.subtotal ?? 0)}. ¿Confirmas el pedido?`}`;
    await this.patchConversation(conversationId, {
      orderDraft: draft,
      stage: draft.missingFields.length ? 'clarification' : 'quote',
      zone: draft.missingFields.length ? 'agent' : 'quote',
      nextStep: draft.missingFields.length ? 'Solicitar datos faltantes antes de cotizar.' : 'Esperar confirmación del pedido.',
    });
    const text = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText,
      facts: { kind: 'payment_selection', subtotal: draft.subtotal, requiredTerms: [draft.paymentMethodLabel] },
    });
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text,
    });
    return { summary: 'Interactive payment method recorded', interaction: result.option };
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
    });
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

function catalogSearchesFromPlan(plan, catalogItems, text) {
  const plannedSearches = (plan.toolPlan ?? [])
    .filter((step) => step.tool === 'google_sheets_read_table')
    .map((step, index) => ({
      query: step.candidate ?? step.query ?? step.filters?.query ?? step.filters?.category ?? text,
      filters: step.filters,
      candidateIndex: step.candidateIndex ?? index,
    }))
    .filter((step) => step.filters && Object.keys(step.filters).length);
  if (plannedSearches.length) return plannedSearches;
  const fallbackItems = catalogItems.length ? catalogItems : [{ catalogQuery: text, rawName: text }];
  return fallbackItems.map((item, index) => {
    const query = item.catalogQuery ?? item.rawName ?? text;
    return {
      query,
      filters: item.skuHint ? { sku: item.skuHint } : inferCatalogFilter(query),
      candidateIndex: index,
    };
  });
}

function deliveryItemFiltersFromPlan(plan, item, index) {
  // The order item is already bound to this catalog SKU. It is more reliable
  // than a planner tool step that may accidentally be reused for another line.
  if (item.skuHint) return { sku: item.skuHint };
  const planned = (plan.toolPlan ?? []).find((step) =>
    step.tool === 'google_sheets_read_table' &&
    (step.candidateIndex === index || step.candidate === item.catalogQuery || step.candidate === item.rawName)
  );
  if (planned?.filters && Object.keys(planned.filters).length) return planned.filters;
  return inferCatalogFilter(item.catalogQuery ?? item.rawName);
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
  return (state.ordersByTenant?.[request?.tenantId] ?? []).find((order) => (
    orderId ? order.id === orderId : order.conversationId === request?.conversationId
  )) ?? null;
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

function selectAcceptableOrderProduct(rows = [], item = {}) {
  const eligible = rows.filter((row) => isAcceptableOrderProduct(row, item));
  if (!item.requestedPresentation) return eligible[0];
  return eligible.find((row) => productMatchesRequestedPresentation(row, item.requestedPresentation)) ?? eligible[0];
}

function presentationOptionsForItem(rows = [], item = {}, selectedProduct = null) {
  const familyTokens = productFamilyTokens(item.rawName ?? item.catalogQuery);
  const candidates = rows.filter((row) => {
    if (!row) return false;
    if (!familyTokens.length) return row.sku === selectedProduct?.sku;
    const productText = normalizeText([row.name, row.brand, ...(row.aliases ?? [])].filter(Boolean).join(' '));
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
  if (containsAny(query, ['cerveza', 'club colombia', 'sixpack', 'six pack']) && !containsAny(productText, ['cerveza', 'club colombia'])) return false;
  if (containsAny(query, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos']) && !containsAny(productText, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos'])) return false;
  if (containsAny(query, ['salchichon', 'salchicha']) && !containsAny(productText, ['salchicha', 'salchichon', 'carnes frias'])) return false;
  if (product.matchType === 'similar' && Number(product.matchScore ?? 0) <= 2) {
    const productTokens = new Set(productText.split(/\s+/).filter((token) => token.length >= 4));
    const queryTokens = query.split(/\s+/).filter((token) => token.length >= 4);
    return queryTokens.some((token) => productTokens.has(token));
  }
  return true;
}

function buildCatalogReply({ selected, alternatives, drive, delivery, query }) {
  const categoryOptions = [selected, ...alternatives];
  if (categoryOptions.length > 1 && isCategoryQuery(query)) {
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

function buildOrderReply({ orderItems, missingFields, customerProfile, subtotal, paymentMethods, paymentMethod }) {
  const uniqueMissing = [...new Set(missingFields)];
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
  return `Listo. Te puedo preparar ${foundLines.join(', ')}${address}. Subtotal de productos: ${formatCurrency(subtotal)}.${payment ? ` Pago: ${payment}.` : ''} ¿Confirmas el pedido?`;
}

function needsHumanProductResolution(missingFields) {
  return missingFields.some((field) =>
    field.startsWith('product:') ||
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
    .filter((field) => field.startsWith('product:') || field.startsWith('stock:'))
    .map((field) => field.replace(/^product:|^stock:/, ''));
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
  return normalizeText(item.rawName).includes(normalized) ||
    normalizeText(item.catalogQuery).includes(normalized) ||
    normalizeText(item.product?.name).includes(normalized);
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
