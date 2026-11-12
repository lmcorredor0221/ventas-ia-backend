const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value ?? 0));

function changeLines(summary = {}) {
  const lines = (summary.itemChanges ?? []).map(change => {
    const before = change.before;
    const after = change.after;
    const label = after?.name ?? before?.name ?? 'Producto';
    if (change.type === 'added') return `• Agregado: ${label} = ${money(after.lineTotal)}`;
    if (change.type === 'removed') return `• Retirado: ${label}`;
    return `• Ajustado: ${label}: ${money(before.lineTotal)} → ${money(after.lineTotal)}`;
  });
  if (summary.deliveryFee) lines.push(`• Domicilio: ${money(summary.deliveryFee.before)} → ${money(summary.deliveryFee.after)}`);
  if (summary.paymentChanged) lines.push('• Se actualizó el medio de pago.');
  if (summary.deliveryChanged) lines.push('• Se actualizaron los datos de entrega.');
  return lines;
}

export function whatsappOrderSummary(order, { stage = 'confirmed' } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const pricing = order?.pricing ?? {};
  const lines = items.map(item => {
    const quantity = item.saleMode === 'amount' ? `por ${money(item.requestedAmount)}`
      : item.saleMode === 'weight' ? `${Number(item.actualWeightGrams ?? item.requestedWeightGrams ?? 0)} g a ${money(item.actualUnitPricePerKg ?? item.unitPricePerKg)}/kg`
        : `${item.quantity} x ${money(item.unitPrice)}`;
    const total = Number(item.lineTotal ?? 0);
    const estimate = Number(item.estimatedLineTotal);
    const estimateNote = Number.isSafeInteger(estimate) && estimate !== total ? ` (estimado: ${money(estimate)})` : '';
    return `• ${quantity} ${item.name ?? 'Producto'}${item.presentation ? ` (${item.presentation})` : ''} = ${money(total)}${estimateNote}`;
  });
  const updatedStage = ['updated', 'manual_review_found', 'manual_review_unavailable'].includes(stage);
  const title = updatedStage ? 'Resumen actualizado de tu pedido' : 'Resumen de tu pedido';
  const changes = updatedStage ? changeLines(order.customerChangeSummary) : [];
  const unavailableProduct = stage === 'manual_review_unavailable'
    ? order.customerChangeSummary?.unavailableProduct
      ?? order.manualProductReview?.lastResolution?.productName
      ?? null
    : null;
  const pendingManualReview = (order.manualProductReview?.lines ?? [])
    .filter(line => ['pending', 'awaiting_customer'].includes(line.status));
  const delivery = order.delivery === false ? 'No incluye domicilio' : money(pricing.deliveryFee ?? 0);
  const footer = updatedStage
    ? pendingManualReview.length
      ? 'La tienda actualizó el pedido y continúa revisando los productos pendientes antes de iniciar el alistamiento.'
      : order.customerReconfirmation?.status === 'required'
        ? stage === 'updated'
          ? `La tienda actualizó el pedido. El total cambió ${money(order.customerReconfirmation.difference)}. Antes de cualquier cobro adicional, confirma este ajuste por este chat.`
          : `La tienda terminó la revisión y actualizó el pedido. El total cambió ${money(order.customerReconfirmation.difference)}. Confirma este nuevo resumen antes de iniciar el alistamiento.`
        : unavailableProduct
          ? `La tienda no encontró ${unavailableProduct}; continuará con el pedido parcial ya confirmado.`
          : 'La tienda actualizó el pedido. Te informamos el valor definitivo durante el alistamiento.'
    : 'La tienda revisará y alistará este pedido.';
  return [
    `🛒 *${title}*`,
    `*Nombre:* ${order.customerName ?? 'Por confirmar'}`,
    `*Dirección:* ${order.deliveryAddress ?? 'Por confirmar'}`,
    '*Productos:*',
    ...lines,
    `*Subtotal:* ${money(pricing.subtotal ?? order.subtotal)}`,
    `*Domicilio:* ${delivery}`,
    `*Total:* ${money(pricing.total ?? order.subtotal)}`,
    `*Medio de pago:* ${order.paymentMethodLabel ?? order.paymentMethod ?? 'Por confirmar'}`,
    ...(changes.length ? ['*Cambios realizados:*', ...changes, `*Motivo:* ${order.customerChangeSummary?.reason ?? 'Ajuste realizado durante el alistamiento.'}`] : []),
    ...(unavailableProduct ? [`*Producto no disponible:* ${unavailableProduct}`] : []),
    `Referencia: ${order.id}`,
    footer,
  ].join('\n');
}
