const amount = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function lineSnapshot(line = {}) {
  return {
    sku: String(line.sku ?? ''),
    name: line.name ?? 'Producto',
    presentation: line.presentation ?? '',
    saleMode: line.saleMode ?? 'units',
    quantity: line.quantity ?? null,
    requestedAmount: line.requestedAmount ?? null,
    requestedWeightGrams: line.requestedWeightGrams ?? null,
    actualWeightGrams: line.actualWeightGrams ?? line.requestedWeightGrams ?? null,
    unitPrice: line.unitPrice ?? null,
    unitPricePerKg: line.unitPricePerKg ?? null,
    actualUnitPricePerKg: line.actualUnitPricePerKg ?? line.unitPricePerKg ?? null,
    lineTotal: amount(line.actualLineTotal ?? line.lineTotal),
  };
}

function sameLine(before, after) {
  return JSON.stringify(lineSnapshot(before)) === JSON.stringify(lineSnapshot(after));
}

// This is not a business decision engine. It creates durable evidence of the
// commercial values a human already saved, so the customer can be told exactly
// what changed in the next WhatsApp summary.
export function summarizeCustomerOrderChange(before = {}, after = {}, { reason = '' } = {}) {
  const beforeBySku = new Map((before.items ?? []).map(line => [String(line.sku), line]));
  const afterBySku = new Map((after.items ?? []).map(line => [String(line.sku), line]));
  const itemChanges = [];
  for (const sku of new Set([...beforeBySku.keys(), ...afterBySku.keys()])) {
    const previous = beforeBySku.get(sku);
    const current = afterBySku.get(sku);
    if (!previous) itemChanges.push({ type: 'added', after: lineSnapshot(current) });
    else if (!current) itemChanges.push({ type: 'removed', before: lineSnapshot(previous) });
    else if (!sameLine(previous, current)) itemChanges.push({ type: 'changed', before: lineSnapshot(previous), after: lineSnapshot(current) });
  }
  const previousFee = amount(before.pricing?.deliveryFee);
  const currentFee = amount(after.pricing?.deliveryFee);
  const previousTotal = amount(before.pricing?.total ?? before.subtotal);
  const total = amount(after.pricing?.total ?? after.subtotal);
  const paymentChanged = (before.paymentMethod ?? '') !== (after.paymentMethod ?? '');
  const deliveryChanged = (before.deliveryAddress ?? '') !== (after.deliveryAddress ?? '') || Boolean(before.delivery) !== Boolean(after.delivery);
  const hasChanges = itemChanges.length > 0 || previousFee !== currentFee || previousTotal !== total || paymentChanged || deliveryChanged;
  return {
    hasChanges,
    reason: String(reason ?? '').trim() || 'Ajuste realizado durante el alistamiento.',
    itemChanges,
    deliveryFee: previousFee === currentFee ? null : { before: previousFee, after: currentFee },
    paymentChanged,
    deliveryChanged,
    previousTotal,
    total,
  };
}

export function summarizeVariablePricingChange(beforeOrder, afterOrder, { sku, reason = '' } = {}) {
  const summary = summarizeCustomerOrderChange(beforeOrder, afterOrder, { reason });
  const item = summary.itemChanges.find(change => String(change.after?.sku ?? change.before?.sku) === String(sku));
  return { ...summary, itemChanges: item ? [item] : summary.itemChanges };
}
