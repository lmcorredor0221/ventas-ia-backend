import { canTransition, assertOrderStatus, ORDER_STATUSES } from '../domain/orderStatus.js';
import { EDITABLE_ORDER_STATUSES, assertOrderEditVersion, orderCommercialFields } from '../domain/orderEdit.js';
import { deliveryPolicyForTenant, deliveryPolicyRevision, deliveryBasketRevision, evaluateDeliveryPolicy, assertDeliveryPricing } from '../domain/deliveryPolicy.js';
import { normalizePaymentMethodId, paymentMethodsForTenant } from '../domain/paymentMethods.js';
import { catalogCommerceCategory, assertCommerceOrderAllowed } from '../domain/whatsappCommercePolicy.js';

const editError = (message, code = 'invalid_order_edit', statusCode = 422) => Object.assign(new Error(message), { code, statusCode });

export class OrderService {
  constructor({ store, events, tools, outbox = null }) {
    this.store = store;
    this.events = events;
    this.tools = tools;
    this.outbox = outbox;
    this.transitionLocks = new Map();
  }

  findOrder(orderId, tenantId) {
    const state = this.store.getState();
    return Object.values(state.ordersByTenant ?? {})
      .flat()
      .find((order) => order.id === orderId && (!tenantId || order.tenantId === tenantId)) ?? null;
  }

  async catalogForEditing(tenantId) {
    const result = await this.tools.googleSheetsReadTable(tenantId, { filters: {}, cache_policy: 'short_ttl' });
    if (result.status !== 'success') throw editError('No pudimos cargar el catálogo. Puedes reintentar sin perder el pedido.', 'order_catalog_unavailable', 503);
    return (result.rows ?? []).filter(row => row.active !== false && !catalogCommerceCategory(row)).map(row => ({
      sku: String(row.sku), name: row.name, presentation: row.presentation ?? '', description: row.description ?? '',
      brand: row.brand ?? '', price: Number(row.price), stock: row.stock == null ? null : Number(row.stock),
      category: row.category ?? '', productFamily: row.productFamily ?? '', normalizedPresentation: row.normalizedPresentation ?? '',
      attributes: structuredClone(row.attributes ?? {}), tags: structuredClone(row.tags ?? []), active: row.active !== false,
      allowsSaleByAmount: row.allowsSaleByAmount === true,
    }));
  }

  async workspace({ orderId, tenantId, includeCatalog = true }) {
    const order = this.store.getOrder ? await this.store.getOrder(tenantId, orderId) : this.findOrder(orderId, tenantId);
    if (!order) throw editError('Pedido no encontrado.', 'order_not_found', 404);
    const conversation = await this.store.getConversation?.(order.conversationId)
      ?? this.store.getState().conversations?.find(item => item.id === order.conversationId && item.tenantId === tenantId);
    const tenant = this.store.getState().tenants.find(item => item.id === tenantId);
    const effectiveOrder = { ...order, status: this.effectiveStatus(order) };
    const canEdit = EDITABLE_ORDER_STATUSES.includes(effectiveOrder.status);
    const [notification] = await this.store.listOutbox?.({ tenantId, aggregateId: orderId, kind: 'order.summary_notification', limit: 1 }) ?? [];
    return { order: effectiveOrder, canEdit,
      summaryNotification: notification?.payload?.version === order.version ? {
        status: notification.result?.status ?? notification.payload?.result?.status ?? notification.status, version: order.version,
      } : null,
      conversation: conversation?.tenantId === tenantId ? { id: conversation.id, customer: conversation.customer,
        waId: conversation.waId, messages: conversation.messages ?? [], status: conversation.status } : null,
      products: canEdit && includeCatalog ? await this.catalogForEditing(tenantId) : [],
      paymentMethods: paymentMethodsForTenant(tenant), deliveryPolicy: deliveryPolicyForTenant(tenant) };
  }

  async manualOrderContext({ conversationId, tenantId }) {
    const conversation = this.store.getConversation
      ? await this.store.getConversation(conversationId)
      : this.store.getState().conversations?.find((item) => item.id === conversationId);
    if (!conversation || conversation.tenantId !== tenantId) throw editError('Conversación no encontrada.', 'conversation_not_found', 404);
    const existing = this.findOrder(conversation.orderId, tenantId)
      ?? (this.store.getState().ordersByTenant?.[tenantId] ?? []).find((item) => item.conversationId === conversationId);
    if (existing) return { conversation: manualConversationSnapshot(conversation), order: existing, products: [], paymentMethods: [], deliveryPolicy: deliveryPolicyForTenant(this.store.getState().tenants.find((item) => item.id === tenantId)) };
    const tenant = this.store.getState().tenants.find((item) => item.id === tenantId);
    const profile = this.store.getState().customerProfilesByTenant?.[tenantId]?.[conversation.waId] ?? null;
    const draft = manualDraftFromConversation(conversation, profile);
    return {
      conversation: manualConversationSnapshot(conversation),
      draft,
      products: await this.catalogForEditing(tenantId),
      paymentMethods: paymentMethodsForTenant(tenant),
      deliveryPolicy: deliveryPolicyForTenant(tenant),
    };
  }

  async createManualOrder({ conversationId, tenantId, input, actorId = 'local-owner' }) {
    const conversation = this.store.getConversation
      ? await this.store.getConversation(conversationId)
      : this.store.getState().conversations?.find((item) => item.id === conversationId);
    if (!conversation || conversation.tenantId !== tenantId) throw editError('Conversación no encontrada.', 'conversation_not_found', 404);
    if (this.findOrder(conversation.orderId, tenantId) || (this.store.getState().ordersByTenant?.[tenantId] ?? []).some((item) => item.conversationId === conversationId)) {
      throw editError('Esta conversación ya tiene un pedido registrado.', 'manual_order_already_exists', 409);
    }
    if (input?.customerConfirmed !== true) throw editError('Confirma que acordaste el pedido con el cliente.');
    const customerName = String(input.customerName ?? '').trim();
    const deliveryAddress = String(input.deliveryAddress ?? '').trim();
    if (!customerName || customerName.length > 160 || !deliveryAddress || deliveryAddress.length > 500) {
      throw editError('Revisa el nombre y la dirección del cliente.');
    }
    const tenant = this.store.getState().tenants.find((item) => item.id === tenantId);
    const payment = paymentMethodsForTenant(tenant).find((method) => method.id === normalizePaymentMethodId(input.paymentMethod));
    if (!payment) throw editError('Selecciona un medio de pago habilitado por tu tienda.');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw editError('El pedido debe tener entre 1 y 100 productos.');
    const products = await this.catalogForEditing(tenantId);
    const seen = new Set();
    const items = input.items.map((line) => {
      const product = products.find((item) => item.sku === line?.sku);
      if (!product || seen.has(line.sku)) throw editError('Hay un producto no disponible o repetido. Revisa el catálogo.');
      seen.add(line.sku);
      const quantity = Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 999) throw editError(`Revisa la cantidad de ${product.name}.`);
      if (!Number.isSafeInteger(product.price) || product.price <= 0) throw editError(`El producto ${product.name} no tiene un precio válido.`);
      if (!Number.isFinite(product.stock) || product.stock < quantity) throw editError(`No hay existencias suficientes de ${product.name}.`);
      if (line.unitPrice !== undefined && Number(line.unitPrice) !== product.price) throw editError(`Cambió el precio de ${product.name}. Recarga el pedido y revisa el total.`, 'order_price_changed', 409);
      return { sku: product.sku, name: product.name, presentation: product.presentation, unitPrice: product.price,
        quantity, saleMode: 'units', requestedAmount: null, allowsSaleByAmount: product.allowsSaleByAmount,
        lineTotal: product.price * quantity };
    });
    assertCommerceOrderAllowed(items, products);
    const delivery = input.delivery !== false;
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const policy = deliveryPolicyForTenant(tenant);
    const exception = delivery && policy.deliveryMinimumSubtotal != null && subtotal < policy.deliveryMinimumSubtotal;
    const reason = String(input.minimumExceptionReason ?? '').trim();
    if (exception && (input.minimumException !== true || !reason)) {
      throw editError('El pedido no alcanza el mínimo. Autoriza la excepción e indica el acuerdo con el cliente.', 'delivery_minimum_exception_required', 409);
    }
    const pricing = evaluateDeliveryPolicy({ tenant, items: items.map((item) => ({ ...item, product: products.find((product) => product.sku === item.sku) })),
      delivery, draftVersion: 1, resolution: exception ? {
        authorized: true, requestId: `manual-order:${conversationId}:1`, actorId, tenantId,
        policyRevision: deliveryPolicyRevision(tenant), basketRevision: deliveryBasketRevision(items),
        deliveryFee: policy.deliveryFee, minimumSubtotal: policy.deliveryMinimumSubtotal, minimumException: true, reason,
      } : null });
    assertDeliveryPricing(pricing);
    const now = new Date().toISOString();
    const order = { id: `ord-${crypto.randomUUID().slice(0, 10)}`, tenantId, conversationId, waId: conversation.waId,
      customerName, deliveryAddress: delivery ? deliveryAddress : '', items, subtotal, pricing, delivery,
      paymentMethod: payment.id, paymentMethodLabel: payment.label, status: 'pending_human_preparation', version: 1,
      createdAt: now, updatedAt: now, statusHistory: [{ status: 'pending_human_preparation', at: now, actorId, source: 'manual_conversation' }],
      sheetSyncStatus: this.outbox ? 'queued' : 'not_queued', manualSource: 'human_handoff' };
    const sheetEntry = this.createOrderSheetCreateEntry(order);
    this.store.mutate((state) => {
      state.ordersByTenant ??= {};
      state.ordersByTenant[tenantId] ??= [];
      state.ordersByTenant[tenantId].unshift(order);
      const current = state.conversations.find((item) => item.id === conversationId);
      if (current) {
        current.orderId = order.id;
        current.orderStatus = order.status;
        current.status = 'blocked';
        current.zone = 'approval';
        current.stage = 'handoff';
        current.nextStep = 'Pedido armado por la tienda; pendiente de tomar para alistamiento.';
        current.updatedAt = now;
      }
    });
    if (this.store.persistNewOrderWithOutbox) await this.store.persistNewOrderWithOutbox(order, [sheetEntry].filter(Boolean));
    else {
      await this.store.persistOrder?.(tenantId, order.id);
      if (sheetEntry) await this.store.enqueueOutbox?.(sheetEntry);
    }
    await this.store.persistConversation?.(conversationId);
    this.events?.emit({ type: 'order.manual_created', tenantId, conversationId, detail: `Pedido manual ${order.id} creado`, metadata: { orderId: order.id, actorId } });
    return { order, projection: sheetEntry ? 'queued' : 'not_queued' };
  }

  createOrderSheetCreateEntry(order) {
    if (!this.outbox) return null;
    return this.outbox.createEntry({ tenantId: order.tenantId, kind: 'order.sheet_create', aggregateType: 'order', aggregateId: order.id,
      idempotencyKey: `order-sheet-create:${order.id}`, payload: { tenantId: order.tenantId, orderId: order.id,
        conversationId: order.conversationId, traceId: this.store.getState().conversations?.find((item) => item.id === order.conversationId)?.traceId ?? null } });
  }

  async edit({ orderId, tenantId, input, actorId }) {
    // Share the lock with status transitions, including dispatch. PostgreSQL
    // also compares the version under a row lock across different processes.
    const key = `${tenantId}:${orderId}`;
    const previous = this.transitionLocks.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this.editUnlocked({ orderId, tenantId, input, actorId }));
    this.transitionLocks.set(key, operation);
    try { return await operation; }
    finally { if (this.transitionLocks.get(key) === operation) this.transitionLocks.delete(key); }
  }

  async editUnlocked({ orderId, tenantId, input, actorId }) {
    const current = this.store.getOrder ? await this.store.getOrder(tenantId, orderId) : this.findOrder(orderId, tenantId);
    assertOrderEditVersion(current && { ...current, status: this.effectiveStatus(current) }, input.expectedVersion);
    if (input.customerConfirmed !== true) throw editError('Confirma que acordaste estos cambios con el cliente.');
    const customerName = String(input.customerName ?? '').trim();
    const deliveryAddress = String(input.deliveryAddress ?? '').trim();
    const reason = String(input.reason ?? '').trim();
    if (!customerName || customerName.length > 160 || deliveryAddress.length > 500 || reason.length > 500
      || typeof input.delivery !== 'boolean' || (input.delivery && !deliveryAddress)) {
      throw editError('Revisa el nombre del cliente, la modalidad y la dirección de entrega.');
    }
    const tenant = structuredClone(this.store.getTenant ? await this.store.getTenant(tenantId) : this.store.getState().tenants.find(item => item.id === tenantId));
    const payment = paymentMethodsForTenant(tenant).find(method => method.id === normalizePaymentMethodId(input.paymentMethod));
    if (!payment) throw editError('Selecciona un medio de pago habilitado por tu tienda.');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw editError('El pedido debe tener entre 1 y 100 productos.');
    const products = await this.catalogForEditing(tenantId);
    if (input.items.some(item => !item || typeof item.sku !== 'string' || !['units', 'amount', undefined].includes(item.saleMode))) throw editError('Revisa los productos y su modalidad de venta.');
    const seen = new Set();
    const items = input.items.map(line => {
      const product = products.find(item => item.sku === line.sku);
      if (!product || seen.has(line.sku)) throw editError('Hay un producto no disponible o repetido. Revisa el catálogo.');
      seen.add(line.sku);
      const old = current.items.find(item => item.sku === line.sku);
      // Retain agreed prices for existing lines; new products use the catalog.
      const unitPrice = old?.unitPrice ?? product.price;
      if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) throw editError('Hay un producto sin precio válido.');
      if (line.unitPrice !== unitPrice) throw editError(`Cambió el precio de ${product.name}. Recarga el pedido y revisa el total.`, 'order_price_changed', 409);
      const amountSale = line.saleMode === 'amount';
      if (amountSale && (!product.allowsSaleByAmount || line.quantity != null || !Number.isSafeInteger(line.requestedAmount) || line.requestedAmount <= 0)) throw editError('Este producto no permite ese importe de venta.');
      if (!amountSale && (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > 999)) throw editError(`Revisa la cantidad de ${product.name}.`);
      if (!Number.isFinite(product.stock) || product.stock <= 0 || (!amountSale && product.stock < line.quantity)) throw editError(`No hay existencias suficientes de ${product.name}.`);
      return { sku: product.sku, name: product.name, presentation: product.presentation, unitPrice,
        quantity: amountSale ? null : line.quantity, saleMode: amountSale ? 'amount' : 'units',
        requestedAmount: amountSale ? line.requestedAmount : null, allowsSaleByAmount: product.allowsSaleByAmount,
        lineTotal: amountSale ? line.requestedAmount : unitPrice * line.quantity };
    });
    assertCommerceOrderAllowed(items, products);
    if (!Number.isSafeInteger(input.deliveryFee) || input.deliveryFee < 0) throw editError('Escribe el costo del domicilio en pesos, sin decimales.');
    const policy = deliveryPolicyForTenant(tenant);
    const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);
    const exception = input.delivery && policy.deliveryMinimumSubtotal != null && subtotal < policy.deliveryMinimumSubtotal;
    if (exception && (input.minimumException !== true || !reason)) throw editError('El pedido no alcanza el mínimo. Si acuerdas una excepción con el cliente, autorízala e indica el motivo.', 'delivery_minimum_exception_required', 409);
    const resolution = { authorized: true, requestId: `order-edit:${orderId}:${input.expectedVersion + 1}`, actorId,
      tenantId, policyRevision: deliveryPolicyRevision(tenant), basketRevision: deliveryBasketRevision(items),
      deliveryFee: input.delivery ? input.deliveryFee : 0, minimumSubtotal: policy.deliveryMinimumSubtotal ?? 0,
      minimumException: exception, reason };
    const pricing = assertDeliveryPricing(evaluateDeliveryPolicy({ tenant, items, delivery: input.delivery,
      draftVersion: input.expectedVersion + 1, resolution }));
    if (input.expectedTotal !== pricing.total) throw editError('El total cambió. Revisa el desglose antes de guardar.', 'order_total_changed', 409);
    const now = new Date().toISOString();
    const order = { ...structuredClone(current), items, subtotal, pricing, delivery: input.delivery,
      customerName, deliveryAddress: input.delivery ? deliveryAddress : '', paymentMethod: payment.id, paymentMethodLabel: payment.label,
      version: input.expectedVersion + 1, updatedAt: now, sheetSyncStatus: this.outbox ? 'pending' : 'not_queued' };
    order.editHistory = [...(current.editHistory ?? []), { at: now, actorId, reason, customerConfirmed: true,
      version: order.version, before: orderCommercialFields(current), after: orderCommercialFields(order) }];
    const entry = this.outbox?.createEntry({ tenantId, kind: 'order.sheet_edit', aggregateType: 'order', aggregateId: orderId,
      idempotencyKey: `order-sheet-edit:${orderId}:${order.version}`, payload: { tenantId, orderId, version: order.version } });
    const notification = this.outbox?.enabled ? this.outbox.createEntry({ tenantId, kind: 'order.summary_notification',
      aggregateType: 'order', aggregateId: orderId, idempotencyKey: `order-summary:${orderId}:${order.version}`,
      payload: { tenantId, orderId, version: order.version } }) : null;
    await this.store.commitOrderEdit({ order, expectedVersion: input.expectedVersion,
      entries: [entry, notification].filter(Boolean), catalogProducts: products });
    return { order, notification: notification ? 'queued' : 'not_queued', projection: this.outbox ? 'queued' : 'not_queued' };
  }

  effectiveStatus(order, requests = this.store.getState().pendingRequests ?? []) {
    if (!order) return null;
    const status = order.status ?? ORDER_STATUSES.PENDING_HUMAN_PREPARATION;
    if (status !== ORDER_STATUSES.PENDING_HUMAN_PREPARATION) return status;
    const decision = requests.find((request) => (
      request.tenantId === order.tenantId
      && (request.contextSnapshot?.orderId === order.id || request.conversationId === order.conversationId)
      && (request.action === 'prepare_delivery_order'
        || request.contextSnapshot?.action === 'prepare_delivery_order'
        || request.assignedTeam === 'operaciones'
        || /pedido|domicilio/i.test(request.title ?? ''))
      && ['resolved', 'denied'].includes(request.status)
    ));
    return decision?.status === 'resolved'
      ? ORDER_STATUSES.PREPARING
      : decision?.status === 'denied'
        ? ORDER_STATUSES.CANCELLED
        : status;
  }

  pendingPreparationRequest(order, requests = this.store.getState().pendingRequests ?? []) {
    return requests.find((request) => (
      request.tenantId === order.tenantId
      && request.status === 'pending'
      && (request.contextSnapshot?.orderId === order.id || request.conversationId === order.conversationId)
      && (request.action === 'prepare_delivery_order'
        || request.contextSnapshot?.action === 'prepare_delivery_order'
        || request.assignedTeam === 'operaciones'
        || /pedido|domicilio/i.test(request.title ?? ''))
    )) ?? null;
  }

  async transition(args) {
    const key = `${args.tenantId ?? 'unknown'}:${args.orderId}`;
    const previous = this.transitionLocks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chain = previous.catch(() => {}).then(() => gate);
    this.transitionLocks.set(key, chain);
    await previous.catch(() => {});
    try {
      return await this.transitionUnlocked(args);
    } finally {
      release();
      if (this.transitionLocks.get(key) === chain) this.transitionLocks.delete(key);
    }
  }

  async transitionUnlocked({ orderId, tenantId, nextStatus, actorId = 'system', source = 'system', traceId = null, allowPendingRequest = false }) {
    const order = this.findOrder(orderId, tenantId);
    if (!order) {
      const error = new Error('Pedido no encontrado.');
      error.statusCode = 404;
      error.code = 'order_not_found';
      throw error;
    }
    const previousStatus = this.effectiveStatus(order);
    assertOrderStatus(nextStatus);
    if (!canTransition(previousStatus, nextStatus)) {
      const error = new Error('Este pedido cambió de etapa. Actualiza la pantalla antes de continuar.');
      error.statusCode = 409;
      error.code = 'order_transition_conflict';
      throw error;
    }
    const pendingRequest = this.pendingPreparationRequest(order);
    if (pendingRequest && !allowPendingRequest) {
      const error = new Error('Este pedido tiene una tarea pendiente. Tómalo desde esa tarjeta.');
      error.statusCode = 409;
      error.code = 'order_pending_human_request';
      throw error;
    }

    const now = new Date().toISOString();
    // Persist the operational transition before asking any external provider to
    // mirror it. This keeps the tendero's queue usable during a Sheets outage.
    const sheetSync = { provider: 'google_sheets', status: this.outbox ? 'queued' : 'not_queued' };
    const sheetProjectionEntry = this.createSheetProjectionEntry({ order, nextStatus, now, traceId });
    const dispatchNotificationEntry = nextStatus === ORDER_STATUSES.DISPATCHED
      ? this.createDispatchNotificationEntry({ order, now, traceId })
      : null;
    let updatedOrder;
    this.store.mutate((state) => {
      updatedOrder = (state.ordersByTenant?.[order.tenantId] ?? []).find((item) => item.id === order.id);
      if (!updatedOrder) return;
      updatedOrder.status = nextStatus;
      updatedOrder.version = Number(updatedOrder.version ?? 0) + 1;
      updatedOrder.updatedAt = now;
      updatedOrder.statusHistory = [...(updatedOrder.statusHistory ?? []), { status: nextStatus, at: now, actorId, source }];
      // The UI historically uses `pending` for a local change that still needs
      // a Google projection. Keep that public field compatible while exposing
      // the precise provider result in the transition metadata.
      updatedOrder.sheetSyncStatus = sheetSync.status === 'synced' ? 'synced' : 'pending';
      if (sheetSync.status === 'synced') updatedOrder.sheetSyncedAt = now;
      const conversation = state.conversations?.find((item) => item.id === updatedOrder.conversationId);
      if (conversation && previousStatus === ORDER_STATUSES.PENDING_HUMAN_PREPARATION && nextStatus === ORDER_STATUSES.PREPARING) {
        conversation.status = 'live';
        conversation.zone = 'agent';
        conversation.nextStep = 'Pedido tomado por la tienda para alistar.';
        conversation.updatedAt = now;
      }
      if (conversation && nextStatus === ORDER_STATUSES.DISPATCHED) {
        conversation.status = 'completed';
        conversation.caseStatus = 'completed';
        conversation.stage = 'closed';
        conversation.zone = 'completed';
        conversation.nextStep = 'Pedido en camino; el siguiente mensaje iniciara una conversacion nueva.';
        conversation.updatedAt = now;
        updatedOrder.dispatchNotification = {
          ...(updatedOrder.dispatchNotification ?? {}),
          status: 'queued',
          queuedAt: now,
        };
      }
    });
    if (this.store.persistOrderWithOutbox) {
      await this.store.persistOrderWithOutbox(
        order.tenantId,
        order.id,
        [sheetProjectionEntry, dispatchNotificationEntry].filter(Boolean),
      );
    } else {
      await this.store.persistOrder?.(order.tenantId, order.id);
      if (sheetProjectionEntry) await this.store.enqueueOutbox?.(sheetProjectionEntry);
      if (dispatchNotificationEntry) await this.store.enqueueOutbox?.(dispatchNotificationEntry);
    }
    if (previousStatus === ORDER_STATUSES.PENDING_HUMAN_PREPARATION || nextStatus === ORDER_STATUSES.DISPATCHED) {
      await this.store.persistConversation?.(order.conversationId);
    }
    const event = this.events?.emitAndWait
      ? await this.events.emitAndWait({
      type: `order.${nextStatus}`,
      tenantId: order.tenantId,
      conversationId: order.conversationId,
      detail: `Pedido ${order.id}: ${nextStatus}`,
      metadata: { orderId: order.id, actorId, source, traceId, previousStatus, projectionStatus: sheetSync.status },
      })
      : this.events?.emit({
        type: `order.${nextStatus}`,
        tenantId: order.tenantId,
        conversationId: order.conversationId,
        detail: `Pedido ${order.id}: ${nextStatus}`,
        metadata: { orderId: order.id, actorId, source, traceId, previousStatus, projectionStatus: sheetSync.status },
      });
    return {
      order: updatedOrder,
      previousStatus,
      status: nextStatus,
      projection: { provider: 'google_sheets', status: sheetSync.status },
      notification: dispatchNotificationEntry ? { provider: 'whatsapp', status: 'queued' } : null,
      eventId: event?.id ?? null,
    };
  }

  createSheetProjectionEntry({ order, nextStatus, now, traceId }) {
    if (!this.outbox) return null;
    return this.outbox.createEntry({
      tenantId: order.tenantId,
      kind: 'order.sheet_projection',
      aggregateType: 'order',
      aggregateId: order.id,
      idempotencyKey: `order-sheet:${order.id}:${nextStatus}`,
      payload: {
        tenantId: order.tenantId,
        orderId: order.id,
        conversationId: order.conversationId,
        status: nextStatus,
        updatedAt: now,
        traceId,
      },
    });
  }

  createDispatchNotificationEntry({ order, now, traceId }) {
    if (!this.outbox) return null;
    return this.outbox.createEntry({
      tenantId: order.tenantId,
      kind: 'order.dispatch_notification',
      aggregateType: 'order',
      aggregateId: order.id,
      idempotencyKey: `order-dispatch-notification:${order.id}`,
      payload: {
        tenantId: order.tenantId,
        orderId: order.id,
        conversationId: order.conversationId,
        waId: order.waId,
        queuedAt: now,
        traceId,
      },
    });
  }
}

function manualConversationSnapshot(conversation) {
  return {
    id: conversation.id,
    customer: conversation.customer ?? conversation.profileName ?? conversation.waId,
    waId: conversation.waId,
    status: conversation.status,
    stage: conversation.stage ?? null,
    messages: (conversation.messages ?? []).slice(-30),
  };
}

function manualDraftFromConversation(conversation, profile) {
  const draft = conversation.orderDraft ?? {};
  const items = (draft.items ?? []).map((item) => ({
    sku: item.product?.sku ?? item.sku ?? item.skuHint ?? null,
    quantity: Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 1,
  })).filter((item) => item.sku);
  return {
    customerName: String(draft.customerName ?? conversation.customer ?? profile?.name ?? '').trim(),
    deliveryAddress: String(draft.deliveryAddress ?? profile?.defaultAddress ?? '').trim(),
    paymentMethod: draft.paymentMethod ?? profile?.preferredPaymentMethod ?? '',
    delivery: draft.delivery !== false,
    minimumException: false,
    minimumExceptionReason: '',
    items,
  };
}
