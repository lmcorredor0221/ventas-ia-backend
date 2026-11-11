import { deliveryPolicyRevision } from './deliveryPolicy.js';

export const EDITABLE_ORDER_STATUSES = ['pending_human_preparation', 'preparing'];

export function assertOrderEditVersion(order, expectedVersion) {
  if (!order) throw Object.assign(new Error('Pedido no encontrado.'), { statusCode: 404, code: 'order_not_found' });
  if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
    throw Object.assign(new Error('Este pedido ya salió de preparación y no se puede modificar.'), { statusCode: 409, code: 'order_edit_closed' });
  }
  if (!Number.isSafeInteger(Number(expectedVersion)) || Number(order.version ?? 0) !== Number(expectedVersion)) {
    throw Object.assign(new Error('El pedido cambió mientras lo revisabas. Recarga la cola e inténtalo de nuevo.'), { statusCode: 409, code: 'order_version_conflict' });
  }
}

export function orderCommercialFields(order) {
  return Object.fromEntries(['items', 'subtotal', 'pricing', 'delivery', 'customerName', 'deliveryAddress', 'paymentMethod', 'paymentMethodLabel']
    .map(key => [key, structuredClone(order?.[key] ?? null)]));
}

export function assertOrderEditPolicy(tenant, order) {
  if (!tenant || order?.pricing?.policyRevision !== deliveryPolicyRevision(tenant)) {
    throw Object.assign(new Error('Las condiciones de domicilio cambiaron. Recarga el pedido y revisa el total.'), {
      statusCode: 409, code: 'delivery_policy_revision_conflict',
    });
  }
}

export function refreshOrderConversation(conversation, order, catalogProducts = []) {
  if (!conversation || (conversation.orderId && conversation.orderId !== order.id)) return;
  Object.assign(conversation, {
    orderId: order.id,
    orderStatus: order.status,
    value: order.pricing?.total ?? order.subtotal,
    updatedAt: order.updatedAt,
  });
  const previousDraft = conversation.orderDraft ?? {};
  const version = Number(previousDraft.version ?? 0) + 1;
  const items = (order.items ?? []).map(line => {
    const previous = previousDraft.items?.find(item => (item.product?.sku ?? item.skuHint ?? item.sku) === line.sku);
    const product = {
      ...(previous?.product ?? {}),
      ...catalogProducts.find(item => item.sku === line.sku),
      sku: line.sku,
      tenantId: order.tenantId,
      name: line.name,
      price: line.unitPrice,
      presentation: line.presentation,
      allowsSaleByAmount: line.allowsSaleByAmount === true,
    };
    return {
      rawItemId: previous?.rawItemId ?? `manual:${order.id}:${line.sku}`,
      rawName: line.name,
      catalogQuery: line.name,
      skuHint: line.sku,
      quantity: line.quantity,
      saleMode: line.saleMode ?? 'units',
      requestedAmount: line.requestedAmount ?? null,
      requestedWeightGrams: line.requestedWeightGrams ?? null,
      unitPricePerKg: line.unitPricePerKg ?? null,
      budgetAmount: null,
      lineTotal: line.lineTotal,
      product,
      available: true,
      resolution: { status: 'resolved', reason: 'human_order_edit', product },
      presentationOptions: [],
    };
  });
  conversation.orderDraft = {
    ...previousDraft,
    customerName: order.customerName,
    deliveryAddress: order.deliveryAddress,
    paymentMethod: order.paymentMethod,
    delivery: order.delivery,
    items,
    subtotal: order.subtotal,
    missingFields: [],
    pricing: { ...structuredClone(order.pricing), draftVersion: version },
    dataAudit: null,
    manuallyEditedOrderId: order.id,
    version,
  };
}

export function refreshPreparationRequest(request, order) {
  if (request?.status !== 'pending' || request.tenantId !== order.tenantId
    || request.contextSnapshot?.orderId !== order.id) return;
  Object.assign(request.contextSnapshot, {
    items: structuredClone(order.items),
    subtotal: order.subtotal,
    pricing: structuredClone(order.pricing),
    customerName: order.customerName,
    deliveryAddress: order.deliveryAddress,
    paymentMethod: order.paymentMethod,
  });
}

export function applyOrderEdit(state, { order, entries = [], catalogProducts = [] }) {
  const list = state.ordersByTenant?.[order.tenantId] ?? [];
  const index = list.findIndex(item => item.id === order.id);
  if (index >= 0) list[index] = order;
  refreshOrderConversation(
    state.conversations?.find(item => item.id === order.conversationId && item.tenantId === order.tenantId),
    order,
    catalogProducts,
  );
  for (const request of state.pendingRequests ?? []) refreshPreparationRequest(request, order);
  state.integrationOutbox ??= [];
  for (const entry of entries) {
    if (!state.integrationOutbox.some(item => item.idempotencyKey === entry.idempotencyKey)) state.integrationOutbox.push(entry);
  }
}
