import { createHash } from 'node:crypto';

export function normalizeDeliveryAmount(value, field = 'delivery amount') {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    const error = new Error(`${field} debe ser un entero de pesos COP no negativo, o null si no está definido.`);
    Object.assign(error, { statusCode: 400, code: 'invalid_delivery_amount' });
    throw error;
  }
  return value;
}

export function deliveryPolicyForTenant(tenant) {
  const policy = tenant?.config?.orderPolicy ?? {};
  return { deliveryFee: normalizeDeliveryAmount(policy.deliveryFee, 'deliveryFee'),
    deliveryMinimumSubtotal: normalizeDeliveryAmount(policy.deliveryMinimumSubtotal, 'deliveryMinimumSubtotal') };
}

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function deliveryPolicyRevision(tenant) {
  return hash([tenant?.id ?? null, deliveryPolicyForTenant(tenant)]);
}
export function deliveryBasketRevision(items = []) {
  return hash(items.map(i => [i.product?.sku ?? i.sku ?? i.rawItemId, i.quantity ?? null,
    i.product?.price ?? i.unitPrice ?? null, i.budgetAmount ?? null, i.saleMode ?? null, i.requestedAmount ?? null,
    i.product?.allowsSaleByAmount === true || (!i.product && i.allowsSaleByAmount === true)]));
}

// Whole catalog units or explicitly authorized amount sales. A budget alone
// never grants sale/rounding permission and never becomes revenue.
export function catalogLineTotal(item) {
  if (item.saleMode === 'amount') {
    const allowed = item.product ? item.product.allowsSaleByAmount === true : item.allowsSaleByAmount === true;
    return allowed && item.quantity == null && Number.isSafeInteger(item.requestedAmount) && item.requestedAmount > 0
      ? item.requestedAmount : null;
  }
  const price = item.product?.price ?? item.unitPrice;
  if (!Number.isSafeInteger(price) || price <= 0
    || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) return null;
  const total = price * item.quantity;
  return Number.isSafeInteger(total) ? total : null;
}

// Expose the writer's sale-unit contract to the contextual decision, before
// composing a reply. Product identity and a matching budget are not evidence
// of quantity. This describes facts; it does not choose a conversational action.
export function catalogSaleUnitEvidence(item) {
  return { priceBasis: item.saleMode === 'amount' ? 'requested_amount_if_catalog_authorizes' : 'whole_catalog_presentation',
    saleMode: item.saleMode ?? 'units', requestedAmount: item.requestedAmount ?? null, requestedQuantity: item.quantity ?? null,
    quantityEstablished: Number.isSafeInteger(item.quantity) && item.quantity > 0,
    requestedBudget: item.budgetAmount ?? null, budgetToQuantitySupported: false,
    note: 'La bandera allowsSaleByAmount del candidato autoriza venta por importe sin convertir a gramos/unidades. Un presupuesto máximo no es compra por importe.' };
}

// Arithmetic and commercial constraints only. No linguistic decisions here.
export function evaluateDeliveryPolicy({ tenant, items = [], delivery = true, draftVersion = 0, resolution = null }) {
  const policy = deliveryPolicyForTenant(tenant);
  const policyRevision = deliveryPolicyRevision(tenant);
  const basketRevision = deliveryBasketRevision(items);
  let complete = items.length > 0;
  let subtotal = 0;
  for (const item of items) {
    const line = catalogLineTotal(item);
    const resolved = !item.resolution || item.resolution.status === 'resolved';
    if (!resolved || !Number.isSafeInteger(line) || item.available === false) complete = false;
    if (resolved && Number.isSafeInteger(line)) subtotal += line;
  }
  if (!Number.isSafeInteger(subtotal)) throw Object.assign(new Error('Subtotal fuera de rango'), { code: 'invalid_order_pricing' });
  const authorized = resolution?.authorized === true && Boolean(resolution.requestId && resolution.actorId)
    && resolution.tenantId === tenant?.id && resolution.policyRevision === policyRevision
    && resolution.basketRevision === basketRevision;
  const deliveryFee = !delivery ? 0 : authorized && resolution.deliveryFee != null
    ? normalizeDeliveryAmount(resolution.deliveryFee) : policy.deliveryFee;
  const minimumSubtotal = !delivery ? 0 : authorized && resolution.minimumSubtotal != null
    ? normalizeDeliveryAmount(resolution.minimumSubtotal) : policy.deliveryMinimumSubtotal;
  const minimumMet = complete && minimumSubtotal != null ? subtotal >= minimumSubtotal : null;
  const shortfall = complete && minimumSubtotal != null ? Math.max(0, minimumSubtotal - subtotal) : null;
  const exempt = authorized && resolution.minimumException === true;
  const status = !complete ? 'basket_incomplete' : !delivery ? 'not_applicable'
    : deliveryFee == null || minimumSubtotal == null ? 'configuration_incomplete'
      : minimumMet ? 'eligible' : exempt ? 'exception_approved' : 'below_minimum';
  const total = complete && deliveryFee != null ? subtotal + deliveryFee : null;
  if (total != null && !Number.isSafeInteger(total)) throw Object.assign(new Error('Total fuera de rango'), { code: 'invalid_order_pricing' });
  return { schemaVersion: 'delivery-pricing.v1', tenantId: tenant?.id ?? null, currency: 'COP', delivery: Boolean(delivery),
    subtotal, deliveryFee, minimumSubtotal, shortfall, minimumMet, status, total,
    policyRevision, basketRevision, draftVersion: Number(draftVersion),
    resolution: authorized ? structuredClone(resolution) : null,
    canConfirm: ['eligible', 'not_applicable', 'exception_approved'].includes(status) };
}

export function assertDeliveryPricing(pricing) {
  if (!pricing?.canConfirm || !['eligible', 'not_applicable', 'exception_approved'].includes(pricing.status)
    || !Number.isSafeInteger(pricing.subtotal) || pricing.subtotal <= 0
    || !Number.isSafeInteger(pricing.deliveryFee) || pricing.deliveryFee < 0
    || pricing.total !== pricing.subtotal + pricing.deliveryFee) {
    throw Object.assign(new Error('El domicilio requiere condiciones comerciales válidas y una cotización vigente.'),
      { code: 'delivery_policy_not_satisfied', statusCode: 409 });
  }
  return pricing;
}
