export function normalizeOrder(order) {
  if (!order || typeof order !== 'object') return null;
  return {
    ...order,
    id: String(order.id ?? ''),
    status: String(order.status ?? 'pending_human_preparation'),
    items: Array.isArray(order.items) ? order.items : [],
    subtotal: Number(order.subtotal ?? 0),
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
  };
}

export function normalizeOpsOverview(payload) {
  const value = payload && typeof payload === 'object' ? payload : {};
  return {
    ...value,
    tenants: Array.isArray(value.tenants) ? value.tenants : [],
    conversations: Array.isArray(value.conversations) ? value.conversations : [],
    conversationHistory: Array.isArray(value.conversationHistory) ? value.conversationHistory : [],
    orders: Array.isArray(value.orders) ? value.orders.map(normalizeOrder).filter(Boolean) : [],
    pendingRequests: Array.isArray(value.pendingRequests) ? value.pendingRequests : [],
    events: Array.isArray(value.events) ? value.events : [],
  };
}

export function normalizeApiErrorMessage(error, fallback = 'No pudimos completar la acción.') {
  if (Number(error?.status) >= 500) return fallback;
  return error?.message || fallback;
}
