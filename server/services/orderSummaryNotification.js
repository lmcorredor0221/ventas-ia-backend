import { whatsappOrderSummary } from '../domain/whatsappOrderSummary.js';
import crypto from 'node:crypto';

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
    const text = whatsappOrderSummary(order, { stage: entry.payload?.stage ?? 'confirmed' });
    const pendingReviewLines = (order.manualProductReview?.lines ?? [])
      .filter(line => ['pending', 'awaiting_customer'].includes(line.status));
    let interactive;
    if (['manual_review_found', 'manual_review_unavailable'].includes(entry.payload?.stage)
      && order.customerReconfirmation?.status === 'required'
      && pendingReviewLines.length === 0
      && store.createInteractionOffer) {
      const offerId = `io-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const option = {
        id: `vi:${offerId}:1`,
        title: 'Confirmar ajuste',
        action: 'confirm_order_change',
        value: JSON.stringify({ orderId: order.id, version: order.version }),
      };
      await store.createInteractionOffer({
        id: offerId,
        tenantId: order.tenantId,
        conversationId: order.conversationId,
        purpose: 'order_change_confirmation',
        options: [option],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      interactive = {
        kind: 'button',
        body: text,
        buttons: [{ id: option.id, title: option.title }],
      };
    }
    try {
      const provider = await tools.call('whatsapp_business_messaging', order.tenantId, order.conversationId, {
        action: 'send_session_message', wa_id: recipient, text, interactive,
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
