import { createHash } from 'node:crypto';
import { paymentMethodsForTenant } from './paymentMethods.js';
import { billingPeriodForTenant } from './usageService.js';
import { catalogCommerceCategory, assertCommerceOrderAllowed } from '../domain/whatsappCommercePolicy.js';
import { deliveryPolicyForTenant, evaluateDeliveryPolicy, assertDeliveryPricing, deliveryPolicyRevision, deliveryBasketRevision } from '../domain/deliveryPolicy.js';
import { normalizeRequestedWeight, quoteWeightSale, supportsAmountSale, supportsUnitSale, supportsWeightSale } from '../domain/catalogCommerce.js';
import { initializeVariableEstimate } from '../domain/variablePricing.js';

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

  async catalog(tenantId, { query = '', cursor = null, limit = 25, skus = null, withMetadata = false } = {}) {
    const result = await this.tools.googleSheetsReadTable(tenantId, {
      filters: {},
      cache_policy: 'short_ttl',
      purpose: 'manual_order_catalog',
      query,
      cursor,
      limit,
      skus,
    });
    if (result.status !== 'success') throw fail('No se pudo leer el catálogo de esta tienda. Revisa la conexión de Google y vuelve a intentar.', 'manual_order_catalog_unavailable', 503);
    const products = (result.rows ?? []).filter(row => !catalogCommerceCategory(row)).map(row => ({
      sku: String(row.sku), name: row.name, presentation: row.presentation ?? '', description: row.description ?? '',
      price: Number(row.price), stock: row.stock == null ? null : Number(row.stock),
      brand: row.brand ?? '', category: row.category ?? '', productFamily: row.productFamily ?? '',
      attributes: structuredClone(row.attributes ?? {}), tags: structuredClone(row.tags ?? []), allowsSaleByAmount: row.allowsSaleByAmount === true,
    }));
    if (!withMetadata) return products;
    return {
      products,
      catalog: {
        catalogVersion: result.catalog_version ?? null,
        totalCount: result.pagination?.totalCount ?? products.length,
        returnedCount: result.pagination?.returnedCount ?? products.length,
        nextCursor: result.pagination?.nextCursor ?? null,
        limit: result.pagination?.limit ?? Math.min(50, Math.max(1, Number(limit) || 25)),
      },
    };
  }

  async catalogPage(tenantId, options = {}) {
    return this.catalog(tenantId, { ...options, withMetadata: true });
  }

  async context(tenantId, id, catalogOptions = {}) {
    const conversation = await this.conversation(tenantId, id);
    const existing = this.existingOrder(tenantId, id);
    if (existing) return { conversation: manualConversationSnapshot(conversation), order: existing, products: [], paymentMethods: [], deliveryPolicy: deliveryPolicyForTenant(this.store.getState().tenants.find(item => item.id === tenantId)) };
    this.assertManual(conversation);
    const state = this.store.getState();
    const catalogPage = await this.catalogPage(tenantId, catalogOptions);
    const products = catalogPage.products;
    const profile = state.customerProfilesByTenant?.[tenantId]?.[conversation.waId] ?? {};
    const draft = conversation.orderDraft ?? {};
    return {
      conversation: manualConversationSnapshot(conversation), conversationId: id, products, catalog: catalogPage.catalog,
      paymentMethods: paymentMethodsForTenant(state.tenants.find(item => item.id === tenantId)).filter(method => method.enabled !== false),
      deliveryPolicy: deliveryPolicyForTenant(state.tenants.find(item => item.id === tenantId)),
      draft: {
        customerName: draft.customerName ?? profile.name ?? '',
        deliveryAddress: draft.deliveryAddress ?? profile.defaultAddress ?? '',
        paymentMethod: draft.paymentMethod ?? '',
        items: (draft.items ?? []).filter(item => products.some(product => product.sku === item.sku))
          .map(item => ({ sku: item.sku, quantity: item.quantity ?? 1, saleMode: item.saleMode ?? 'units', requestedWeightGrams: item.requestedWeightGrams ?? null })),
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
    // Confirmation verifies only the references selected by the operator. It
    // must not fetch a full catalog page merely to re-price an order.
    const products = await this.catalog(tenantId, { skus: input.items.map((item) => item.sku) });
    const seen = new Set();
    const items = input.items.map(item => {
      const product = products.find(row => row.sku === item.sku);
      if (!product || seen.has(item.sku)) throw fail('Hay un producto no disponible o repetido. Revisa el pedido.');
      seen.add(item.sku);
      const amountSale = item.saleMode === 'amount';
      const weightSale = item.saleMode === 'weight';
      const quantity = amountSale ? 1 : weightSale ? null : Number(item.quantity);
      const requestedAmount = amountSale ? Number(item.requestedAmount) : null;
      const requestedWeight = weightSale
        ? normalizeRequestedWeight(item.requestedWeight ?? (item.requestedWeightGrams ? { amount: item.requestedWeightGrams, unit: 'g' } : null))
        : null;
      const weightQuote = weightSale ? quoteWeightSale(product, requestedWeight) : null;
      if (weightSale && (!supportsWeightSale(product) || !weightQuote || !weightQuote.available)) throw fail(`No es posible vender ${product.name} por el peso solicitado. Revisa su modalidad, precio por kilo y existencias.`);
      if (amountSale && (!supportsAmountSale(product) || !Number.isSafeInteger(requestedAmount) || requestedAmount < 1
        || (item.quantity != null && Number(item.quantity) !== 1))) throw fail(`Este producto no permite solicitar un valor específico: ${product.name}.`);
      if (!amountSale && !weightSale && (!supportsUnitSale(product) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999)) throw fail('Revisa las cantidades de los productos.');
      if (!Number.isFinite(product.price) || product.price <= 0) throw fail(`Revisa el precio de ${product.name} en el catálogo.`);
      if (!amountSale && !weightSale && (!Number.isFinite(product.stock) || product.stock < quantity)) throw fail(`No hay existencias suficientes de ${product.name}. Actualiza el catálogo o ajusta la cantidad.`);
      if (!amountSale && !weightSale && Number(item.unitPrice) !== product.price) throw fail(`Cambió el precio de ${product.name}. Vuelve a cargar el catálogo y confirma el nuevo total con el cliente.`, 'manual_order_price_changed', 409);
      if (weightSale && item.unitPricePerKg !== undefined && Number(item.unitPricePerKg) !== weightQuote.pricePerKg) throw fail(`Cambió el precio por kilo de ${product.name}. Vuelve a cargar el catálogo y confirma el nuevo total con el cliente.`, 'manual_order_price_changed', 409);
      return initializeVariableEstimate({
        sku: product.sku, name: product.name, presentation: product.presentation, quantity,
        saleMode: weightSale ? 'weight' : amountSale ? 'amount' : 'units', requestedAmount,
        requestedWeightGrams: weightSale ? weightQuote.grams : null, unitPricePerKg: weightSale ? weightQuote.pricePerKg : null,
        unitPrice: product.price, lineTotal: weightSale ? weightQuote.lineTotal : amountSale ? requestedAmount : product.price * quantity,
      });
    });
    assertCommerceOrderAllowed(items, products);
    const delivery = input.delivery !== false;
    const policy = deliveryPolicyForTenant(tenant);
    const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);
    const belowMinimum = delivery && policy.deliveryMinimumSubtotal != null && subtotal < policy.deliveryMinimumSubtotal;
    const exceptionReason = String(input.minimumExceptionReason ?? '').trim();
    if (belowMinimum && (input.minimumException !== true || !exceptionReason)) {
      throw fail('El pedido no alcanza el mínimo para domicilio. Autoriza la excepción e indica el acuerdo con el cliente.', 'delivery_minimum_exception_required', 409);
    }
    const pricing = evaluateDeliveryPolicy({ tenant, items, delivery, draftVersion: 1, resolution: belowMinimum ? {
      authorized: true, requestId: `manual-order:${id}:1`, actorId, tenantId,
      policyRevision: deliveryPolicyRevision(tenant), basketRevision: deliveryBasketRevision(items),
      deliveryFee: policy.deliveryFee, minimumSubtotal: policy.deliveryMinimumSubtotal,
      minimumException: true, reason: exceptionReason,
    } : null });
    assertDeliveryPricing(pricing);
    await this.usage.assertCanRecordDelivery(tenantId, { conversationId: id });
    const now = new Date().toISOString();
    // Stable identity makes retries safe even after a server restart.
    const orderId = `ord-manual-${createHash('sha256').update(`${tenantId}:${id}`).digest('hex').slice(0, 20)}`;
    const order = {
      id: orderId, tenantId, conversationId: id, waId: conversation.waId, customerName, deliveryAddress,
      items, subtotal, pricing, delivery,
      minimumException: belowMinimum ? { reason: exceptionReason, authorizedBy: actorId } : null,
      paymentMethod: payment.id, paymentMethodLabel: payment.label,
      status: 'preparing', version: 0, source: 'manual_whatsapp', confirmedBy: actorId, customerConfirmedAt: now,
      sheetSyncStatus: this.outbox ? 'pending' : 'not_queued', createdAt: now, updatedAt: now,
      statusHistory: [{ status: 'preparing', at: now, actorId, source: 'manual_whatsapp' }],
    };
    const conversationPatch = {
      orderId, orderStatus: 'preparing', value: order.pricing.total, status: 'manual_active', caseStatus: 'active', inboxState: 'active',
      manualMode: 'whatsapp_external', aiPaused: true, manualLastActivityAt: now,
      stage: 'fulfillment', zone: 'human', closedAt: null, closeReason: null,
      nextStep: 'Pedido confirmado por la tienda. Alístalo y márcalo en camino desde Pedidos y pendientes.', updatedAt: now,
    };
    const entry = this.outbox?.createEntry({ tenantId, kind: 'order.sheet_create', aggregateType: 'order', aggregateId: orderId,
      idempotencyKey: `order-sheet-create:${orderId}`, payload: { tenantId, orderId, conversationId: id } });
    const notification = this.outbox?.createEntry({ tenantId, kind: 'order.summary_notification', aggregateType: 'order', aggregateId: orderId,
      idempotencyKey: `order-summary:${orderId}:${order.version}`, payload: { tenantId, orderId, conversationId: id, version: order.version } });
    const result = await this.store.commitManualOrder({ order, conversationPatch, entries: [entry, notification].filter(Boolean), period: billingPeriodForTenant(this.store.getState(), tenantId) });
    if (result.created) this.events?.emit({ type: 'order.manual_confirmed', tenantId, conversationId: id,
      detail: `Pedido ${orderId} confirmado por la tienda y en alistamiento.`, metadata: { orderId, actorId, subtotal: order.subtotal, itemCount: items.length, summaryNotification: notification ? 'queued' : 'not_queued' } });
    return { ...result, notification: notification ? 'queued' : 'not_queued' };
  }
}

function manualConversationSnapshot(conversation) {
  return {
    id: conversation.id,
    tenantId: conversation.tenantId,
    waId: conversation.waId,
    customer: conversation.customer ?? conversation.customerName ?? null,
    status: conversation.status,
    messages: Array.isArray(conversation.messages) ? conversation.messages : [],
  };
}
