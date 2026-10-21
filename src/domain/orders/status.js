export const ORDER_STATUSES = Object.freeze({
  PENDING_HUMAN_PREPARATION: 'pending_human_preparation',
  PREPARING: 'preparing',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
});

export const ORDER_STATUS_LABELS = Object.freeze({
  [ORDER_STATUSES.PENDING_HUMAN_PREPARATION]: 'Pedido por tomar',
  [ORDER_STATUSES.PREPARING]: 'Alistando pedido',
  [ORDER_STATUSES.DISPATCHED]: 'Pedido en camino',
  [ORDER_STATUSES.DELIVERED]: 'Pedido entregado',
  [ORDER_STATUSES.CANCELLED]: 'Pedido cancelado',
});

export const ORDER_STAGE_LABELS = Object.freeze(['Confirmado', 'Alistando', 'En camino', 'Entregado']);

export function orderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] ?? 'Estado pendiente de revisar';
}

export function orderStageIndex(status) {
  return ({
    [ORDER_STATUSES.PENDING_HUMAN_PREPARATION]: 0,
    [ORDER_STATUSES.PREPARING]: 1,
    [ORDER_STATUSES.DISPATCHED]: 2,
    [ORDER_STATUSES.DELIVERED]: 3,
  })[status] ?? 0;
}
