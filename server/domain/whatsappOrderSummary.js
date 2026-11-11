const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value ?? 0));

export function whatsappOrderSummary(order, { stage = 'confirmed' } = {}) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const pricing = order?.pricing ?? {};
  const lines = items.map(item => {
    const quantity = item.saleMode === 'amount' ? `por ${money(item.requestedAmount)}`
      : item.saleMode === 'weight' ? `${Number(item.requestedWeightGrams ?? 0)} g a ${money(item.unitPricePerKg)}/kg`
        : `${item.quantity} x ${money(item.unitPrice)}`;
    const total = Number(item.lineTotal ?? 0);
    return `• ${quantity} ${item.name ?? 'Producto'}${item.presentation ? ` (${item.presentation})` : ''} = ${money(total)}`;
  });
  const title = stage === 'updated' ? 'Resumen actualizado de tu pedido' : 'Resumen de tu pedido';
  const delivery = order.delivery === false ? 'No incluye domicilio' : money(pricing.deliveryFee ?? 0);
  const footer = stage === 'updated'
    ? 'La tienda actualizó el pedido. Si estás de acuerdo, confirma por este chat.'
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
    `Referencia: ${order.id}`,
    footer,
  ].join('\n');
}
