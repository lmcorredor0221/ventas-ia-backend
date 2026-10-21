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
