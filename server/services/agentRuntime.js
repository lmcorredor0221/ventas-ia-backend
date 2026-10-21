import { appendAuditEvent } from './authService.js';
import {
  advanceOrderDraft,
  catalogSearchTextForItem,
  isCurrentDraftVersion,
  nextInteractionMissingFields,
  requiredCustomerFields,
  resolveCatalogItem,
} from '../domain/semanticContracts.js';

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
      const result = await this.routeConversation(tenantId, conversation.id, normalized);
      this.events.emit({ type: 'agent.completed', tenantId, conversationId: conversation.id, detail: result.summary, metadata: { traceId: normalized.traceId, messageId: normalized.messageId } });
      return { duplicate: false, conversation: await this.getConversation(conversation.id), result };
    } catch (error) {
      this.events.emit({ type: 'agent.failed', tenantId, conversationId: conversation.id, detail: error.message, metadata: { traceId: normalized.traceId, messageId: normalized.messageId, errorCode: error.code ?? null } });
      await this.patchConversation(conversation.id, { status: 'degraded', zone: 'observability', nextStep: 'Revisar incidente y reintentar.' });
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
        const offeredRows = catalog.rows.slice(0, 2);
        this.recordCatalogDecision({
          tenantId,
          conversationId,
          traceId: normalized.traceId,
          query: search.query,
          rows: catalog.rows,
          selected: offeredRows[0] ?? null,
          presentedRows: offeredRows,
          decision: catalog.rows.length ? 'catalog_option_proposed' : 'catalog_no_match',
          reason: 'multi_query_catalog_lookup',
        });
        matches.push({
          query: search.query,
          selected: offeredRows[0] ?? null,
          alternatives: offeredRows.slice(1),
        });
      }
      const selectedRows = matches.map((match) => match.selected).filter(Boolean);
      const drive = await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
        file_ids: selectedRows.map((row) => row.driveFileId).filter(Boolean),
        refresh_mode: 'on_demand',
      });
      const quote = buildMultiCatalogReply({ matches, drive, delivery: Boolean(plan.order?.delivery) });
      const hasMatches = selectedRows.length > 0;
      const customerReply = await this.composeCustomerReply({
        tenantId,
        conversationId,
        fallbackText: quote,
        facts: { kind: 'catalog_options', products: selectedRows, requiredTerms: selectedRows.map(describeCatalogProduct) },
      });

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
        text: customerReply,
      });

      return { summary: hasMatches ? 'Catalog guided options sent' : 'Catalog search needs review', plan };
    }

    const search = enrichCatalogSearch(catalogSearches[0] ?? { query: text, filters: inferCatalogFilter(text) }, text);
    const query = search.query;
    const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
      range: (await this.getTenant(tenantId))?.config?.googleSheets?.range,
      filters: search.filters,
      cache_policy: 'short_ttl',
    });
    const categorySearch = isCategorySearch({ query, filters: search.filters, text });
    const presentedProducts = categorySearch
      ? selectCatalogOptions(catalog.rows, 4, { query, text, plan })
      : catalog.rows.slice(0, 4);
    const selected = presentedProducts[0] ?? null;
    const alternatives = presentedProducts.slice(1);
    this.recordCatalogDecision({
      tenantId,
      conversationId,
      traceId: normalized.traceId,
      query,
      rows: catalog.rows,
      selected,
      presentedRows: presentedProducts,
      decision: selected ? 'catalog_option_proposed' : 'catalog_no_match',
      reason: categorySearch ? 'category_or_occasion_lookup' : 'single_query_catalog_lookup',
    });
    const drive = await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
      file_ids: selected?.driveFileId ? [selected.driveFileId] : [],
      refresh_mode: 'on_demand',
    });

    const quote = selected
      ? buildCatalogReply({ selected, alternatives, drive, delivery: Boolean(plan.order?.delivery), categorySearch })
      : 'No encontre una coincidencia clara en el catalogo. Puedo pedir apoyo humano o buscar con mas detalles.';
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: quote,
      facts: {
        kind: categorySearch ? 'catalog_options' : 'catalog_quote',
        products: presentedProducts,
        requiredTerms: presentedProducts.map(describeCatalogProduct),
      },
    });

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
      text: customerReply,
    });

    return { summary: selected ? 'Catalog quote sent' : 'Catalog search needs review', plan };
  }

  async handleDeliveryOrder({ tenantId, conversationId, normalized, plan, customerProfile }) {
    const tenant = await this.getTenant(tenantId);
    const paymentMethods = paymentMethodsForTenant(tenant);
    const customerDelta = plan.semanticFrame?.customerDelta ?? {};
    const orderCustomer = {
      ...(customerProfile ?? {}),
      name: customerDelta.name ?? customerProfile?.name ?? null,
      defaultAddress: customerDelta.address ?? customerProfile?.defaultAddress ?? null,
    };
    const orderItems = [];
    for (const [index, item] of (plan.order?.items ?? []).entries()) {
      const catalog = await this.tools.call('google_sheets_read_table', tenantId, conversationId, {
        range: tenant?.config?.googleSheets?.range,
        filters: deliveryItemFiltersFromPlan(plan, item, index),
        cache_policy: 'short_ttl',
      });
      const rawItemId = item.rawItemId ?? `item-${index + 1}:${normalizeText(item.rawName ?? item.catalogQuery ?? '')}`;
      const resolution = resolveCatalogItem({ item: { ...item, rawItemId }, rows: catalog.rows });
      const product = resolution.status === 'resolved' ? resolution.product : null;
      this.recordCatalogDecision({
        tenantId,
        conversationId,
        traceId: normalized.traceId,
        rawItemId,
        query: catalogSearchTextForItem(item),
        rows: catalog.rows,
        selected: product,
        presentedRows: resolution.status === 'needs_selection'
          ? resolution.options.map((candidate) => candidate.product)
          : product ? [product] : [],
        decision: resolution.status,
        reason: resolution.reason,
      });
      orderItems.push({
        ...item,
        rawItemId,
        product,
        presentationOptions: resolution.status === 'needs_selection'
          ? resolution.options.map((candidate) => candidate.product)
          : [],
        resolution: {
          status: resolution.status,
          reason: resolution.reason,
          candidateCount: resolution.candidateSet.candidates.length,
        },
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
    const driveFileIds = [...new Set(selectedRows.map((row) => row.driveFileId).filter(Boolean))];
    const drive = driveFileIds.length
      ? await this.tools.call('google_drive_file_picker', tenantId, conversationId, {
        file_ids: driveFileIds,
        refresh_mode: 'on_demand',
        reason: 'validate_order_product_files',
      })
      : { status: 'not_requested', files: [], source_refs: [] };

    const missingFields = [
      ...(isAdditiveOrderText(normalized.text) ? previousDraft?.missingFields ?? [] : []),
      ...(plan.missingFields ?? []),
      ...requiredCustomerFields({
        requiredFields: tenant?.config?.orderPolicy?.customerRequiredFields,
        delivery: Boolean(plan.order?.delivery ?? plan.semanticFrame?.delivery),
        customerProfile,
        customerDelta,
      }),
    ];
    if (!effectiveOrderItems.length) missingFields.push('order_items');
    for (const item of effectiveOrderItems) {
      if (item.product) removeResolvedProductMissingFields(missingFields, item);
      if (item.budgetAmount) removeResolvedBudgetMissingFields(missingFields, item);
      if (!item.product) {
        if (item.resolution?.status === 'needs_selection') missingFields.push(`presentation:${item.rawItemId}`);
        else if (item.resolution?.reason === 'insufficient_stock') missingFields.push(`stock:${item.catalogQuery}`);
        else missingFields.push(`product:${item.catalogQuery}`);
      }
      if (item.product && !item.available) missingFields.push(`stock:${item.catalogQuery}`);
      if (item.product && hasExplicitPresentationMeasure(item.requestedPresentation) && !productMatchesRequestedPresentation(item.product, item.requestedPresentation)) {
        missingFields.push(`presentation:${item.catalogQuery}`);
      }
    }
    const paymentMethod = plan.order?.paymentMethod
      ?? previousDraft?.paymentMethod
      ?? orderCustomer.preferences?.preferredPaymentMethod
      ?? null;
    if (!paymentMethod) missingFields.push('payment_method');
    const normalizedMissingFields = dedupeOrderMissingFields(missingFields);

    const subtotal = effectiveOrderItems.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
    const requiresHumanResolution = needsHumanProductResolution(normalizedMissingFields);
    const replyMissingFields = nextInteractionMissingFields(normalizedMissingFields);
    const reply = requiresHumanResolution
      ? buildHumanResolutionReply({ orderItems: effectiveOrderItems, missingFields: normalizedMissingFields, customerProfile: orderCustomer })
      : buildOrderReply({ orderItems: effectiveOrderItems, missingFields: replyMissingFields, customerProfile: orderCustomer, subtotal, paymentMethods });
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: reply,
      facts: {
        kind: requiresHumanResolution ? 'human_resolution' : 'order_quote',
        products: effectiveOrderItems.map((item) => item.product).filter(Boolean),
        subtotal,
        paymentMethod,
        paymentMethods,
        missingFields: replyMissingFields,
        requiredTerms: [
          ...effectiveOrderItems.map((item) => item.product).filter(Boolean).map(describeCatalogProduct),
          ...replyMissingFields.filter((field) => ['customer_name', 'delivery_address'].includes(field)).map((field) => field === 'customer_name' ? 'nombre' : 'direccion'),
        ],
      },
    });
    const canQuote = normalizedMissingFields.length === 0;

    const nextDraft = advanceOrderDraft(previousDraft, {
      delivery: plan.order?.delivery ?? previousDraft?.delivery ?? false,
      items: effectiveOrderItems,
      missingFields: normalizedMissingFields,
      paymentMethod,
      paymentMethods,
      customerName: orderCustomer.name,
      deliveryAddress: orderCustomer.defaultAddress,
      driveRefs: drive.source_refs ?? [],
      driveStatus: drive.status,
    });
    await this.patchConversation(conversationId, {
      stage: requiresHumanResolution ? 'handoff' : canQuote ? 'quote' : 'clarification',
      zone: requiresHumanResolution ? 'approval' : canQuote ? 'quote' : 'agent',
      status: requiresHumanResolution ? 'blocked' : 'live',
      value: canQuote ? formatCurrency(subtotal) : 'Pendiente',
      progress: requiresHumanResolution ? 58 : canQuote ? 64 : 42,
      need: normalized.text,
      nextStep: requiresHumanResolution ? 'Humano valida disponibilidad, sustituto o decision comercial.' : canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: 'google_drive_file_picker',
      orderDraft: nextDraft,
    });
    this.recordOrderDraftTransition({
      tenantId,
      conversationId,
      traceId: normalized.traceId,
      draft: nextDraft,
      reason: 'catalog_resolution',
    });

    if (requiresHumanResolution) {
      await this.tools.call('human_handoff', tenantId, conversationId, {
        reason: 'Validar producto no encontrado, no inferible o sin stock',
        urgency: 'Alta',
        assigned_team: 'ventas',
        context_snapshot: {
          summary: buildHumanResolutionSummary({ orderItems: effectiveOrderItems, missingFields: normalizedMissingFields, customerProfile: orderCustomer, text: normalized.text }),
          orderItems: effectiveOrderItems,
          missingFields: normalizedMissingFields,
          customerProfile: orderCustomer,
          driveStatus: drive.status,
          driveRefs: drive.source_refs ?? [],
          plan,
        },
      });
    }

    if (!customerProfile && canQuote && customerDelta.name) {
      await this.tools.call('google_sheets_customer_profile_upsert', tenantId, conversationId, {
        wa_id: normalized.waId,
        name: customerDelta.name,
        defaultAddress: customerDelta.address ?? null,
        preferences: { channel: 'whatsapp', deliveryDefault: Boolean(plan.order?.delivery) },
      });
    }

    const selectionItem = effectiveOrderItems.find((item) => item.resolution?.status === 'needs_selection');
    const productSelectionOffer = !requiresHumanResolution && selectionItem
      ? await this.createProductSelectionOffer({
        tenantId,
        conversationId,
        item: selectionItem,
        draftVersion: nextDraft.version,
        body: customerReply,
      })
      : null;
    const paymentOffer = !requiresHumanResolution && !productSelectionOffer && replyMissingFields.includes('payment_method')
      ? await this.createPaymentOffer({ tenantId, conversationId, paymentMethods, body: customerReply, draftVersion: nextDraft.version })
      : null;
    const confirmationOffer = !requiresHumanResolution && !productSelectionOffer && canQuote
      ? await this.createConfirmationOffer({ tenantId, conversationId, body: customerReply, draftVersion: nextDraft.version })
      : null;
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: customerReply,
      ...((productSelectionOffer ?? confirmationOffer ?? paymentOffer) ? { interactive: (productSelectionOffer ?? confirmationOffer ?? paymentOffer).interactive } : {}),
    });

    return { summary: requiresHumanResolution ? 'Structured order escalated to human' : canQuote ? 'Structured order quote sent' : 'Structured order needs clarification', plan };
  }

  recordCatalogDecision({ tenantId, conversationId, traceId = null, rawItemId = null, query, rows = [], presentedRows = [], selected = null, decision, reason }) {
    const catalogEvidence = (catalogRows) => catalogRows.slice(0, 10).map((row) => ({
      sku: row.sku ?? null,
      name: row.name ?? null,
      presentation: row.presentation ?? null,
      price: Number(row.price ?? 0),
      matchScore: row.matchScore ?? null,
      matchType: row.matchType ?? null,
      stock: Number(row.stock ?? 0),
      active: row.active !== false,
      category: row.category ?? null,
      productFamily: row.productFamily ?? row.family ?? null,
      description: row.description ?? null,
      tags: row.tags ?? [],
    }));
    const candidates = catalogEvidence(rows);
    const presentedCandidates = catalogEvidence(presentedRows);
    this.events.emit({
      type: 'catalog.candidates.evaluated',
      tenantId,
      conversationId,
      detail: `${decision}: ${selected?.sku ?? 'none'}`,
      metadata: {
        traceId,
        rawItemId,
        query: String(query ?? '').slice(0, 240),
        decision,
        reason,
        selectedSku: selected?.sku ?? null,
        selectedName: selected?.name ?? null,
        candidateCount: rows.length,
        candidates,
        presentedCandidates,
      },
    });
  }

  recordOrderDraftTransition({ tenantId, conversationId, traceId = null, draft, reason }) {
    const items = (draft?.items ?? []).map((item) => ({
      rawItemId: item.rawItemId ?? null,
      sku: item.product?.sku ?? null,
      quantity: Number(item.quantity ?? 0) || null,
      lineTotal: Number(item.lineTotal ?? 0) || 0,
      resolution: item.resolution?.status ?? null,
    }));
    this.events.emit({
      type: 'order.draft.updated',
      tenantId,
      conversationId,
      detail: `${reason}: version ${Number(draft?.version ?? 0)}`,
      metadata: {
        traceId,
        reason,
        draftVersion: Number(draft?.version ?? 0),
        subtotal: Number(draft?.subtotal ?? 0),
        missingFields: draft?.missingFields ?? [],
        items,
      },
    });
  }

  async handleOrderConfirmation({ tenantId, conversationId, normalized, plan, customerProfile }) {
    const activeConversation = await this.getConversation(conversationId);
    const savedDraft = activeConversation?.orderDraft;
    const orderDraft = savedDraft ?? plan.order;
    const confirmationMissing = [...new Set([
      ...(orderDraft?.missingFields ?? []),
      ...(orderDraft?.paymentMethod ? [] : ['payment_method']),
    ])];
    if (confirmationMissing.length) {
      return this.handleOrderClarification({
        tenantId,
        conversationId,
        normalized,
        customerProfile,
        plan: {
          ...plan,
          intent: 'order_clarification',
          order: { ...orderDraft, missingFields: confirmationMissing },
        },
      });
    }
    await this.usage?.assertCanRecordDelivery(tenantId, { conversationId });
    const customerName = orderDraft.customerName ?? customerProfile?.name ?? normalized.profileName ?? normalized.waId;
    const deliveryAddress = orderDraft.deliveryAddress ?? customerProfile?.defaultAddress ?? 'Dirección pendiente por confirmar';
    const order = await this.tools.call('google_sheets_order_write', tenantId, conversationId, {
      wa_id: normalized.waId,
      customer_name: customerName,
      delivery_address: deliveryAddress,
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
    await this.tools.call('human_handoff', tenantId, conversationId, {
      reason: 'Alistar domicilio confirmado',
      urgency: 'Alta',
      assigned_team: 'operaciones',
      context_snapshot: {
        summary: 'Pedido confirmado por WhatsApp; requiere preparacion y entrega humana.',
        orderId: order.order.id,
        subtotal: orderDraft.subtotal,
        action: 'prepare_delivery_order',
        customerName,
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
    const activeConversation = await this.getConversation(conversationId);
    // El plan de aclaracion describe solo el ultimo mensaje. El pedido ya
    // resuelto (SKU, precio y cantidad) vive en la conversacion y no puede
    // sustituirse por la extraccion parcial que entregue el LLM.
    const draft = mergeClarificationOrderDraft(activeConversation?.orderDraft, plan.order, plan.missingFields);
    const collected = extractClarification(normalized.text);
    let nextProfile = customerProfile;
    const draftCustomer = {
      ...(customerProfile ?? {}),
      name: collected.name ?? draft.customerName ?? customerProfile?.name ?? null,
      defaultAddress: collected.defaultAddress ?? draft.deliveryAddress ?? customerProfile?.defaultAddress ?? null,
    };
    if (collected.paymentMethod) {
      draft.paymentMethod = collected.paymentMethod;
    }

    if (!nextProfile && draftCustomer.name && (!draft.delivery || draftCustomer.defaultAddress)) {
      const saved = await this.tools.call('google_sheets_customer_profile_upsert', tenantId, conversationId, {
        wa_id: normalized.waId,
        name: draftCustomer.name,
        defaultAddress: draftCustomer.defaultAddress,
        addresses: draftCustomer.defaultAddress ? [{ label: 'principal', address: draftCustomer.defaultAddress }] : [],
        preferences: { channel: 'whatsapp', deliveryDefault: Boolean(draft.delivery) },
      });
      nextProfile = saved.profile;
    }
    const profileForDraft = nextProfile ?? draftCustomer;

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
      if (field === 'customer_name') return !profileForDraft.name;
      if (field === 'delivery_address') return !profileForDraft.defaultAddress;
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

    const nextDraft = advanceOrderDraft(draft, {
      items: draft.items,
      missingFields: draft.missingFields,
      paymentMethod: draft.paymentMethod,
      paymentMethods: draft.paymentMethods,
      customerName: profileForDraft.name,
      deliveryAddress: profileForDraft.defaultAddress,
    });
    const canQuote = nextDraft.missingFields.length === 0;
    const tenant = await this.getTenant(tenantId);
    const paymentMethods = nextDraft.paymentMethods?.length ? nextDraft.paymentMethods : paymentMethodsForTenant(tenant);
    nextDraft.paymentMethods = paymentMethods;
    const replyMissingFields = nextInteractionMissingFields(nextDraft.missingFields);
    const reply = buildOrderReply({ orderItems: nextDraft.items ?? [], missingFields: replyMissingFields, customerProfile: profileForDraft, subtotal: nextDraft.subtotal, paymentMethods });
    const customerReply = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText: reply,
      facts: {
        kind: 'order_clarification',
        products: (nextDraft.items ?? []).map((item) => item.product).filter(Boolean),
        subtotal: nextDraft.subtotal,
        missingFields: replyMissingFields,
        requiredTerms: [
          ...(nextDraft.items ?? []).map((item) => item.product).filter(Boolean).map(describeCatalogProduct),
          ...replyMissingFields.filter((field) => ['customer_name', 'delivery_address'].includes(field)).map((field) => field === 'customer_name' ? 'nombre' : 'direccion'),
        ],
      },
    });

    await this.patchConversation(conversationId, {
      stage: canQuote ? 'quote' : 'clarification',
      zone: canQuote ? 'quote' : 'agent',
      status: 'live',
      value: canQuote ? formatCurrency(nextDraft.subtotal) : 'Pendiente',
      progress: canQuote ? 64 : 48,
      nextStep: canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: collected.name || collected.defaultAddress ? 'google_sheets_customer_profile_upsert' : 'llm_core',
      orderDraft: nextDraft,
    });
    this.recordOrderDraftTransition({
      tenantId,
      conversationId,
      traceId: normalized.traceId,
      draft: nextDraft,
      reason: 'customer_clarification',
    });

    const paymentOffer = replyMissingFields.includes('payment_method')
      ? await this.createPaymentOffer({ tenantId, conversationId, paymentMethods, body: customerReply, draftVersion: nextDraft.version })
      : null;
    const confirmationOffer = canQuote
      ? await this.createConfirmationOffer({ tenantId, conversationId, body: customerReply, draftVersion: nextDraft.version })
      : null;
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text: customerReply,
      ...((confirmationOffer ?? paymentOffer) ? { interactive: (confirmationOffer ?? paymentOffer).interactive } : {}),
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

  async createPaymentOffer({ tenantId, conversationId, paymentMethods, body, draftVersion = 0 }) {
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
      version: draftVersion,
      purpose: 'payment_method',
      options,
      expiresAt,
    });
    const interactiveBody = String(body ?? '¿Cómo prefieres pagar?').trim().slice(0, 1_024) || '¿Cómo prefieres pagar?';
    return {
      offer,
      interactive: options.length <= 3
        ? { kind: 'button', body: interactiveBody, buttons: options.map(({ id, title }) => ({ id, title })) }
        : {
          kind: 'list',
          body: interactiveBody,
          buttonLabel: 'Elegir pago',
          sectionTitle: 'Formas de pago',
          rows: options.map(({ id, title }) => ({ id, title })),
        },
    };
  }

  async createConfirmationOffer({ tenantId, conversationId, body, draftVersion = 0 }) {
    if (!this.store.createInteractionOffer) return null;
    const offerId = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const options = [
      { id: `vi:${offerId}:1`, title: 'Confirmar pedido', action: 'confirm_order', value: 'confirm' },
      { id: `vi:${offerId}:2`, title: 'Ajustar pedido', action: 'adjust_order', value: 'adjust' },
      { id: `vi:${offerId}:3`, title: 'Hablar con la tienda', action: 'human_handoff', value: 'human' },
    ];
    const offer = await this.store.createInteractionOffer({
      id: offerId,
      tenantId,
      conversationId,
      version: draftVersion,
      purpose: 'order_confirmation',
      options,
      expiresAt,
    });
    return {
      offer,
      interactive: {
        kind: 'button',
        body: String(body ?? '¿Confirmas el pedido?').trim().slice(0, 1_024) || '¿Confirmas el pedido?',
        buttons: options.map(({ id, title }) => ({ id, title })),
      },
    };
  }

  async createProductSelectionOffer({ tenantId, conversationId, item, draftVersion, body }) {
    const products = (item.presentationOptions ?? [])
      .filter((product) => product?.sku && product.active !== false && Number(product.stock ?? 0) >= Number(item.quantity ?? 1))
      .slice(0, 10);
    if (!this.store.createInteractionOffer || !products.length) return null;
    const offerId = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const options = products.map((product, index) => ({
      id: `vi:${offerId}:${index + 1}`,
      title: interactiveProductTitle(product),
      action: 'select_product_variant',
      value: product.sku,
      rawItemId: item.rawItemId,
      product,
    }));
    const offer = await this.store.createInteractionOffer({
      id: offerId,
      tenantId,
      conversationId,
      version: Number(draftVersion ?? 0),
      purpose: 'product_variant',
      rawItemId: item.rawItemId,
      options,
      expiresAt,
    });
    const interactiveBody = String(body ?? 'Elige la presentacion que prefieres.').trim().slice(0, 1_024) || 'Elige la presentacion que prefieres.';
    return {
      offer,
      interactive: options.length <= 3
        ? { kind: 'button', body: interactiveBody, buttons: options.map(({ id, title }) => ({ id, title })) }
        : {
          kind: 'list',
          body: interactiveBody,
          buttonLabel: 'Ver opciones',
          sectionTitle: 'Presentaciones disponibles',
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
      if (result.option?.action === 'select_product_variant') {
        return this.handleProductSelection({ tenantId, conversationId, normalized, result });
      }
      if (result.option?.action === 'confirm_order') {
        const conversation = await this.getConversation(conversationId);
        const customerProfile = await this.getCustomerProfile(tenantId, normalized.waId);
        return this.handleOrderConfirmation({
          tenantId,
          conversationId,
          normalized,
          customerProfile,
          plan: { intent: 'order_confirmation', order: conversation?.orderDraft ?? {} },
        });
      }
      if (result.option?.action === 'adjust_order') {
        await this.patchConversation(conversationId, {
          stage: 'clarification',
          zone: 'agent',
          status: 'live',
          nextStep: 'Esperar el ajuste que indique el cliente.',
        });
        await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
          action: 'send_session_message',
          wa_id: normalized.waId,
          text: 'Claro, dime qué producto, cantidad, dirección o forma de pago quieres ajustar.',
        });
        return { summary: 'Interactive order adjustment requested', interaction: result.option };
      }
      if (result.option?.action === 'human_handoff') {
        await this.tools.call('human_handoff', tenantId, conversationId, {
          reason: 'Cliente solicita hablar con la tienda antes de confirmar el pedido',
          urgency: 'Media',
          assigned_team: 'ventas',
          context_snapshot: { action: 'order_confirmation_support', interaction: result.option },
        });
        await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
          action: 'send_session_message',
          wa_id: normalized.waId,
          text: 'Listo, te conecto con la tienda para revisar el pedido contigo.',
        });
        return { summary: 'Interactive human handoff requested', interaction: result.option };
      }
      return this.replyToInvalidInteraction({ tenantId, conversationId, normalized, reason: 'Recibí tu selección. Escríbeme si quieres ajustar algo más.' });
    }
    const conversation = await this.getConversation(conversationId);
    const draft = structuredClone(conversation?.orderDraft ?? {});
    draft.paymentMethod = result.option.value;
    draft.missingFields = (draft.missingFields ?? []).filter((field) => field !== 'payment_method');
    const paymentLabel = paymentMethodLabel(result.option.value, draft.paymentMethods);
    const fallbackText = `Listo, queda ${paymentLabel} como forma de pago. ${draft.missingFields.length ? 'Aún necesito completar los datos pendientes para continuar.' : `El subtotal es ${formatCurrency(draft.subtotal ?? 0)}. ¿Confirmas el pedido?`}`;
    const nextDraft = advanceOrderDraft(draft, {
      paymentMethod: draft.paymentMethod,
      missingFields: draft.missingFields,
    });
    await this.patchConversation(conversationId, {
      orderDraft: nextDraft,
      stage: draft.missingFields.length ? 'clarification' : 'quote',
      zone: draft.missingFields.length ? 'agent' : 'quote',
      nextStep: draft.missingFields.length ? 'Solicitar datos faltantes antes de cotizar.' : 'Esperar confirmación del pedido.',
    });
    this.recordOrderDraftTransition({
      tenantId,
      conversationId,
      traceId: normalized.traceId,
      draft: nextDraft,
      reason: 'payment_selection',
    });
    const text = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText,
      facts: { kind: 'payment_selection', subtotal: draft.subtotal, requiredTerms: [paymentLabel] },
    });
    const confirmationOffer = nextDraft.missingFields.length
      ? null
      : await this.createConfirmationOffer({ tenantId, conversationId, body: text, draftVersion: nextDraft.version });
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text,
      ...(confirmationOffer ? { interactive: confirmationOffer.interactive } : {}),
    });
    return { summary: 'Interactive payment method recorded', interaction: result.option };
  }

  async handleProductSelection({ tenantId, conversationId, normalized, result }) {
    const conversation = await this.getConversation(conversationId);
    const draft = structuredClone(conversation?.orderDraft ?? {});
    if (!isCurrentDraftVersion(draft, result.offer?.version)) {
      return this.replyToInvalidInteraction({
        tenantId,
        conversationId,
        normalized,
        reason: 'Esa opcion corresponde a una version anterior del pedido. Te envio las opciones vigentes.',
      });
    }
    const rawItemId = result.option?.rawItemId;
    const selectedProduct = result.option?.product;
    const currentItem = (draft.items ?? []).find((item) => item.rawItemId === rawItemId);
    if (!rawItemId || !selectedProduct?.sku || !currentItem || Number(selectedProduct.stock ?? 0) < Number(currentItem.quantity ?? 1)) {
      return this.replyToInvalidInteraction({
        tenantId,
        conversationId,
        normalized,
        reason: 'Esa presentacion ya no esta disponible para este pedido. La tienda la revisara contigo.',
      });
    }
    const items = (draft.items ?? []).map((item) => item.rawItemId === rawItemId
      ? {
        ...item,
        product: selectedProduct,
        presentationOptions: [],
        resolution: { status: 'resolved', reason: 'interactive_customer_selection', candidateCount: 1 },
        lineTotal: selectedProduct.price * Number(item.quantity ?? 1),
        available: true,
      }
      : item);
    const missingFields = (draft.missingFields ?? []).filter((field) => field !== `presentation:${rawItemId}`);
    const nextDraft = advanceOrderDraft(draft, { items, missingFields });
    const tenant = await this.getTenant(tenantId);
    const paymentMethods = nextDraft.paymentMethods ?? paymentMethodsForTenant(tenant);
    nextDraft.paymentMethods = paymentMethods;
    const canQuote = nextDraft.missingFields.length === 0;
    const replyMissingFields = nextInteractionMissingFields(nextDraft.missingFields);
    const fallbackText = buildOrderReply({
      orderItems: nextDraft.items,
      missingFields: replyMissingFields,
      customerProfile: await this.getCustomerProfile(tenantId, normalized.waId),
      subtotal: nextDraft.subtotal,
      paymentMethods,
    });
    const text = await this.composeCustomerReply({
      tenantId,
      conversationId,
      fallbackText,
      facts: {
        kind: 'product_variant_selection',
        products: nextDraft.items.map((item) => item.product).filter(Boolean),
        subtotal: nextDraft.subtotal,
        missingFields: replyMissingFields,
        requiredTerms: nextDraft.items.map((item) => item.product).filter(Boolean).map(describeCatalogProduct),
      },
    });
    await this.patchConversation(conversationId, {
      orderDraft: nextDraft,
      stage: canQuote ? 'quote' : 'clarification',
      zone: canQuote ? 'quote' : 'agent',
      status: 'live',
      value: canQuote ? formatCurrency(nextDraft.subtotal) : 'Pendiente',
      progress: canQuote ? 64 : 48,
      nextStep: canQuote ? 'Esperar confirmacion del pedido.' : 'Solicitar datos faltantes antes de cotizar.',
      lastTool: 'catalog_variant_selection',
    });
    this.recordOrderDraftTransition({
      tenantId,
      conversationId,
      traceId: normalized.traceId,
      draft: nextDraft,
      reason: 'product_variant_selection',
    });
    const paymentOffer = !canQuote && replyMissingFields.includes('payment_method')
      ? await this.createPaymentOffer({ tenantId, conversationId, paymentMethods, body: text, draftVersion: nextDraft.version })
      : null;
    const confirmationOffer = canQuote
      ? await this.createConfirmationOffer({ tenantId, conversationId, body: text, draftVersion: nextDraft.version })
      : null;
    await this.tools.call('whatsapp_business_messaging', tenantId, conversationId, {
      action: 'send_session_message',
      wa_id: normalized.waId,
      text,
      ...((confirmationOffer ?? paymentOffer) ? { interactive: (confirmationOffer ?? paymentOffer).interactive } : {}),
    });
    return { summary: 'Interactive product variant selected', interaction: result.option };
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
    this.events.emit({
      type: 'reply.facts.prepared',
      tenantId,
      conversationId,
      detail: facts?.kind ?? 'customer_reply',
      metadata: { replyFacts: sanitizeReplyFacts(facts) },
    });
    const composed = await this.planner.composeReply({ tenantId, conversationId, facts, fallbackText });
    return composed.text ?? fallbackText;
  }

  async getTenant(tenantId) {
    if (this.store.getTenant) return this.store.getTenant(tenantId);
    return this.store.getState().tenants.find((item) => item.id === tenantId);
  }

  async getCustomerProfile(tenantId, waId) {
    if (this.store.getCustomerProfile) return this.store.getCustomerProfile(tenantId, waId);
    return this.store.getState().customerProfilesByTenant?.[tenantId]?.[waId] ?? null;
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
  const requestedQueries = uniqueCatalogQueries(catalogItems, text);
  const plannedSearches = (plan.toolPlan ?? [])
    .filter((step) => step.tool === 'google_sheets_read_table')
    .map((step, index) => ({
      query: step.candidate ?? step.query ?? step.filters?.query ?? step.filters?.category ?? text,
      plannerQuery: step.filters?.query ?? step.query ?? null,
      filters: step.filters,
      candidateIndex: step.candidateIndex ?? index,
    }))
    .filter((step) => step.filters && Object.keys(step.filters).length)
    .filter((step) => {
      // Una categoria es una restriccion, no otro producto. Tambien evitamos
      // que el modelo busque sustitutos que el cliente no pidio (p. ej.
      // "salmon" -> "saltin").
      // `candidate` can merely repeat "algo pa la sed" while the filter is
      // category-only. Treat it as a concrete lookup only when the planner
      // deliberately supplied a query filter.
      const explicitQuery = step.plannerQuery;
      const skuCandidate = step.candidate ?? step.query;
      if (step.filters?.sku) {
        return skuCandidate && isGroundedCatalogQuery(skuCandidate, requestedQueries);
      }
      return explicitQuery && isGroundedCatalogQuery(explicitQuery, requestedQueries);
    })
    .map((step) => ({
      ...step,
      filters: step.filters?.sku
        ? { ...(step.filters ?? {}) }
        : { ...(step.filters ?? {}), query: step.plannerQuery },
    }));
  if (plannedSearches.length) return dedupeCatalogSearches(plannedSearches);
  const fallbackItems = catalogItems.length ? catalogItems : [{ catalogQuery: text, rawName: text }];
  return fallbackItems.map((item, index) => {
    // La hipotesis del LLM orienta el significado, pero no puede reemplazar
    // las palabras del cliente al recuperar el catalogo. Asi "Savital" sigue
    // buscando Savital aunque el modelo lo clasifique equivocadamente.
    const query = catalogSearchTextForItem(item) || item.catalogQuery || item.rawName || text;
    const inferred = item.skuHint ? { sku: item.skuHint } : inferCatalogFilter(query);
    return {
      query,
      filters: inferred.query || item.skuHint || isCategoryQuery(query) ? inferred : { ...inferred, query },
      candidateIndex: index,
    };
  });
}

function uniqueCatalogQueries(catalogItems = [], text = '') {
  return [...new Set([
    ...catalogItems.flatMap((item) => [item?.catalogQuery, item?.rawName]),
    text,
  ].map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function dedupeCatalogSearches(searches = []) {
  const seen = new Set();
  return searches.filter((search) => {
    const key = `${normalizeText(search.filters?.query ?? search.query)}:${normalizeText(search.filters?.category)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isGroundedCatalogQuery(query, requestedQueries = []) {
  const queryTokens = catalogQueryTokens(query);
  if (!queryTokens.length) return false;
  const requestTokens = requestedQueries.flatMap(catalogQueryTokens);
  return queryTokens.some((token) => requestTokens.some((requested) =>
    token === requested ||
    token.startsWith(requested) ||
    requested.startsWith(token) ||
    (token.length >= 6 && requested.length >= 6 && levenshtein(token, requested) <= 1),
  ));
}

function catalogQueryTokens(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/(?:es|s)$/u, ''))
    .filter((token) => token.length >= 3 && !CATALOG_QUERY_STOPWORDS.has(token));
}

function enrichCatalogSearch(search, text) {
  const filters = { ...(search?.filters ?? {}) };
  // Category labels narrow the inventory, while the customer's full wording
  // ranks the useful references inside that category. A planner may return
  // only "aseo" even when the buyer explicitly said "papel y jabon".
  if (filters.category && !filters.query && !isCategoryQuery(search?.query ?? text)) filters.query = text;
  return {
    ...search,
    query: search?.query ?? filters.query ?? text,
    filters,
  };
}

function isCategorySearch({ query, filters = {}, text }) {
  // El LLM suele adjuntar una categoria para acotar una consulta concreta.
  // Eso no convierte "jabon para ropa" en una navegacion generica: la
  // respuesta debe priorizar su coincidencia, no opciones alfabeticas.
  return isCategoryQuery(query) || (isCategoryQuery(text) && catalogQueryTokens(query).length <= 2);
}

function selectCatalogOptions(rows = [], limit = 4, context = {}) {
  const budget = catalogRecommendationBudget(context);
  const eligibleRows = budget === null
    ? rows
    : rows.filter((row) => Number(row.price ?? 0) > 0 && Number(row.price) <= budget);
  const rankedRows = eligibleRows
    .map((row, index) => ({
      row,
      index,
      relevance: catalogOptionRelevance(row, context, budget),
    }))
    .sort((left, right) => (
      right.relevance - left.relevance ||
      Number(right.row.matchScore ?? 0) - Number(left.row.matchScore ?? 0) ||
      left.index - right.index
    ))
    .map(({ row }) => row);
  const selected = [];
  const seenBrands = new Set();
  const seenProducts = new Set();

  for (const row of rankedRows) {
    const productKey = normalizeText([row.name, row.presentation].filter(Boolean).join(' '));
    if (!productKey || seenProducts.has(productKey)) continue;
    const brandKey = normalizeText(row.brand);
    if (brandKey && seenBrands.has(brandKey) && selected.length < Math.min(3, limit)) continue;
    selected.push(row);
    seenProducts.add(productKey);
    if (brandKey) seenBrands.add(brandKey);
    if (selected.length >= limit) return selected;
  }

  for (const row of rankedRows) {
    const productKey = normalizeText([row.name, row.presentation].filter(Boolean).join(' '));
    if (!productKey || seenProducts.has(productKey)) continue;
    selected.push(row);
    seenProducts.add(productKey);
    if (selected.length >= limit) break;
  }
  return selected;
}

function catalogRecommendationBudget({ plan, text } = {}) {
  const explicitBudget = (plan?.order?.items ?? [])
    .map((item) => Number(item?.budgetAmount ?? 0))
    .find((value) => Number.isFinite(value) && value > 0);
  if (explicitBudget) return explicitBudget;

  const normalized = normalizeText(text);
  const numeric = normalized.match(/(?:tengo|presupuesto|hasta|por)\s+(\d{1,3}(?:\s?\d{3})+|\d{4,7})\b/u);
  if (numeric) return Number(numeric[1].replace(/\s/g, ''));
  const words = normalized.match(/\b(un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+mil\b/u);
  if (!words) return null;
  const thousands = {
    un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };
  return (thousands[words[1]] ?? 0) * 1000 || null;
}

function catalogOptionRelevance(row, { query, text } = {}, budget = null) {
  const normalizedText = normalizeText([query, text].filter(Boolean).join(' '));
  const productTerms = normalizeText([
    row.name,
    row.brand,
    ...(row.aliases ?? []),
    row.productFamily,
  ].filter(Boolean).join(' '));
  const supportingTerms = normalizeText([
    row.category,
    row.presentation,
    row.normalizedPresentation,
    row.description,
    ...(row.tags ?? []),
  ].filter(Boolean).join(' '));
  let score = Number(row.matchScore ?? 0) * 2;

  for (const token of catalogQueryTokens(normalizedText)) {
    if (productTerms.split(' ').includes(token)) score += 9;
    else if (supportingTerms.split(' ').includes(token)) score += 4;
  }

  const has = (terms) => containsAny(normalizedText, terms);
  const productHas = (terms) => containsAny(`${productTerms} ${supportingTerms}`, terms);
  if (has(['sed', 'calor', 'frio', 'fria', 'tomar']) && productHas(['bebida', 'gaseosa', 'jugo', 'agua', 'hidratante', 'malta', 'te'])) score += 12;
  if (has(['once', 'lonchera', 'refrigerio']) && productHas(['galleta', 'ponque', 'chocolate', 'jugo', 'fruta', 'pan', 'arepa'])) score += 12;
  if (has(['antojo', 'dulce', 'mecato', 'snack', 'picar']) && productHas(['galleta', 'ponque', 'chocolate', 'dulce', 'pasaboca', 'papas', 'snack'])) score += 12;
  if (has(['desayuno']) && productHas(['pan', 'arepa', 'leche', 'cereal', 'avena', 'huevo', 'queso'])) score += 12;
  if (has(['aseo', 'limpieza', 'papel', 'jabon', 'lavar']) && productHas(['papel', 'jabon', 'detergente', 'lavaloza', 'limpieza', 'shampoo'])) score += 10;
  if (has(['mercado', 'despensa']) && productHas(['arroz', 'aceite', 'huevo', 'pasta', 'grano', 'harina'])) score += 10;
  if (!has(['mascota', 'perro', 'gato']) && productHas(['mascota', 'perro', 'gato', 'concentrado', 'arena'])) score -= 100;
  if (budget !== null && Number(row.price ?? 0) > budget) score -= 100;
  return score;
}

function deliveryItemFiltersFromPlan(plan, item, index) {
  // El interprete solo propone significado. La consulta real no hereda SKU ni
  // filtros de una respuesta LLM: se arma desde el item semantico y se limita
  // al catalogo del tenant dentro de la herramienta.
  const query = catalogSearchTextForItem(item);
  if (item.categoryHint && (!query || isCategoryQuery(query) || normalizeText(query) === normalizeText(item.categoryHint))) {
    return { category: item.categoryHint };
  }
  const inferred = inferCatalogFilter(query);
  return inferred.query || !query || isCategoryQuery(query) ? inferred : { ...inferred, query };
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

function dedupeOrderMissingFields(missingFields = []) {
  const result = [];
  for (const field of missingFields.filter(Boolean)) {
    const value = String(field);
    const [kind, ...rest] = value.split(':');
    const subject = rest.join(':');
    const duplicate = result.some((existing) => {
      const [existingKind, ...existingRest] = String(existing).split(':');
      if (existingKind !== kind) return false;
      const existingSubject = existingRest.join(':');
      if (!subject || !existingSubject) return value === existing;
      return orderMissingSubjectsMatch(subject, existingSubject);
    });
    if (!duplicate) result.push(value);
  }
  return result;
}

function orderMissingSubjectsMatch(left, right) {
  const leftTokens = catalogQueryTokens(left);
  const rightTokens = catalogQueryTokens(right);
  if (!leftTokens.length || !rightTokens.length) return normalizeText(left) === normalizeText(right);
  const shared = leftTokens.filter((token) => rightTokens.some((other) => (
    token === other ||
    (token.length >= 6 && other.length >= 6 && levenshtein(token, other) <= 1)
  )));
  return shared.length >= (leftTokens.length === 1 || rightTokens.length === 1 ? 1 : 2);
}

function mergeClarificationOrderDraft(previousDraft, nextOrder = {}, planMissingFields = []) {
  const previous = structuredClone(previousDraft ?? {});
  const proposedItems = structuredClone(nextOrder?.items ?? []);
  const previousItems = previous.items ?? [];
  const mergedItems = previousItems.length
    ? previousItems.map((savedItem) => {
      const proposed = proposedItems.find((candidate) => orderItemsReferToSameProduct(savedItem, candidate));
      if (!proposed) return savedItem;
      return {
        ...proposed,
        ...savedItem,
        rawName: proposed.rawName ?? savedItem.rawName,
        catalogQuery: proposed.catalogQuery ?? savedItem.catalogQuery,
        quantity: proposed.quantity ?? savedItem.quantity,
        product: savedItem.product ?? proposed.product ?? null,
        presentationOptions: savedItem.presentationOptions ?? proposed.presentationOptions ?? [],
        lineTotal: savedItem.lineTotal ?? proposed.lineTotal ?? null,
        available: savedItem.available ?? proposed.available ?? false,
      };
    })
    : proposedItems;
  const missingFields = [...new Set([
    ...(previous.missingFields ?? []),
    ...(nextOrder?.missingFields ?? []),
    ...(planMissingFields ?? []),
  ])];
  const subtotal = mergedItems.reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0);
  return {
    ...nextOrder,
    ...previous,
    items: mergedItems,
    missingFields,
    paymentMethod: nextOrder?.paymentMethod ?? previous.paymentMethod ?? null,
    paymentMethods: previous.paymentMethods ?? nextOrder?.paymentMethods ?? [],
    subtotal,
  };
}

function orderItemsReferToSameProduct(left = {}, right = {}) {
  const leftTokens = uniqueCatalogQueries([left], '').flatMap(catalogQueryTokens);
  const rightTokens = uniqueCatalogQueries([right], '').flatMap(catalogQueryTokens);
  return leftTokens.some((token) => rightTokens.some((other) =>
    token === other || token.startsWith(other) || other.startsWith(token),
  ));
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
  // Las marcas, aliases y typos viven en datos del catalogo del tenant. Aqui
  // solo queda la taxonomia generica para solicitudes por categoria u ocasion.
  if (containsAny(normalized, ['bebida', 'bebidas', 'sed', 'tomar', 'gaseosa', 'frio', 'fria'])) return { category: 'bebidas' };
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
  const candidates = rows.filter((row) => isAcceptableOrderProduct(row, item));
  if (!candidates.length) return null;
  if (hasExplicitPresentationMeasure(item.requestedPresentation)) {
    return candidates.find((row) => productMatchesRequestedPresentation(row, item.requestedPresentation)) ?? null;
  }
  const contextualIntent = contextualPresentationIntent(item.requestedPresentation);
  if (contextualIntent) return selectRelativePresentationCandidate(candidates, contextualIntent);
  return candidates[0];
}

export function selectDistinctOrderProduct(rows = [], item = {}, resolvedItems = []) {
  const selectedSkusForOtherRequests = new Set(
    resolvedItems
      .filter((resolved) => resolved?.product?.sku && !sameRequestedProduct(resolved, item))
      .map((resolved) => resolved.product.sku),
  );
  return selectAcceptableOrderProduct(
    rows.filter((row) => !selectedSkusForOtherRequests.has(row?.sku)),
    item,
  );
}

function presentationOptionsForItem(rows = [], item = {}, selectedProduct = null) {
  const candidates = [selectedProduct, ...rows]
    .filter(Boolean)
    .filter((row) => isAcceptableOrderProduct(row, item));
  const familyTokens = productFamilyTokens(item, selectedProduct);
  const relevant = familyTokens.length
    ? candidates.filter((row) => productFamilyTokens({}, row).some((token) => familyTokens.includes(token)))
    : candidates;
  const unique = new Map();
  for (const product of relevant) {
    const key = product.sku ?? `${product.name}:${product.presentation ?? ''}`;
    if (!unique.has(key)) unique.set(key, product);
  }
  return [...unique.values()]
    .sort((left, right) => Number(right.sku === selectedProduct?.sku) - Number(left.sku === selectedProduct?.sku))
    .slice(0, 4);
}

function hasUnresolvedPresentationForItem(missingFields = [], item = {}, rows = [], selectedProduct = null) {
  const references = [item.rawName, item.catalogQuery]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const plannerRequestedClarification = (missingFields ?? [])
    .filter((field) => String(field).startsWith('presentation:'))
    .map((field) => normalizeText(String(field).replace('presentation:', '')))
    .filter(Boolean)
    .some((missing) => references.some((reference) => (
      reference === missing || reference.includes(missing) || missing.includes(reference)
    )));
  if (!plannerRequestedClarification) return false;
  // La duda del planner no debe bloquear una referencia que el catálogo
  // resuelve de manera única, ni una medida que el comprador ya indicó.
  if (hasExplicitPresentationMeasure(item.requestedPresentation)) return false;
  const options = presentationOptionsForItem(rows, item, selectedProduct);
  const distinctPresentations = new Set(options.map((option) => normalizeText(option.presentation ?? option.normalizedPresentation ?? option.name)));
  return distinctPresentations.size > 1;
}

function productFamilyTokens(item = {}, product = {}) {
  const ignored = new Set(['gaseosa', 'bebida', 'bebidas', 'producto', 'presentacion', 'litro', 'litros', 'mililitro', 'mililitros', 'original']);
  return [...new Set(normalizeText([
    item.rawName,
    item.catalogQuery,
    product?.productFamily,
    product?.name,
    product?.brand,
    product?.description,
    ...(product?.tags ?? []),
    ...(product?.aliases ?? []),
  ].filter(Boolean).join(' ')).split(/\s+/).filter((token) => token.length >= 4 && !ignored.has(token)))];
}

function isAcceptableOrderProduct(product, item = {}) {
  if (!product) return false;
  const query = normalizeText([item.rawName, item.catalogQuery, item.requestedPresentation].filter(Boolean).join(' '));
  const productText = normalizeText([
    product.name,
    product.brand,
    product.category,
    product.presentation,
    product.normalizedPresentation,
    product.productFamily,
    product.description,
    ...(product.tags ?? []),
    ...(product.aliases ?? []),
  ].filter(Boolean).join(' '));
  if (containsAny(query, ['cerveza', 'club colombia', 'sixpack', 'six pack']) && !containsAny(productText, ['cerveza', 'club colombia'])) return false;
  if (containsAny(query, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos']) && !containsAny(productText, ['marlboro', 'malboro', 'cigarrillo', 'cigarrillos'])) return false;
  if (containsAny(query, ['salchichon', 'salchicha']) && !containsAny(productText, ['salchicha', 'salchichon', 'carnes frias'])) return false;
  const requestedTokens = productRequestTokens(query);
  if (requestedTokens.length) {
    const productTokens = productText.split(/[^a-z0-9]+/).filter(Boolean);
    const matchedTokens = requestedTokens.filter((token) => productTokens.some((candidate) => (
      candidate === token || maybeRelatedProductToken(token, candidate)
    )));
    const requiredMatches = requestedTokens.length === 1
      ? 1
      : Math.min(requestedTokens.length, Math.max(2, Math.ceil(requestedTokens.length * 0.75)));
    if (matchedTokens.length < requiredMatches) return false;
  }
  if (product.matchType === 'similar' && Number(product.matchScore ?? 0) <= 2) {
    const productTokens = new Set(productText.split(/\s+/).filter((token) => token.length >= 4));
    const queryTokens = query.split(/\s+/).filter((token) => token.length >= 4);
    return queryTokens.some((token) => productTokens.has(token));
  }
  return true;
}

function sameRequestedProduct(left = {}, right = {}) {
  const leftSku = normalizeText(left.skuHint);
  const rightSku = normalizeText(right.skuHint);
  if (leftSku && rightSku) return leftSku === rightSku;
  const leftTerms = requestTerms(left);
  const rightTerms = requestTerms(right);
  return leftTerms.some((leftTerm) => rightTerms.some((rightTerm) => (
    leftTerm === rightTerm || leftTerm.includes(rightTerm) || rightTerm.includes(leftTerm)
  )));
}

function requestTerms(item = {}) {
  return [...new Set([
    item.rawName,
    item.catalogQuery,
    item.skuHint,
    item.product?.name,
    ...(item.product?.aliases ?? []),
  ].map((value) => normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim())
    .filter((value) => value.length >= 3))];
}

function productRequestTokens(query) {
  const ignored = new Set([
    'para', 'domicilio', 'quiero', 'quieres', 'regalas', 'regalame', 'mandame', 'manda', 'llevar', 'entrega',
    'grande', 'familiar', 'personal', 'individual', 'compartir', 'casa', 'medio', 'media', 'kilo', 'litro',
    'unidad', 'unidades', 'botella', 'paquete', 'producto', 'favor', 'por', 'con', 'sin', 'del', 'una', 'uno',
  ]);
  return [...new Set(normalizeText(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !ignored.has(token) && !/^\d/.test(token)))];
}

function maybeRelatedProductToken(requested, candidate) {
  if (requested === candidate) return true;
  if (requested.length < 5 || candidate.length < 5) return false;
  if (requested.startsWith(candidate.slice(0, 5)) || candidate.startsWith(requested.slice(0, 5))) return true;
  return requested[0] === candidate[0] && editDistanceAtMostTwo(requested, candidate);
}

function editDistanceAtMostTwo(left, right) {
  if (Math.abs(left.length - right.length) > 2) return false;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    let minimum = previous[0];
    for (let column = 1; column <= right.length; column += 1) {
      const current = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + Number(left[row - 1] !== right[column - 1]),
      );
      diagonal = current;
      minimum = Math.min(minimum, previous[column]);
    }
    if (minimum > 2) return false;
  }
  return previous[right.length] <= 2;
}

function describeCatalogProduct(product = {}) {
  const name = String(product.name ?? '').trim();
  const presentation = String(product.presentation ?? '').trim();
  if (!presentation || normalizeText(name).includes(normalizeText(presentation))) return name;
  return `${name} (${presentation})`;
}

function buildCatalogReply({ selected, alternatives, drive, delivery, categorySearch = false }) {
  const categoryOptions = [selected, ...alternatives];
  if (categoryOptions.length > 1 && categorySearch) {
    const options = categoryOptions
      .map((item) => `${describeCatalogProduct(item)} (${formatCurrency(item.price)}, stock ${item.stock})`)
      .join('; ');
    const deliveryAsk = delivery ? ' ¿Cual quieres y cuantas unidades para el domicilio?' : ' ¿Cual quieres que te cotice?';
    return `Tenemos estas opciones: ${options}.${deliveryAsk}`;
  }
  const matchIntro = selected.matchType === 'similar'
    ? `No encontre exacto, pero el mas cercano es ${describeCatalogProduct(selected)}`
    : `Tengo disponible ${describeCatalogProduct(selected)}`;
  const deliveryAsk = delivery ? ' ¿Cuantas unidades quieres para el domicilio?' : ' ¿Quieres que te cotice una cantidad?';
  const alternativeText = alternatives.length
    ? ` Tambien podria ofrecerte: ${alternatives.map(describeCatalogProduct).join(', ')}.`
    : '';
  return `${matchIntro} por ${formatCurrency(selected.price)}. Stock actual: ${selected.stock}.${alternativeText}${deliveryAsk}`;
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
    .map((match) => `${describeCatalogProduct(match.selected)} (${formatCurrency(match.selected.price)}, stock ${match.selected.stock})`);
  const alternatives = found
    .flatMap((match) => match.alternatives ?? [])
    .filter((item) => item && !seen.has(item.sku))
    .slice(0, 2)
    .map(describeCatalogProduct);

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

function buildOrderReply({ orderItems, missingFields, customerProfile, subtotal, paymentMethods = [] }) {
  const uniqueMissing = [...new Set(missingFields)];
  const foundLines = orderItems
    .filter((item) => item.product)
    .map((item) => {
      const presentationMissing = uniqueMissing.find((missing) =>
        missing.startsWith('presentation:') && matchesMissingPresentation(item, missing.replace('presentation:', ''))
      );
      const name = presentationMissing ? item.rawName : describeCatalogProduct(item.product);
      if (item.budgetAmount) return `${formatCurrency(item.budgetAmount)} de ${name}`;
      return `${item.quantity ?? 'cantidad pendiente'} x ${name}`;
    });
  if (uniqueMissing.length) {
    const asks = [];
    const presentationNotes = [];
    if (uniqueMissing.includes('customer_name')) asks.push('tu nombre');
    if (uniqueMissing.includes('delivery_address')) asks.push('la direccion del domicilio');
    if (uniqueMissing.includes('payment_method')) {
      asks.push(`cómo prefieres pagar${paymentMethods.length ? `: ${joinSpanish(paymentMethods.map((method) => method.label))}` : ''}`);
    }
    if (uniqueMissing.includes('order_items')) asks.push('que productos quieres pedir');
    for (const missing of uniqueMissing.filter((item) => item.startsWith('quantity:'))) {
      asks.push(`la cantidad de ${missing.replace('quantity:', '')}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('presentation:'))) {
      const query = missing.replace('presentation:', '');
      const item = orderItems.find((candidate) => matchesMissingPresentation(candidate, query));
      const options = item?.presentationOptions ?? [];
      if (!options.length) {
        asks.push(`confirmar la presentacion de ${query}`);
        continue;
      }
      const requestedName = requestedProductName(item, query);
      const requested = item?.requestedPresentation ? `Pediste ${requestedName} de ${item.requestedPresentation}.` : `Para ${requestedName},`;
      presentationNotes.push(`${requested} Tengo ${joinSpanish(options.map(describeProductOption))}. ¿Cuál prefieres?`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('product:'))) {
      asks.push(`una referencia mas clara para ${missing.replace('product:', '')}`);
    }
    for (const missing of uniqueMissing.filter((item) => item.startsWith('stock:'))) {
      asks.push(`confirmar alternativa para ${missing.replace('stock:', '')}`);
    }
    const subtotalText = foundLines.length && Number.isFinite(Number(subtotal)) && Number(subtotal) > 0
      ? ` Subtotal de productos: ${formatCurrency(subtotal)}.`
      : '';
    const prefix = foundLines.length
      ? `Claro. Tengo en la solicitud: ${foundLines.join(', ')}.${subtotalText}`
      : 'Claro, te ayudo con el domicilio.';
    const presentationText = presentationNotes.length ? ` ${presentationNotes.join(' ')}` : '';
    const dataAsk = asks.length ? ` Para continuar necesito ${joinSpanish(asks)}.` : '';
    return `${prefix}${presentationText}${dataAsk}`;
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
  const requestedVolume = presentationVolumeInMilliliters(requestedPresentation);
  const productVolume = presentationVolumeInMilliliters([product.name, product.presentation, product.normalizedPresentation, ...(product.aliases ?? [])].filter(Boolean).join(' '));
  if (requestedVolume && productVolume) return requestedVolume === productVolume;
  const requestedNumber = normalizeText(requestedPresentation).match(/\d{2,4}/)?.[0];
  if (!requestedNumber) return true;
  const fields = normalizeText([product.name, product.presentation, ...(product.aliases ?? [])].filter(Boolean).join(' '));
  return fields.includes(requestedNumber);
}

function hasExplicitPresentationMeasure(value) {
  return Boolean(presentationMeasure(value));
}

function contextualPresentationIntent(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (containsAny(normalized, ['familiar', 'compartir', 'para la casa', 'hogar'])) return 'larger';
  if (containsAny(normalized, ['personal', 'individual', 'para mi', 'para mí', 'lonchera', 'para llevar'])) return 'smaller';
  if (containsAny(normalized, ['grande', 'grandecito', 'grandeza'])) return 'larger';
  if (containsAny(normalized, ['pequeno', 'pequeño', 'pequena', 'pequeña', 'mini'])) return 'smaller';
  return null;
}

function selectRelativePresentationCandidate(candidates = [], intent) {
  const measured = candidates
    .map((product) => ({ product, measure: presentationMeasure(product.normalizedPresentation ?? product.presentation ?? product.name) }))
    .filter((candidate) => candidate.measure);
  if (measured.length !== candidates.length || measured.length < 2) return measured.length === 1 && candidates.length === 1 ? measured[0].product : null;
  const dimensions = new Set(measured.map((candidate) => candidate.measure.dimension));
  if (dimensions.size !== 1) return null;
  const sorted = [...measured].sort((left, right) => intent === 'larger'
    ? right.measure.value - left.measure.value
    : left.measure.value - right.measure.value);
  if (sorted[0].measure.value === sorted[1].measure.value) return null;
  return sorted[0].product;
}

function presentationMeasure(value) {
  const normalized = normalizeText(value)
    .replace(/\b(?:un|una)\s+litro y medio\b/g, '1 5 l')
    .replace(/\bmedio kilo\b/g, '500 g')
    .replace(/\bmedio litro\b/g, '0 5 l');
  const countMatch = normalized.match(/\bx\s*(\d{1,3})\b/);
  if (countMatch) return { dimension: 'count', value: Number(countMatch[1]) };
  const match = normalized.match(/(\d+(?:\s+\d+)?(?:[.,]\d+)?)\s*(ml|mililitros?|l|litros?|g|gr|gramos?|kg|kilogramos?|und|unidades?|rollos?)\b/);
  if (!match) return null;
  const unit = match[2];
  const raw = Number(match[1].replace(',', '.').replace(/\s+/, '.'));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  if (/^(ml|mililitros?|l|litros?)$/.test(unit)) {
    return { dimension: 'volume', value: Math.round(/^(l|litros?)$/.test(unit) ? raw * 1000 : raw) };
  }
  if (/^(g|gr|gramos?|kg|kilogramos?)$/.test(unit)) {
    return { dimension: 'weight', value: Math.round(/^(kg|kilogramos?)$/.test(unit) ? raw * 1000 : raw) };
  }
  return { dimension: 'count', value: raw };
}

function presentationVolumeInMilliliters(value) {
  const normalized = normalizeText(value)
    .replace(/\b(?:(?:un|una)\s+)?litro y medio\b/g, '1 5 l')
    .replace(/\bmedio litro\b/g, '0 5 l');
  const match = normalized.match(/(\d+(?:\s+\d+)?)\s*(ml|mililitros?|l|litros?)\b/);
  if (!match) return null;
  const quantity = Number(match[1].replace(/\s+/, '.'));
  if (!Number.isFinite(quantity)) return null;
  return Math.round(match[2].startsWith('l') ? quantity * 1000 : quantity);
}

function describeProductOption(product) {
  const name = String(product?.name ?? 'Producto').trim();
  const presentation = String(product?.presentation ?? '').trim();
  const includesPresentation = presentation && normalizeText(name).includes(normalizeText(presentation));
  const label = presentation && !includesPresentation ? `${name}, ${presentation}` : name;
  return `${label} (${formatCurrency(product?.price ?? 0)})`;
}

function requestedProductName(item, fallback) {
  const raw = String(item?.rawName ?? fallback ?? '').trim();
  if (!item?.requestedPresentation) return raw || fallback;
  const withoutPresentation = raw
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|mililitros?|l|litros?)\b/gi, '')
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
  return item.rawItemId === query ||
    normalizeText(item.rawName) === normalizedQuery ||
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
  if (containsAny(text, ['bre-b', 'breb', 'bre b'])) return 'bre_b';
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
function sanitizeReplyFacts(facts = {}) {
  return {
    kind: facts.kind ?? null,
    products: (facts.products ?? facts.items ?? []).slice(0, 10).map((item) => ({
      sku: item?.sku ?? item?.product?.sku ?? null,
      name: item?.name ?? item?.product?.name ?? null,
      presentation: item?.presentation ?? item?.product?.presentation ?? null,
      price: Number(item?.price ?? item?.product?.price ?? 0) || null,
    })),
    subtotal: facts.subtotal ?? null,
    paymentMethod: facts.paymentMethod ?? null,
    paymentMethods: (facts.paymentMethods ?? []).map((method) => ({ id: method?.id ?? null, label: method?.label ?? null })),
    missingFields: facts.missingFields ?? [],
    requiredTerms: facts.requiredTerms ?? [],
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
}

function interactiveProductTitle(product) {
  const name = String(product?.name ?? 'Producto').trim();
  const presentation = String(product?.presentation ?? product?.normalizedPresentation ?? '').trim();
  const price = Number(product?.price ?? 0);
  const detail = [presentation, price > 0 ? formatCurrency(price) : null].filter(Boolean).join(' - ');
  return detail ? `${name} ${detail}`.slice(0, 72) : name.slice(0, 72);
}

export function paymentMethodsForTenant(tenant) {
  const configured = tenant?.config?.paymentMethods
    ?? tenant?.config?.orderPolicy?.paymentMethods
    ?? [];
  const methods = Array.isArray(configured) ? configured : [];
  const normalized = methods
    .filter((method) => method && method.enabled !== false)
    .map((method) => typeof method === 'string'
      ? { id: normalizePaymentMethodId(method), label: paymentMethodLabel(method) }
      : { id: normalizePaymentMethodId(method.id ?? method.key ?? method.label), label: method.label ?? paymentMethodLabel(method.id ?? method.key) })
    .filter((method) => method.id && method.label);
  const unique = new Map();
  for (const method of normalized) {
    if (!unique.has(method.id)) unique.set(method.id, method);
  }
  const configuredMethods = [...unique.values()];
  return configuredMethods.length ? configuredMethods : [
    { id: 'cash', label: 'Efectivo' },
    { id: 'card_terminal', label: 'Tarjeta' },
    { id: 'bre_b', label: 'Bre-B' },
  ];
}

function normalizePaymentMethodId(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (['efectivo', 'cash'].includes(normalized)) return 'cash';
  if (['tarjeta', 'datafono', 'card', 'card_terminal'].includes(normalized)) return 'card_terminal';
  if (['bre_b', 'breb'].includes(normalized)) return 'bre_b';
  return normalized;
}

function paymentMethodLabel(value, configured = []) {
  const configuredMatch = (configured ?? []).find((method) => method.id === value || method.value === value);
  if (configuredMatch?.label) return configuredMatch.label;
  if (value === 'cash') return 'Efectivo';
  if (value === 'card_terminal') return 'Tarjeta';
  if (value === 'bre_b') return 'Bre-B';
  if (value === 'nequi') return 'Nequi';
  if (value === 'daviplata') return 'Daviplata';
  return String(value ?? 'la forma de pago');
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

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length][b.length];
}

const CATALOG_QUERY_STOPWORDS = new Set([
  'para', 'con', 'sin', 'que', 'una', 'uno', 'unos', 'unas', 'por', 'favor',
  'regala', 'regalame', 'manda', 'mandame', 'quiero', 'necesito', 'tengo',
  'domicilio', 'pedido', 'producto', 'productos', 'algo', 'ayuda',
  'marca', 'sabor', 'tipo',
]);
