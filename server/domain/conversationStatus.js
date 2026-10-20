export const CLOSED_CONVERSATION_STATUSES = Object.freeze([
  'closed_no_confirmation',
  'closed_dispatched',
  'completed',
  'resolved',
  'cancelled',
]);

export function isClosedConversation(conversation) {
  return CLOSED_CONVERSATION_STATUSES.includes(conversation?.caseStatus ?? conversation?.status);
}

export function isDispatchedConversation(conversation) {
  return conversation?.status === 'closed_dispatched'
    || conversation?.caseStatus === 'closed_dispatched'
    || conversation?.closeReason === 'order_dispatched'
    || conversation?.orderStatus === 'dispatched';
}
