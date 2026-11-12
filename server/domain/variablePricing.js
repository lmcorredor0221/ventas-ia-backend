const asMoney = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const asPositiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const adjustmentReason = (value, saleMode) => String(value ?? '').trim().slice(0, 500)
  || (saleMode === 'weight' ? 'Peso real verificado durante el alistamiento.' : 'Valor definitivo verificado durante el alistamiento.');

export const VARIABLE_PRICE_NOTICE = 'Nota importante: Los productos solicitados por peso están sujetos a verificación durante el alistamiento de tu pedido. Por esta razón, sus cantidades y precios pueden presentar pequeñas variaciones según el peso real entregado. La tienda verificará estos valores y te informará si es necesario realizar algún ajuste.';

// This is deliberately line-based. A catalog product may support more than one
// commercial mode, but only a line actually ordered by weight or budget has an
// estimated price that can change during fulfillment.
export function hasVariablePricing(line = {}) {
  return line.saleMode === 'weight'
    || (line.saleMode === 'amount' && asPositiveInteger(line.requestedAmount) !== null);
}

export function basketHasVariablePricing(items = []) {
  return Array.isArray(items) && items.some(hasVariablePricing);
}

export function effectiveLineTotal(line = {}) {
  return asMoney(line.actualLineTotal) ?? asMoney(line.lineTotal) ?? 0;
}

export function estimatedVariablePricing(line = {}) {
  const estimatedLineTotal = asMoney(line.estimatedLineTotal) ?? asMoney(line.lineTotal) ?? 0;
  return {
    estimatedWeightGrams: asPositiveInteger(line.estimatedWeightGrams) ?? asPositiveInteger(line.requestedWeightGrams),
    estimatedUnitPricePerKg: asPositiveInteger(line.estimatedUnitPricePerKg) ?? asPositiveInteger(line.unitPricePerKg),
    estimatedLineTotal,
  };
}

export function initializeVariableEstimate(line = {}) {
  if (!hasVariablePricing(line)) return { ...line };
  const estimate = estimatedVariablePricing(line);
  return {
    ...line,
    ...estimate,
  };
}

export function applyVariableFulfillmentAdjustment(line, input = {}, { actorId = 'local-owner', at = new Date().toISOString() } = {}) {
  if (!hasVariablePricing(line)) {
    throw domainError('Este producto tiene precio y cantidad definitivos; no requiere ajuste durante el alistamiento.', 'order_line_not_variable');
  }
  const estimate = estimatedVariablePricing(line);
  const before = {
    actualWeightGrams: asPositiveInteger(line.actualWeightGrams),
    actualUnitPricePerKg: asPositiveInteger(line.actualUnitPricePerKg),
    actualLineTotal: asMoney(line.actualLineTotal) ?? asMoney(line.lineTotal) ?? 0,
  };
  let actualWeightGrams = before.actualWeightGrams;
  let actualUnitPricePerKg = before.actualUnitPricePerKg;
  let actualLineTotal;

  if (line.saleMode === 'weight') {
    actualWeightGrams = asPositiveInteger(input.actualWeightGrams);
    actualUnitPricePerKg = asPositiveInteger(input.actualUnitPricePerKg) ?? estimate.estimatedUnitPricePerKg;
    if (!actualWeightGrams || !actualUnitPricePerKg) {
      throw domainError('Registra el peso real y el precio por kilo para este producto.', 'invalid_actual_weight');
    }
    actualLineTotal = Math.round((actualWeightGrams * actualUnitPricePerKg) / 1000);
  } else {
    // A budget order has an estimated commercial value but no implied grams.
    // The tendero records its definitive amount without inventing a conversion.
    actualLineTotal = asMoney(input.actualLineTotal);
    if (actualLineTotal === null || actualLineTotal < 1) {
      throw domainError('Registra el subtotal definitivo para este producto.', 'invalid_actual_amount');
    }
  }

  const after = { actualWeightGrams, actualUnitPricePerKg, actualLineTotal };
  const adjustment = {
    at,
    actorId,
    type: 'fulfillment_variable_pricing',
    reason: adjustmentReason(input.reason, line.saleMode),
    before,
    after,
  };
  return {
    ...line,
    ...estimate,
    actualWeightGrams,
    actualUnitPricePerKg,
    actualLineTotal,
    lineTotal: actualLineTotal,
    fulfillmentAdjustments: [...(Array.isArray(line.fulfillmentAdjustments) ? line.fulfillmentAdjustments : []), adjustment],
  };
}

function domainError(message, code) {
  return Object.assign(new Error(message), { code, statusCode: 422 });
}
