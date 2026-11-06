import { createHash } from 'node:crypto';

function amount(value, field) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    const error = new Error(`${field} debe ser un entero de pesos COP no negativo, o null si no está definido.`);
    error.code = 'invalid_delivery_amount';
    error.statusCode = 400;
    throw error;
  }
  return Number(value);
}

export function deliveryPolicyForTenant(tenant) {
  const policy = tenant?.config?.orderPolicy ?? {};
  return {
    deliveryFee: amount(policy.deliveryFee ?? 0, 'deliveryFee'),
    deliveryMinimumSubtotal: amount(policy.deliveryMinimumSubtotal ?? 10000, 'deliveryMinimumSubtotal'),
  };
}

export function deliveryPolicyRevision(tenant) {
  return createHash('sha256').update(JSON.stringify([tenant?.id ?? null, deliveryPolicyForTenant(tenant)])).digest('hex');
}

export function deliveryBasketRevision(items = []) {
  return createHash('sha256').update(JSON.stringify(items.map(item => [
    item.sku ?? item.product?.sku ?? null,
    item.quantity ?? null,
    item.unitPrice ?? item.product?.price ?? null,
    item.saleMode ?? 'units',
    item.requestedAmount ?? null,
  ]))).digest('hex');
}

export function evaluateDeliveryPolicy({ tenant, items = [], delivery = true, draftVersion = 0, resolution = null }) {
  const policy = deliveryPolicyForTenant(tenant);
  const subtotal = items.reduce((total, item) => total + Number(item.lineTotal ?? (Number(item.unitPrice) * Number(item.quantity))), 0);
  const complete = items.length > 0 && Number.isSafeInteger(subtotal) && items.every(item => Number.isSafeInteger(Number(item.lineTotal ?? (Number(item.unitPrice) * Number(item.quantity)))));
  const deliveryFee = delivery ? policy.deliveryFee : 0;
  const minimumSubtotal = delivery ? policy.deliveryMinimumSubtotal : 0;
  const minimumMet = complete ? subtotal >= minimumSubtotal : false;
  const exceptionApproved = resolution?.minimumException === true && resolution?.authorized === true;
  const status = !complete ? 'basket_incomplete' : !delivery ? 'not_applicable'
    : minimumMet ? 'eligible' : exceptionApproved ? 'exception_approved' : 'below_minimum';
  return {
    schemaVersion: 'delivery-pricing.v1', tenantId: tenant?.id ?? null, currency: 'COP', delivery: Boolean(delivery),
    subtotal, deliveryFee, minimumSubtotal, shortfall: Math.max(0, minimumSubtotal - subtotal), minimumMet,
    status, total: complete ? subtotal + deliveryFee : null,
    policyRevision: deliveryPolicyRevision(tenant), basketRevision: deliveryBasketRevision(items), draftVersion: Number(draftVersion),
    resolution: exceptionApproved ? structuredClone(resolution) : null,
    canConfirm: ['eligible', 'not_applicable', 'exception_approved'].includes(status),
  };
}

export function assertDeliveryPricing(pricing) {
  if (!pricing?.canConfirm || !Number.isSafeInteger(pricing.subtotal) || pricing.subtotal <= 0
    || !Number.isSafeInteger(pricing.deliveryFee) || pricing.deliveryFee < 0
    || pricing.total !== pricing.subtotal + pricing.deliveryFee) {
    const error = new Error('El domicilio requiere condiciones comerciales válidas y una cotización vigente.');
    error.code = 'delivery_policy_not_satisfied';
    error.statusCode = 409;
    throw error;
  }
  return pricing;
}
