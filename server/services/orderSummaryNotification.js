import { whatsappOrderSummary } from '../domain/whatsappOrderSummary.js';

export function createOrderSummaryNotification({ store, tools, events }) {
  return async (entry) => {
    const order = Object.values(store.getState().ordersByTenant ?? {})
      .flat()
      .find(item => item.id === entry.payload.orderId && item.tenantId === entry.payload.tenantId);
    if (!order) throw new Error(`Order ${entry.payload.orderId} not found for summary notification`);
    if (Number(entry.payload.version) !== Number(order.version)) {
      return { status: 'superseded', version: order.version };
    }
    if (order.summaryNotification?.status === 'sent' && order.summaryNotification.version === order.version) {
      return { ...order.summaryNotification };
    }
    const conversation = store.getState().conversations?.find(item => item.id === order.conversationId && item.tenantId === order.tenantId);
    const recipient = order.waId ?? conversation?.waId ?? null;
    if (!recipient) return { status: 'not_sent', reason: 'recipient_missing', version: order.version };
    const text = whatsappOrderSummary(order);
    try {
      const provider = await tools.call('whatsapp_business_messaging', order.tenantId, order.conversationId, {
        action: 'send_session_message', wa_id: recipient, text,
        deliveryKey: `order-summary:${order.id}:${order.version}`,
      });
      const result = { status: 'sent', version: order.version, providerMessageId: provider?.messageId ?? provider?.messages?.[0]?.id ?? null };
      store.mutate(state => {
        const current = (state.ordersByTenant?.[order.tenantId] ?? []).find(item => item.id === order.id);
        if (current) current.summaryNotification = result;
      });
      await store.persistOrder?.(order.tenantId, order.id);
      events?.emit?.({ type: 'order.summary_notification_sent', tenantId: order.tenantId, conversationId: order.conversationId,
        detail: `Resumen del pedido ${order.id} enviado al cliente.`, metadata: { orderId: order.id, version: order.version } });
      return result;
    } catch (error) {
      events?.emit?.({ type: 'order.summary_notification_failed', tenantId: order.tenantId, conversationId: order.conversationId,
        detail: `No se pudo enviar el resumen del pedido ${order.id}.`, metadata: { orderId: order.id, version: order.version, code: error.code ?? null } });
      throw error;
    }
  };
}
