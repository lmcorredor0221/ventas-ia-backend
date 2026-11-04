// Shared cache update, applied only after the durable transaction succeeds.
export function applyManualOrderCommit(state, { order, conversationPatch, entries, period, usageValue, created = true }) {
  const { tenantId, conversationId } = order;
  state.ordersByTenant ??= {};
  state.ordersByTenant[tenantId] ??= [];
  if (!state.ordersByTenant[tenantId].some(item => item.id === order.id)) state.ordersByTenant[tenantId].unshift(order);
  const conversation = state.conversations.find(item => item.id === conversationId && item.tenantId === tenantId);
  if (conversation && created) Object.assign(conversation, conversationPatch);
  for (const request of state.pendingRequests ?? []) {
    if (created && request.tenantId === tenantId && request.conversationId === conversationId && request.status === 'pending') {
      Object.assign(request, { status: 'resolved', resolvedAt: order.createdAt, approverId: order.confirmedBy, resolution: 'manual_order_confirmed', resolvedOrderId: order.id });
    }
  }
  state.integrationOutbox ??= [];
  for (const entry of entries ?? []) if (!state.integrationOutbox.some(item => item.idempotencyKey === entry.idempotencyKey)) state.integrationOutbox.push(entry);
  state.usageCountersByTenant ??= {};
  state.usageCountersByTenant[tenantId] ??= {};
  state.usageCountersByTenant[tenantId][period] ??= {};
  state.usageCountersByTenant[tenantId][period].deliveries_confirmed = usageValue;
  if (created) {
    const subscription = state.subscriptionsByTenant?.[tenantId];
    const cycles = state.billingUsageCyclesByTenant?.[tenantId] ?? [];
    const cycle = cycles.find(item => item.periodStart === subscription?.currentPeriodStart) ?? cycles[0];
    if (cycle) { cycle.deliveriesUsed = Number(cycle.deliveriesUsed ?? 0) + 1; cycle.updatedAt = order.createdAt; }
  }
}
