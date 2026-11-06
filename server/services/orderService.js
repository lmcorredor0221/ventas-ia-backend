import { canTransition, assertOrderStatus, ORDER_STATUSES } from '../domain/orderStatus.js';
import { EDITABLE_ORDER_STATUSES, assertOrderEditVersion, assertOrderEditPolicy, orderCommercialFields } from '../domain/orderEdit.js';
import { deliveryPolicyForTenant, evaluateDeliveryPolicy, assertDeliveryPricing, deliveryPolicyRevision, deliveryBasketRevision } from '../domain/deliveryPolicy.js';
import { paymentMethodsForTenant, resolvePaymentMethod } from './paymentMethods.js';
import { catalogCommerceCategory, assertCommerceOrderAllowed } from '../domain/whatsappCommercePolicy.js';

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
    if (result.status !== 'success') throw Object.assign(new Error('No pudimos cargar el catálogo. Puedes reintentar sin perder el pedido.'), { code: 'order_catalog_unavailable', statusCode: 503 });
    return (result.rows ?? []).filter(row => row.active !== false && !catalogCommerceCategory(row)).map(row => ({
      sku: String(row.sku), name: row.name, presentation: row.presentation ?? '', description: row.description ?? '',
      brand: row.brand ?? '', category: row.category ?? '', productFamily: row.productFamily ?? '',
      price: Number(row.price), stock: row.stock == null ? null : Number(row.stock),
      allowsSaleByAmount: row.allowsSaleByAmount === true,
    }));
  }

  async workspace({ orderId, tenantId, includeCatalog = true }) {
    const order = this.store.getOrder
      ? await this.store.getOrder(tenantId, orderId)
      : this.findOrder(orderId, tenantId);
    if (!order) throw Object.assign(new Error('Pedido no encontrado.'), { code: 'order_not_found', statusCode: 404 });
    const state = this.store.getState();
    const conversation = await this.store.getConversation?.(order.conversationId)
      ?? state.conversations?.find(item => item.id === order.conversationId && item.tenantId === tenantId)
      ?? null;
    const tenant = this.store.getTenant
      ? await this.store.getTenant(tenantId)
      : state.tenants.find(item => item.id === tenantId);
    const entries = await this.store.listOutbox?.({ tenantId, aggregateId: order.id, kind: 'order.summary_notification', limit: 5 }) ?? [];
    const notification = entries.find(entry => Number(entry.payload?.version) === Number(order.version));
    const effectiveOrder = { ...order, status: this.effectiveStatus(order) };
    const canEdit = EDITABLE_ORDER_STATUSES.includes(effectiveOrder.status);
    return {
      order: effectiveOrder,
      canEdit,
      summaryNotification: notification ? { status: notification.result?.status ?? notification.payload?.result?.status ?? notification.status, version: order.version } : null,
      conversation: conversation ? { id: conversation.id, customer: conversation.customer ?? conversation.customerName ?? null, waId: conversation.waId, status: conversation.status, messages: conversation.messages ?? [] } : null,
      products: canEdit && includeCatalog ? await this.catalogForEditing(tenantId) : [],
      paymentMethods: paymentMethodsForTenant(tenant),
      deliveryPolicy: deliveryPolicyForTenant(tenant),
    };
  }

  async edit({ orderId, tenantId, input, actorId = 'local-owner' }) {
    const key = `${tenantId}:${orderId}`;
    const previous = this.transitionLocks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const chain = previous.then(() => gate);
    this.transitionLocks.set(key, chain);
    await previous;
    try {
      return await this.editUnlocked({ orderId, tenantId, input, actorId });
    } finally {
      release();
      if (this.transitionLocks.get(key) === chain) this.transitionLocks.delete(key);
    }
  }

  async editUnlocked({ orderId, tenantId, input, actorId = 'local-owner' }) {
    const current = this.store.getOrder
      ? await this.store.getOrder(tenantId, orderId)
      : this.findOrder(orderId, tenantId);
    assertOrderEditVersion(current && { ...current, status: this.effectiveStatus(current) }, input?.expectedVersion);
    if (input?.customerConfirmed !== true) throw Object.assign(new Error('Confirma que acordaste estos cambios con el cliente.'), { code: 'order_customer_confirmation_required', statusCode: 422 });
    const customerName = String(input.customerName ?? '').trim();
    const deliveryAddress = String(input.deliveryAddress ?? '').trim();
    const delivery = input.delivery !== false;
    if (!customerName || customerName.length > 160 || deliveryAddress.length > 500 || (delivery && !deliveryAddress)) {
      throw Object.assign(new Error('Revisa el nombre y la dirección del cliente.'), { code: 'invalid_order_customer', statusCode: 422 });
    }
    const tenant = this.store.getTenant
      ? await this.store.getTenant(tenantId)
      : this.store.getState().tenants.find(item => item.id === tenantId);
    assertOrderEditPolicy(tenant, current);
    const methods = paymentMethodsForTenant(tenant);
    const payment = methods.find(method => method.id === input.paymentMethod) ?? resolvePaymentMethod(input.paymentMethod, methods);
    if (!payment) throw Object.assign(new Error('Selecciona un medio de pago habilitado por tu tienda.'), { code: 'invalid_payment_method', statusCode: 422 });
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw Object.assign(new Error('El pedido debe tener entre 1 y 100 productos.'), { code: 'invalid_order_items', statusCode: 422 });
    const products = await this.catalogForEditing(tenantId);
    const seen = new Set();
    const items = input.items.map(line => {
      const product = products.find(item => item.sku === line?.sku);
      if (!product || seen.has(line.sku)) throw Object.assign(new Error('Hay un producto no disponible o repetido. Revisa el catálogo.'), { code: 'invalid_order_items', statusCode: 422 });
      seen.add(line.sku);
      const amountSale = line.saleMode === 'amount';
      const quantity = amountSale ? null : Number(line.quantity);
      const requestedAmount = amountSale ? Number(line.requestedAmount) : null;
      if (amountSale && (product.allowsSaleByAmount !== true || !Number.isSafeInteger(requestedAmount) || requestedAmount < 1 || line.quantity != null)) {
        throw Object.assign(new Error(`Este producto no permite solicitar un valor específico: ${product.name}.`), { code: 'invalid_sale_mode', statusCode: 422 });
      }
      if (!amountSale && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999)) throw Object.assign(new Error(`Revisa la cantidad de ${product.name}.`), { code: 'invalid_order_quantity', statusCode: 422 });
      if (!Number.isSafeInteger(product.price) || product.price <= 0 || !Number.isFinite(product.stock) || (!amountSale && product.stock < quantity)) throw Object.assign(new Error(`Revisa el precio o las existencias de ${product.name}.`), { code: 'invalid_order_product', statusCode: 422 });
      if (line.unitPrice !== undefined && Number(line.unitPrice) !== product.price) throw Object.assign(new Error(`Cambió el precio de ${product.name}. Recarga el pedido.`), { code: 'order_price_changed', statusCode: 409 });
      return { sku: product.sku, name: product.name, presentation: product.presentation, quantity, saleMode: amountSale ? 'amount' : 'units', requestedAmount, unitPrice: product.price, lineTotal: amountSale ? requestedAmount : product.price * quantity, allowsSaleByAmount: product.allowsSaleByAmount === true };
    });
    assertCommerceOrderAllowed(items, products);
    const policy = deliveryPolicyForTenant(tenant);
    const deliveryFee = delivery ? Number(input.deliveryFee ?? policy.deliveryFee) : 0;
    if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0) throw Object.assign(new Error('Escribe el costo del domicilio en pesos, sin decimales.'), { code: 'invalid_delivery_fee', statusCode: 422 });
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const belowMinimum = delivery && subtotal < policy.deliveryMinimumSubtotal;
    const editReason = String(input.reason ?? '').trim();
    const exceptionReason = String(input.minimumExceptionReason ?? editReason).trim();
    if (belowMinimum && (input.minimumException !== true || !exceptionReason)) throw Object.assign(new Error('El pedido no alcanza el mínimo. Autoriza la excepción e indica el acuerdo con el cliente.'), { code: 'delivery_minimum_exception_required', statusCode: 409 });
    const evaluatedPricing = evaluateDeliveryPolicy({ tenant, items, delivery, draftVersion: Number(current.version ?? 0) + 1, resolution: belowMinimum ? {
      authorized: true, requestId: `order-edit:${orderId}:${Number(current.version ?? 0) + 1}`, actorId, tenantId,
      policyRevision: deliveryPolicyRevision(tenant), basketRevision: deliveryBasketRevision(items), deliveryFee,
      minimumSubtotal: policy.deliveryMinimumSubtotal, minimumException: true, reason: exceptionReason,
    } : null });
    const pricing = assertDeliveryPricing({ ...evaluatedPricing, deliveryFee, total: subtotal + deliveryFee });
    if (input.expectedTotal !== undefined && Number(input.expectedTotal) !== pricing.total) {
      throw Object.assign(new Error('El total cambió. Revisa el desglose antes de guardar.'), { code: 'order_total_changed', statusCode: 409 });
    }
    const now = new Date().toISOString();
    const order = { ...structuredClone(current), customerName, deliveryAddress, delivery, items, subtotal, pricing,
      paymentMethod: payment.id, paymentMethodLabel: payment.label, version: Number(current.version ?? 0) + 1, updatedAt: now,
      sheetSyncStatus: this.outbox ? 'pending' : 'not_queued', editHistory: [...(current.editHistory ?? []), {
        at: now, actorId, reason: editReason || exceptionReason || 'Ajuste manual antes de alistamiento', version: Number(current.version ?? 0) + 1,
        before: orderCommercialFields(current), after: orderCommercialFields({ ...current, customerName, deliveryAddress, delivery, items, subtotal, pricing, paymentMethod: payment.id, paymentMethodLabel: payment.label }),
      }] };
    const entries = [this.outbox?.createEntry({ tenantId, kind: 'order.sheet_edit', aggregateType: 'order', aggregateId: orderId,
      idempotencyKey: `order-sheet-edit:${orderId}:${order.version}`, payload: { tenantId, orderId, version: order.version } }),
    this.outbox?.createEntry({ tenantId, kind: 'order.summary_notification', aggregateType: 'order', aggregateId: orderId,
      idempotencyKey: `order-summary:${orderId}:${order.version}`, payload: { tenantId, orderId, conversationId: order.conversationId, version: order.version } })].filter(Boolean);
    await this.store.commitOrderEdit({ order, expectedVersion: input.expectedVersion, entries, catalogProducts: products });
    return { order, notification: entries.some(entry => entry.kind === 'order.summary_notification') ? 'queued' : 'not_queued' };
  }

  effectiveStatus(order, requests = this.store.getState().pendingRequests ?? []) {
    if (!order) return null;
    const status = order.status ?? ORDER_STATUSES.PENDING_HUMAN_PREPARATION;
    if (status !== ORDER_STATUSES.PENDING_HUMAN_PREPARATION) return status;
    const decision = requests.find((request) => (
      request.tenantId === order.tenantId
      && deliveryRequestMatchesOrder(request, order)
      && isDeliveryPreparationRequest(request)
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
      && deliveryRequestMatchesOrder(request, order)
      && isDeliveryPreparationRequest(request)
    )) ?? null;
  }

  async transition(args) {
    const key = `${args.tenantId ?? 'unknown'}:${args.orderId}`;
    const previous = this.transitionLocks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => gate);
    this.transitionLocks.set(key, chain);
    await previous;
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
    const sheetProjectionEntry = this.createSheetProjectionEntry({ order, nextStatus, now, traceId });
    const sheetSync = { provider: 'google_sheets', status: sheetProjectionEntry ? 'queued' : 'not_queued' };
    let updatedOrder;
    let conversationChanged = false;
    let dispatchRecipient = null;
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
        conversationChanged = true;
      }
      if (conversation && nextStatus === ORDER_STATUSES.DISPATCHED) {
        Object.assign(conversation, {
          stage: 'closed',
          zone: 'whatsapp',
          status: 'closed_dispatched',
          caseStatus: 'completed',
          inboxState: 'history',
          manualMode: 'none',
          aiPaused: true,
          closedAt: now,
          closeReason: 'order_dispatched',
          orderStatus: ORDER_STATUSES.DISPATCHED,
          progress: 100,
          nextStep: 'Pedido en camino; la conversación quedó cerrada.',
          updatedAt: now,
        });
        conversationChanged = true;
        dispatchRecipient = updatedOrder.waId ?? conversation.waId ?? null;
      }
    });
    if (this.store.persistOrderWithOutbox) {
      await this.store.persistOrderWithOutbox(order.tenantId, order.id, sheetProjectionEntry ? [sheetProjectionEntry] : []);
    } else {
      await this.store.persistOrder?.(order.tenantId, order.id);
      if (sheetProjectionEntry) await this.store.enqueueOutbox?.(sheetProjectionEntry);
    }
    if (conversationChanged) {
      await this.store.persistConversation?.(order.conversationId);
    }
    const notification = nextStatus === ORDER_STATUSES.DISPATCHED
      ? await this.notifyDispatch({ order: updatedOrder, recipient: dispatchRecipient })
      : { status: 'not_applicable' };
    // The order and its conversation have already been persisted above. Event
    // snapshots are observability work and must not make the operator wait.
    const event = this.events?.emit
      ? this.events.emit({
      type: `order.${nextStatus}`,
      tenantId: order.tenantId,
      conversationId: order.conversationId,
      detail: `Pedido ${order.id}: ${nextStatus}`,
      metadata: { orderId: order.id, actorId, source, traceId, previousStatus, projectionStatus: sheetSync.status, notificationStatus: notification.status },
      })
      : null;
    return {
      order: updatedOrder,
      previousStatus,
      status: nextStatus,
      projection: { provider: 'google_sheets', status: sheetSync.status },
      notification,
      eventId: event?.id ?? null,
    };
  }

  async notifyDispatch({ order, recipient }) {
    if (!recipient) return { status: 'not_sent', reason: 'recipient_missing' };
    try {
      await this.tools.call('whatsapp_business_messaging', order.tenantId, order.conversationId, {
        action: 'send_session_message',
        wa_id: recipient,
        text: `Tu pedido ya va en camino. Gracias por comprar con nosotros. Referencia: ${order.id}.`,
      });
      return { status: 'sent' };
    } catch (error) {
      this.events?.emit({
        type: 'order.dispatch_notification_failed',
        tenantId: order.tenantId,
        conversationId: order.conversationId,
        detail: `No se pudo notificar el despacho del pedido ${order.id}.`,
        metadata: { orderId: order.id, code: error.code ?? null },
      });
      return { status: 'failed', reason: error.code ?? 'send_failed' };
    }
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
}

function requestSnapshot(request) {
  return request?.contextSnapshot ?? request?.context_snapshot ?? {};
}

function deliveryRequestMatchesOrder(request, order) {
  const requestOrderId = requestSnapshot(request).orderId ?? requestSnapshot(request).order_id;
  // Catalog/recovery decisions share the chat but do not take or cancel an
  // order. Only a handoff explicitly linked to this order may affect its state.
  return Boolean(requestOrderId && requestOrderId === order.id);
}

function isDeliveryPreparationRequest(request) {
  const snapshot = requestSnapshot(request);
  return request.action === 'prepare_delivery_order'
    || snapshot.action === 'prepare_delivery_order'
    || request.assignedTeam === 'operaciones'
    || /pedido|domicilio/i.test(request.title ?? '');
}
