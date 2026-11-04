import { createHash } from 'node:crypto';
import { paymentMethodsForTenant } from './paymentMethods.js';
import { billingPeriodForTenant } from './usageService.js';
import { catalogCommerceCategory, assertCommerceOrderAllowed } from '../domain/whatsappCommercePolicy.js';

const fail = (message, code = 'manual_order_invalid', statusCode = 422) => Object.assign(new Error(message), { code, statusCode });

export class ManualOrderService {
  constructor({ store, tools, usage, events, outbox }) {
    Object.assign(this, { store, tools, usage, events, outbox });
    this.locks = new Map();
  }

  async conversation(tenantId, id) {
    const conversation = this.store.getConversation
      ? await this.store.getConversation(id)
      : this.store.getState().conversations.find(item => item.id === id);
    if (!conversation || conversation.tenantId !== tenantId) throw fail('Conversación no encontrada.', 'conversation_not_found', 404);
    return conversation;
  }

  existingOrder(tenantId, conversationId) {
    return this.store.getState().ordersByTenant?.[tenantId]?.find(order => order.conversationId === conversationId);
  }

  async catalog(tenantId) {
    const result = await this.tools.googleSheetsReadTable(tenantId, { filters: {}, cache_policy: 'short_ttl' });
    if (result.status !== 'success') throw fail('No se pudo leer el catálogo de esta tienda. Revisa la conexión de Google y vuelve a intentar.', 'manual_order_catalog_unavailable', 503);
    return (result.rows ?? []).filter(row => !catalogCommerceCategory(row)).map(row => ({
      sku: String(row.sku), name: row.name, presentation: row.presentation ?? '', description: row.description ?? '',
      price: Number(row.price), stock: row.stock == null ? null : Number(row.stock),
    }));
  }

  async context(tenantId, id) {
    const conversation = await this.conversation(tenantId, id);
    const existing = this.existingOrder(tenantId, id);
    if (existing) return { order: existing };
    this.assertManual(conversation);
    const state = this.store.getState();
    const products = await this.catalog(tenantId);
    const profile = state.customerProfilesByTenant?.[tenantId]?.[conversation.waId] ?? {};
    const draft = conversation.orderDraft ?? {};
    return {
      conversationId: id, products,
      paymentMethods: paymentMethodsForTenant(state.tenants.find(item => item.id === tenantId)).filter(method => method.enabled !== false),
      draft: {
        customerName: draft.customerName ?? profile.name ?? '',
        deliveryAddress: draft.deliveryAddress ?? profile.defaultAddress ?? '',
        paymentMethod: draft.paymentMethod ?? '',
        items: (draft.items ?? []).filter(item => products.some(product => product.sku === item.sku))
          .map(item => ({ sku: item.sku, quantity: item.quantity ?? 1 })),
      },
    };
  }

  assertManual(conversation) {
    if (conversation.caseStatus === 'completed' || (String(conversation.status).startsWith('closed') && conversation.closeReason !== 'manual_inactivity')) {
      throw fail('Esta conversación está cerrada. Abre el nuevo caso del cliente.', 'manual_order_closed', 409);
    }
    if (conversation.manualMode !== 'whatsapp_external' && !['manual_active', 'blocked', 'approval_required', 'degraded'].includes(conversation.status)
      && conversation.closeReason !== 'manual_inactivity') {
      throw fail('Primero toma la atención de esta conversación desde Abrir WhatsApp.', 'manual_order_not_manual', 409);
    }
  }

  async confirm(tenantId, id, input, actorId) {
    // Serialize per tenant: concurrent orders must observe the same quota.
    const previous = this.locks.get(tenantId) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this.confirmUnlocked(tenantId, id, input, actorId));
    this.locks.set(tenantId, operation);
    try { return await operation; }
    finally { if (this.locks.get(tenantId) === operation) this.locks.delete(tenantId); }
  }

  async confirmUnlocked(tenantId, id, input, actorId) {
    const conversation = await this.conversation(tenantId, id);
    const existing = this.existingOrder(tenantId, id);
    if (existing) return { order: existing, created: false };
    this.assertManual(conversation);
    if (input.customerConfirmed !== true) throw fail('Confirma que el cliente aceptó el pedido y su total.');
    const customerName = String(input.customerName ?? '').trim();
    const deliveryAddress = String(input.deliveryAddress ?? '').trim();
    if (!customerName || customerName.length > 160 || !deliveryAddress || deliveryAddress.length > 500) throw fail('Completa el nombre y la dirección de entrega.');
    const tenant = this.store.getState().tenants.find(item => item.id === tenantId);
    const payment = paymentMethodsForTenant(tenant).find(method => method.enabled !== false && method.id === input.paymentMethod);
    if (!payment) throw fail('Selecciona un medio de pago disponible en la tienda.');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw fail('Agrega los productos acordados con el cliente.');
    const products = await this.catalog(tenantId);
    const seen = new Set();
    const items = input.items.map(item => {
      const product = products.find(row => row.sku === item.sku);
      if (!product || seen.has(item.sku)) throw fail('Hay un producto no disponible o repetido. Revisa el pedido.');
      seen.add(item.sku);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw fail('Revisa las cantidades de los productos.');
      if (!Number.isFinite(product.price) || product.price <= 0) throw fail(`Revisa el precio de ${product.name} en el catálogo.`);
      if (!Number.isFinite(product.stock) || product.stock < quantity) throw fail(`No hay existencias suficientes de ${product.name}. Actualiza el catálogo o ajusta la cantidad.`);
      if (Number(item.unitPrice) !== product.price) throw fail(`Cambió el precio de ${product.name}. Vuelve a cargar el catálogo y confirma el nuevo total con el cliente.`, 'manual_order_price_changed', 409);
      return { sku: product.sku, name: product.name, presentation: product.presentation, quantity, unitPrice: product.price, lineTotal: product.price * quantity };
    });
    assertCommerceOrderAllowed(items, products);
    await this.usage.assertCanRecordDelivery(tenantId, { conversationId: id });
    const now = new Date().toISOString();
    // Stable identity makes retries safe even after a server restart.
    const orderId = `ord-manual-${createHash('sha256').update(`${tenantId}:${id}`).digest('hex').slice(0, 20)}`;
    const order = {
      id: orderId, tenantId, conversationId: id, waId: conversation.waId, customerName, deliveryAddress,
      items, subtotal: items.reduce((total, item) => total + item.lineTotal, 0),
      paymentMethod: payment.id, paymentMethodLabel: payment.label,
      status: 'preparing', version: 0, source: 'manual_whatsapp', confirmedBy: actorId, customerConfirmedAt: now,
      sheetSyncStatus: this.outbox ? 'pending' : 'not_queued', createdAt: now, updatedAt: now,
      statusHistory: [{ status: 'preparing', at: now, actorId, source: 'manual_whatsapp' }],
    };
    const conversationPatch = {
      orderId, orderStatus: 'preparing', value: order.subtotal, status: 'manual_active', caseStatus: 'active', inboxState: 'active',
      manualMode: 'whatsapp_external', aiPaused: true, manualLastActivityAt: now,
      stage: 'fulfillment', zone: 'human', closedAt: null, closeReason: null,
      nextStep: 'Pedido confirmado por la tienda. Alístalo y márcalo en camino desde Pedidos y pendientes.', updatedAt: now,
    };
    const entry = this.outbox?.createEntry({ tenantId, kind: 'order.sheet_create', aggregateType: 'order', aggregateId: orderId,
      idempotencyKey: `order-sheet-create:${orderId}`, payload: { tenantId, orderId, conversationId: id } });
    const result = await this.store.commitManualOrder({ order, conversationPatch, entries: entry ? [entry] : [], period: billingPeriodForTenant(this.store.getState(), tenantId) });
    if (result.created) this.events?.emit({ type: 'order.manual_confirmed', tenantId, conversationId: id,
      detail: `Pedido ${orderId} confirmado por la tienda y en alistamiento.`, metadata: { orderId, actorId, subtotal: order.subtotal, itemCount: items.length } });
    return result;
  }
}
