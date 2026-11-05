import { whatsappOrderSummary, splitWhatsAppText } from '../domain/whatsappOrderSummary.js';
import { paymentMethodsForTenant } from '../domain/paymentMethods.js';
import { EDITABLE_ORDER_STATUSES } from '../domain/orderEdit.js';

// An explicit human edit sends its receipt through the existing durable outbox.
// It does not ask the LLM for consent, reopen a sale or approve a payment.
export function orderSummaryNotification({ store, tools, events }) {
  return async entry => {
    const { tenantId, aggregateId: orderId } = entry;
    const version = entry.payload.version;
    const order = await readOrder(store, tenantId, orderId);
    const finish = (status, details = {}) => {
      events.emit({ type: `order.summary.${status}`, tenantId, conversationId: order?.conversationId,
        detail: 'Updated order summary notification', metadata: { orderId, version, ...details } });
      return { status, version, ...details };
    };
    if (!order || order.tenantId !== tenantId || order.version !== version
      || !EDITABLE_ORDER_STATUSES.includes(order.status)) return finish('superseded');
    const conversation = await readConversation(store, order.conversationId);
    if (!conversation || conversation.tenantId !== tenantId || conversation.orderId !== orderId
      || !conversation.waId || (order.waId && order.waId !== conversation.waId)) return finish('recipient_unavailable');
    const tenant = store.getTenant ? await store.getTenant(tenantId) : store.getState().tenants.find(t => t.id === tenantId);
    const summary = whatsappOrderSummary(order, { stage: 'updated', paymentMethods: paymentMethodsForTenant(tenant) });
    if (!summary.complete) return finish('invalid_summary');
    const providerMessageIds = [];
    const parts = splitWhatsAppText(summary.text);
    for (const [index, text] of parts.entries()) {
      // Revalidate between parts/retries so an older revision is not resent.
      const latest = await readOrder(store, tenantId, orderId);
      if (!latest || latest.version !== version || !EDITABLE_ORDER_STATUSES.includes(latest.status)) return finish('superseded');
      const chat = await readConversation(store, order.conversationId);
      if (chat?.tenantId !== tenantId || chat.orderId !== orderId || chat.waId !== conversation.waId) return finish('recipient_unavailable');
      const deliveryKey = `order-summary:${orderId}:${version}:${index}`;
      const prior = chat.messages?.find(message => message.deliveryKey === deliveryKey);
      if (prior) { providerMessageIds.push(prior.id); continue; }
      const lastInbound = Math.max(0, ...(chat.messages ?? []).filter(m => m.role === 'user')
        .map(m => Date.parse(m.createdAt)).filter(Number.isFinite));
      if (!lastInbound || lastInbound > Date.now() || Date.now() - lastInbound >= 24 * 60 * 60 * 1000) return finish('window_closed');
      const sent = await tools.call('whatsapp_business_messaging', tenantId, order.conversationId, {
        action: 'send_session_message', senderRole: 'human', wa_id: conversation.waId, text, deliveryKey,
      });
      if (!sent?.accepted) throw new Error('Updated summary was not accepted by the messaging provider');
      providerMessageIds.push(sent.provider_message_id);
    }
    return finish('accepted', { providerMessageIds });
  };
}

const readOrder = (store, tenantId, id) => store.getOrder ? store.getOrder(tenantId, id)
  : store.getState().ordersByTenant?.[tenantId]?.find(order => order.id === id);
const readConversation = (store, id) => store.getConversation ? store.getConversation(id)
  : store.getState().conversations?.find(conversation => conversation.id === id);
