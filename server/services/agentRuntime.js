import { appendAuditEvent } from './authService.js';

export class AgentRuntime {
  constructor({ store, events, tools, planner, usage, config }) {
    this.store = store;
    this.events = events;
    this.tools = tools;
    this.planner = planner;
    this.usage = usage;
    this.config = config;
    this.manualSweepTimer = null;
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

  async processInbound(normalized) {
    const tenantId = normalized.tenantId ?? this.config.defaultTenantId;
    await this.closeExpiredManualCases();
    const conversation = await this.ensureConversation(tenantId, normalized);

    if (await this.isDuplicate(normalized.messageId)) {
      return { duplicate: true, conversation };
    }

    if (conversation.manualMode === 'whatsapp_external' || conversation.status === 'manual_active') {
      await this.markProcessed(normalized.messageId, { tenantId, conversationId: conversation.id, provider: normalized.provider });
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
    await this.markProcessed(normalized.messageId, { tenantId, conversationId: conversation.id, provider: normalized.provider });
    this.usage?.recordAgentInteraction(tenantId, {
      conversationId: conversation.id,
      provider: normalized.provider,
      messageType: normalized.messageType,
    });

    this.events.emit({ type: 'agent.started', tenantId, conversationId: conversation.id, detail: 'Inbound WhatsApp message received' });
    await this.addMessage(conversation.id, { role: 'user', text: normalized.text || `[${normalized.messageType}]`, providerMessageId: normalized.messageId });

    try {
      const result = await this.routeConversation(tenantId, conversation.id, normalized);
      this.events.emit({ type: 'agent.completed', tenantId, conversationId: conversation.id, detail: result.summary });
      return { duplicate: false, conversation: await this.getConversation(conversation.id), result };
    } catch (error) {
      this.events.emit({ type: 'agent.failed', tenantId, conversationId: conversation.id, detail: error.message });
      await this.patchConversation(conversation.id, { status: 'degraded', zone: 'observability', nextStep: 'Revisar incidente y reintentar.' });
      throw error;
    }
  }

  async routeConversation(tenantId, conversationId, normalized) {
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
      lastTool: 'llm_core',
      stage: 'planning',
      zone: 'agent',
      progress: Math.max(currentConversation?.progress ?? 0, 22),
    });

    if (customerLookup.status === 'connection_required' && ['catalog_query', 'delivery_order', 'order_confirmation', 'order_clarification'].includes(plan.intent)) {
      return this.handleGoogleUnavailable({ tenantId, conversationId, normalized, plan });
    }

    if (normalized.messageType === 'image' || normalized.mediaRef || plan.intent === 'human_handoff') {
      await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: normalized.messageType === 'image' || normalized.mediaRef ? 'Clasificar imagen enviada por cliente' : 'Cliente solicita asesor humano',
        assigned_team: 'ventas',
        context_snapshot: { summary: normalized.text || 'Caso requiere apoyo humano.', normalized, plan },
      });
      await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
        action: 'send_session_message',
        wa_id: normalized.waId,
        text: normalized.messageType === 'image' || normalized.mediaRef
          ? 'Recibimos tu imagen. Un asesor la revisara y retomaremos la cotizacion con el producto identificado.'
          : 'Te conecto con un asesor. Dejamos tu solicitud registrada para continuar sin perder el contexto.',
      });
      return { summary: 'Human handoff requested', plan };
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
    await this.tools.call('human_handoff', tenantId, conversationId, {
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
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: message,
    });
    return { summary: 'Google unavailable; human handoff requested', plan };
  }

  async handleCatalogQuery({ tenantId, conversationId, normalized, plan }) {
    const text = normalized.text ?? '';
    const catalogItems = plan.order?.items ?? [];
    const catalogSearches = catalogSearchesFromPlan(plan, catalogItems, text);

    if (catalogSearches.length > 1) {
      const matches = [];
      for (const search of catalogSearches) {
        const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
          range: (await this.getTenant(tenantId))?.config?.googleSheets?.range,
          filters: search.filters,
          cache_policy: 'short_ttl',
        });
        matches.push({
          query: search.query,
          selected: catalog.rows[0] ?? null,
          alternatives: catalog.rows.slice(1, 2),
        });
      }
      const selectedRows = matches.map((match) => match.selected).filter(Boolean);
      const drive = await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
        file_ids: selectedRows.map((row) => row.driveFileId).filter(Boolean),
        refresh_mode: 'on_demand',
      });
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
    const drive = await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
      file_ids: selected?.driveFileId ? [selected.driveFileId] : [],
      refresh_mode: 'on_demand',
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
    const orderItems = [];
    for (const [index, item] of (plan.order?.items ?? []).entries()) {
      const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
        range: (await this.getTenant(tenantId))?.config?.googleSheets?.range,
        filters: deliveryItemFiltersFromPlan(plan, item, index),
        cache_policy: 'short_ttl',
      });
      const product = selectAcceptableOrderProduct(catalog.rows, item);
      orderItems.push({
        ...item,
        product,
        lineTotal: product && item.quantity ? product.price * item.quantity : product && item.budgetAmount ? item.budgetAmount : null,
        available: Boolean(product && product.stock >= (item.quantity ?? 1)),
      });
    }

    const currentConversation = await this.getConversation(conversationId);
    const previousDraft = currentConversation?.orderDraft;
    const effectiveOrderItems = previousDraft && isAdditiveOrderText(normalized.text)
      ? mergeOrderItems(previousDraft.items ?? [], orderItems)
      : orderItems;

    const selectedRows = effectiveOrderItems.map((item) => item.product).filter(Boolean);
    const drive = await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
      file_ids: selectedRows.map((row) => row.driveFileId).filter(Boolean),
      refresh_mode: 'on_demand',
      reason: selectedRows.length ? 'validate_order_product_files' : 'verify_catalog_context_for_missing_order_items',
    });

    const missingFields = [...(isAdditiveOrderText(normalized.text) ? previousDraft?.missingFields ?? [] : []), ...(plan.missingFields ?? [])];
    if (!effectiveOrderItems.length) missingFields.push('order_items');
    for (const item of effectiveOrderItems) {
      if (item.product) removeResolvedProductMissingFields(missingFields, item);
      if (item.budgetAmount) removeResolvedBudgetMissingFields(missingFields, item);
      if (!item.product) missingFields.push(`product:${item.catalogQuery}`);
      if (item.product && !item.available) missingFields.push(`stock:${item.catalogQuery}`);
      if (item.product && item.requestedPresentation && !productMatchesRequestedPresentation(item.product, item.requestedPresentation)) {
        missingFields.push(`product:${item.catalogQuery}`);
      }
    }

    const subtotal = effectiveOrderItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
    const requiresHumanResolution = needsHumanProductResolution(missingFields);
    const reply = requiresHumanResolution
      ? buildHumanResolutionReply({ orderItems: effectiveOrderItems, missingFields, customerProfile })
      : buildOrderReply({ orderItems: effectiveOrderItems, missingFields, customerProfile, subtotal });
    const canQuote = missingFields.length === 0;

    await this.patchConversation(conversationId, {
      stage: requiresHumanResolution ? 'handoff' : canQuote ? 'quote' : 'clarification',
      zone: requiresHumanResolution ? 'approval' : canQuote ? 'quote' : 'agent',
      status: requiresHumanResolution ? 'blocked' : 'live',
      value: canQuote ? formatCurrency(subtotal) : 'Pendiente',
      progress: requiresHumanResolution ? 58 : canQuote ? 64 : 42,
      need: normalized.text,
      nextStep: requiresHumanResolution ? 'Humano valida disponibilidad, sustituto o decision comercial.' : canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: 'google_drive_file_picker',
      orderDraft: {
        delivery: plan.order?.delivery ?? previousDraft?.delivery ?? false,
        items: effectiveOrderItems,
        missingFields: [...new Set(missingFields)],
        subtotal,
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
          summary: buildHumanResolutionSummary({ orderItems: effectiveOrderItems, missingFields, customerProfile, text: normalized.text }),
          orderItems: effectiveOrderItems,
          missingFields: [...new Set(missingFields)],
          customerProfile,
          driveStatus: drive.status,
          driveRefs: drive.source_refs ?? [],
          plan,
        },
      });
    }

    if (!customerProfile && canQuote && normalized.profileName) {
      await this.tools.call('google_sheets_customer_profile_upsert', tenantId, conversationId, {
        wa_id: normalized.waId,
        name: normalized.profileName ?? normalized.waId,
        defaultAddress: customerProfile?.defaultAddress,
        preferences: { channel: 'whatsapp', deliveryDefault: Boolean(plan.order?.delivery) },
      });
    }

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: reply,
    });

    return { summary: requiresHumanResolution ? 'Structured order escalated to human' : canQuote ? 'Structured order quote sent' : 'Structured order needs clarification', plan };
  }

  async handleOrderConfirmation({ tenantId, conversationId, normalized, plan, customerProfile }) {
    await this.usage?.assertCanRecordDelivery(tenantId, { conversationId });
    const orderDraft = plan.order;
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
        paymentMethod: orderDraft.paymentMethod ?? customerProfile?.preferredPaymentMethod ?? null,
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

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: `Pedido confirmado y registrado: ${formatOrderItems(confirmedItems)}. Dirección: ${deliveryAddress}. La tienda lo alista y coordina la entrega. Referencia: ${order.order.id}.`,
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
    const collected = extractClarification(normalized.text);
    let nextProfile = customerProfile;
    if (collected.paymentMethod) {
      draft.paymentMethod = collected.paymentMethod;
    }

    if (!nextProfile && (collected.name || collected.defaultAddress)) {
      const saved = await this.tools.call('google_sheets_customer_profile_upsert', tenantId, conversationId, {
        wa_id: normalized.waId,
        name: collected.name ?? normalized.profileName ?? normalized.waId,
        defaultAddress: collected.defaultAddress,
        addresses: collected.defaultAddress ? [{ label: 'principal', address: collected.defaultAddress }] : [],
        preferences: { channel: 'whatsapp', deliveryDefault: Boolean(draft.delivery) },
      });
      nextProfile = saved.profile;
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
    const reply = buildOrderReply({ orderItems: draft.items ?? [], missingFields: draft.missingFields, customerProfile: nextProfile, subtotal: draft.subtotal });

    await this.patchConversation(conversationId, {
      stage: canQuote ? 'quote' : 'clarification',
      zone: canQuote ? 'quote' : 'agent',
      status: 'live',
      value: canQuote ? formatCurrency(draft.subtotal) : 'Pendiente',
      progress: canQuote ? 64 : 48,
      nextStep: canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: collected.name || collected.defaultAddress ? 'google_sheets_customer_profile_upsert' : 'llm_core',
      orderDraft: draft,
    });

    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: reply,
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
      ? (currentState.ordersByTenant?.[currentRequest.tenantId] ?? []).find((item) => (
        item.id === currentRequest.contextSnapshot?.orderId || item.conversationId === currentRequest.conversationId
      ))
      : null;
    const orderStatus = outcome === 'approved' ? 'preparing' : 'cancelled';
    const sheetSync = currentOrder
      ? await this.tools.syncLiveOrderStatus({ tenantId: currentRequest.tenantId, order: currentOrder, status: orderStatus, updatedAt: now })
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
      if (currentOrder) {
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
        conversation.status = outcome === 'approved' ? 'live' : 'blocked';
        conversation.zone = outcome === 'approved' ? 'agent' : 'approval';
        conversation.progress = outcome === 'approved' ? Math.max(conversation.progress ?? 0, 78) : conversation.progress;
        conversation.nextStep = outcome === 'approved'
          ? 'Flujo reanudado con aprobacion humana.'
          : 'Operacion rechazada; revisar alternativa.';
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
    this.store.persistPendingRequest?.(requestId);
    this.store.persistConversation?.(request.conversationId);
    if (currentOrder) this.store.persistOrder?.(request.tenantId, currentOrder.id);
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
      this.store.persistPendingRequest?.(requestId);
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

  async ensureConversation(tenantId, normalized) {
    const existing = this.store.findConversationByWa
      ? await this.store.findConversationByWa(tenantId, normalized.waId)
      : this.store
        .getState()
        .conversations.find((item) => item.tenantId === tenantId && item.waId === normalized.waId && !isClosedCase(item));
    if (existing) return existing;

    const previous = this.store.findLatestConversationByWa
      ? await this.store.findLatestConversationByWa(tenantId, normalized.waId)
      : this.store
        .getState()
        .conversations
        .filter((item) => item.tenantId === tenantId && item.waId === normalized.waId)
        .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.createdAt ?? 0))[0];
    if (previous && isExplicitCaseContinuation(normalized.text, previous, this.config)) {
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
      this.store.persistConversation?.(previous.id);
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.store.mutate((state) => {
      state.conversations.unshift(created);
    });
    this.store.persistConversation?.(created.id);
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
    this.store.persistConversation?.(conversationId);
  }

  async patchConversation(conversationId, patch) {
    this.store.mutate((state) => {
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (conversation) Object.assign(conversation, patch, { updatedAt: new Date().toISOString() });
    });
    this.store.persistConversation?.(conversationId);
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
    this.store.persistConversation?.(conversationId);
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
      this.store.persistConversation?.(conversationId);
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
}

function isClosedCase(conversation) {
  return ['closed_no_confirmation', 'completed', 'resolved', 'cancelled'].includes(conversation?.caseStatus ?? conversation?.status);
}

function isExplicitCaseContinuation(text, previous, config = {}) {
  if (!isClosedCase(previous)) return false;
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
  const planned = (plan.toolPlan ?? []).find((step) =>
    step.tool === 'google_sheets_read_table' &&
    (step.candidateIndex === index || step.candidate === item.catalogQuery || step.candidate === item.rawName)
  );
  if (planned?.filters && Object.keys(planned.filters).length) return planned.filters;
  return item.skuHint ? { sku: item.skuHint } : inferCatalogFilter(item.catalogQuery ?? item.rawName);
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
  return rows.find((row) => isAcceptableOrderProduct(row, item));
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

function buildOrderReply({ orderItems, missingFields, customerProfile, subtotal }) {
  const uniqueMissing = [...new Set(missingFields)];
  const foundLines = orderItems
    .filter((item) => item.product)
    .map((item) => {
      const presentationMissing = uniqueMissing.find((missing) =>
        missing.startsWith('presentation:') && matchesMissingPresentation(item, missing.replace('presentation:', ''))
      );
      const name = presentationMissing ? item.rawName : item.product.name;
      if (item.budgetAmount) return `${formatCurrency(item.budgetAmount)} de ${name}`;
      return `${item.quantity ?? 'cantidad pendiente'} x ${name}`;
    });
  if (uniqueMissing.length) {
    const asks = [];
    if (uniqueMissing.includes('customer_name')) asks.push('tu nombre');
    if (uniqueMissing.includes('delivery_address')) asks.push('la direccion del domicilio');
    if (uniqueMissing.includes('order_items')) asks.push('que productos quieres pedir');
    for (const missing of uniqueMissing.filter((item) => item.startsWith('quantity:'))) {
      asks.push(`la cantidad de ${missing.replace('quantity:', '')}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('presentation:'))) {
      const query = missing.replace('presentation:', '');
      const item = orderItems.find((candidate) => matchesMissingPresentation(candidate, query));
      const options = item?.presentationOptions?.map((option) => option.name).filter(Boolean) ?? [];
      asks.push(options.length > 1
        ? `escoger la presentacion de ${query}: ${joinSpanish(options)}`
        : `confirmar la presentacion de ${query}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('product:'))) {
      asks.push(`una referencia mas clara para ${missing.replace('product:', '')}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('stock:'))) {
      asks.push(`confirmar alternativa para ${missing.replace('stock:', '')}`);
    }
    const prefix = foundLines.length ? `Claro. Tengo en la solicitud: ${foundLines.join(', ')}.` : 'Claro, te ayudo con el domicilio.';
    return `${prefix} Para continuar necesito ${joinSpanish(asks)}.`;
  }
  const address = customerProfile?.defaultAddress ? ` a tu direccion guardada (${customerProfile.defaultAddress})` : '';
  return `Listo. Te puedo preparar ${foundLines.join(', ')}${address}. Subtotal: ${formatCurrency(subtotal)}. ¿Confirmas el pedido?`;
}

function needsHumanProductResolution(missingFields) {
  return missingFields.some((field) =>
    field.startsWith('product:') ||
    field.startsWith('stock:')
  );
}

function productMatchesRequestedPresentation(product, requestedPresentation) {
  const requestedNumber = normalizeText(requestedPresentation).match(/\d{2,4}/)?.[0];
  if (!requestedNumber) return true;
  const fields = normalizeText([product.name, product.presentation, ...(product.aliases ?? [])].filter(Boolean).join(' '));
  return fields.includes(requestedNumber);
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

function extractClarification(text) {
  const value = String(text ?? '').trim();
  const name = value.match(/\b(?:me llamo|soy|mi nombre es|nombre)\s+([^,.]+)/i)?.[1]?.trim();
  const defaultAddress = value.match(/\b(?:direccion|dirección|dir)\s*(?:es|:)?\s+(.+)$/i)?.[1]?.trim();
  const quantity = Number(value.match(/^\s*(\d+)\b/)?.[1] ?? 0) || null;
  return {
    name,
    defaultAddress,
    quantity,
    paymentMethod: extractPaymentMethod(value),
    removeProductQuery: extractRemovalQuery(value),
  };
}

function extractPaymentMethod(text) {
  if (containsAny(text, ['datafono', 'datáfono', 'tarjeta debito', 'tarjeta débito', 'tarjeta'])) return 'card_terminal';
  if (containsAny(text, ['nequi'])) return 'nequi';
  if (containsAny(text, ['daviplata'])) return 'daviplata';
  if (containsAny(text, ['efectivo'])) return 'cash';
  return null;
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
