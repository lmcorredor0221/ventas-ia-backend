export const ORDER_STATUSES = Object.freeze({
  PENDING_HUMAN_PREPARATION: 'pending_human_preparation',
  PREPARING: 'preparing',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

export const ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUSES.PENDING_HUMAN_PREPARATION]: Object.freeze([ORDER_STATUSES.PREPARING, ORDER_STATUSES.CANCELLED]),
  [ORDER_STATUSES.PREPARING]: Object.freeze([ORDER_STATUSES.DISPATCHED, ORDER_STATUSES.CANCELLED]),
  [ORDER_STATUSES.DISPATCHED]: Object.freeze([ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED]),
  [ORDER_STATUSES.DELIVERED]: Object.freeze([]),
  [ORDER_STATUSES.CANCELLED]: Object.freeze([]),
});

const SHEET_TO_CANONICAL = Object.freeze({
  draft: ORDER_STATUSES.PENDING_HUMAN_PREPARATION,
  confirmado: ORDER_STATUSES.PENDING_HUMAN_PREPARATION,
  pending_human_preparation: ORDER_STATUSES.PENDING_HUMAN_PREPARATION,
  preparando: ORDER_STATUSES.PREPARING,
  preparing: ORDER_STATUSES.PREPARING,
  en_camino: ORDER_STATUSES.DISPATCHED,
  despachado: ORDER_STATUSES.DISPATCHED,
  dispatched: ORDER_STATUSES.DISPATCHED,
  entregado: ORDER_STATUSES.DELIVERED,
  delivered: ORDER_STATUSES.DELIVERED,
  cancelado: ORDER_STATUSES.CANCELLED,
  cancelled: ORDER_STATUSES.CANCELLED,
});

const CANONICAL_TO_SHEET = Object.freeze({
  [ORDER_STATUSES.PENDING_HUMAN_PREPARATION]: 'confirmado',
  [ORDER_STATUSES.PREPARING]: 'preparando',
  [ORDER_STATUSES.DISPATCHED]: 'en_camino',
  [ORDER_STATUSES.DELIVERED]: 'entregado',
  [ORDER_STATUSES.CANCELLED]: 'cancelado',
});

export const SHEET_ORDER_STATUSES = Object.freeze(Object.values(CANONICAL_TO_SHEET));

export const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUSES.PENDING_HUMAN_PREPARATION]: 'Pedido por tomar',
  [ORDER_STATUSES.PREPARING]: 'Alistando pedido',
  [ORDER_STATUSES.DISPATCHED]: 'Pedido en camino',
  [ORDER_STATUSES.DELIVERED]: 'Pedido entregado',
  [ORDER_STATUSES.CANCELLED]: 'Pedido cancelado',
});

export function isOrderStatus(value) {
  return Object.values(ORDER_STATUSES).includes(value);
}

export function assertOrderStatus(value) {
  if (!isOrderStatus(value)) {
    const error = new Error(`Estado de pedido no reconocido: ${value}`);
    error.code = 'invalid_order_status';
    error.statusCode = 422;
    throw error;
  }
  return value;
}

export function canTransition(from, to) {
  return isOrderStatus(from) && isOrderStatus(to) && (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function toGoogleSheetStatus(status) {
  assertOrderStatus(status);
  return CANONICAL_TO_SHEET[status];
}

export function fromGoogleSheetStatus(value) {
  if (value === null || value === undefined || value === '') return null;
  return SHEET_TO_CANONICAL[String(value).trim().toLowerCase()] ?? null;
}

export function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] ?? 'Estado pendiente de revisar';
}
