import { canTransition, assertOrderStatus, ORDER_STATUSES } from '../domain/orderStatus.js';

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
    const sheetSync = this.outbox?.enabled
      ? await this.enqueueSheetProjection({ order, nextStatus, now, traceId })
      : await this.tools.syncLiveOrderStatus({
        tenantId: order.tenantId,
        order,
        status: nextStatus,
        updatedAt: now,
      });
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
    await this.store.persistOrder?.(order.tenantId, order.id);
    if (conversationChanged) {
      await this.store.persistConversation?.(order.conversationId);
    }
    const notification = nextStatus === ORDER_STATUSES.DISPATCHED
      ? await this.notifyDispatch({ order: updatedOrder, recipient: dispatchRecipient })
      : { status: 'not_applicable' };
    const event = this.events?.emitAndWait
      ? await this.events.emitAndWait({
      type: `order.${nextStatus}`,
      tenantId: order.tenantId,
      conversationId: order.conversationId,
      detail: `Pedido ${order.id}: ${nextStatus}`,
      metadata: { orderId: order.id, actorId, source, traceId, previousStatus, projectionStatus: sheetSync.status, notificationStatus: notification.status },
      })
      : this.events?.emit({
        type: `order.${nextStatus}`,
        tenantId: order.tenantId,
        conversationId: order.conversationId,
        detail: `Pedido ${order.id}: ${nextStatus}`,
        metadata: { orderId: order.id, actorId, source, traceId, previousStatus, projectionStatus: sheetSync.status, notificationStatus: notification.status },
      });
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

  async enqueueSheetProjection({ order, nextStatus, now, traceId }) {
    await this.outbox.enqueue({
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
    return { provider: 'google_sheets', status: 'queued' };
  }
}

function requestSnapshot(request) {
  return request?.contextSnapshot ?? request?.context_snapshot ?? {};
}

function deliveryRequestMatchesOrder(request, order) {
  const requestOrderId = requestSnapshot(request).orderId ?? requestSnapshot(request).order_id;
  // A conversation can contain several historical orders. Once a handoff has
  // an order id, it must never be allowed to advance another order in that chat.
  return requestOrderId ? requestOrderId === order.id : request?.conversationId === order.conversationId;
}

function isDeliveryPreparationRequest(request) {
  const snapshot = requestSnapshot(request);
  return request.action === 'prepare_delivery_order'
    || snapshot.action === 'prepare_delivery_order'
    || request.assignedTeam === 'operaciones'
    || /pedido|domicilio/i.test(request.title ?? '');
}
