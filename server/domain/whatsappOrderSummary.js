import { catalogLineTotal } from './deliveryPolicy.js';
import { normalizePaymentMethodId, paymentMethodLabel } from './paymentMethods.js';

const money = value => Number.isSafeInteger(value) && value >= 0 ? `$ ${value.toLocaleString('es-CO')}` : 'Por confirmar';
// User/catalog fields must not introduce headings, new lines or WhatsApp markup.
const field = value => String(value ?? '').replace(/[*_~`\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const comparable = value => field(value).toLocaleLowerCase('es-CO').replace(/,/g, '.').replace(/\s+/g, '');

/** Presentation only: the LLM decides when to quote. Never infer products,
 * quantities, delivery conditions or consent in this renderer. */
export function whatsappOrderSummary(order, { stage = 'review', paymentMethods = [] } = {}) {
  const pricing = order.pricing;
  const delivery = pricing?.delivery ?? order.delivery ?? true;
  const name = field(order.customerName);
  const address = field(order.deliveryAddress);
  const payment = field(order.paymentMethodLabel || (order.paymentMethod
    ? paymentMethodLabel(normalizePaymentMethodId(order.paymentMethod), paymentMethods) : ''));
  const items = order.items ?? [];
  let completeItems = items.length > 0;
  let calculatedSubtotal = 0;
  const lines = items.map(item => {
    const product = item.product ?? item;
    const label = field(product.name);
    const presentation = field(product.presentation);
    const displayName = `${label || 'Producto por confirmar'}${presentation && !comparable(label).includes(comparable(presentation)) ? ` (${presentation})` : ''}`;
    const amount = catalogLineTotal(item);
    const valid = Boolean(label) && Number.isSafeInteger(amount) && amount > 0
      && (item.lineTotal == null || item.lineTotal === amount)
      && (!item.resolution || item.resolution.status === 'resolved') && item.available !== false;
    completeItems &&= valid;
    if (valid) calculatedSubtotal += amount;
    if (item.saleMode === 'amount') return `• ${displayName}\n  Por valor solicitado: *${valid ? money(amount) : 'Por confirmar'}*`;
    const quantity = Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : '?';
    const price = item.product?.price ?? item.unitPrice;
    return `• ${displayName}\n  ${quantity} × ${Number.isSafeInteger(price) && price > 0 ? money(price) : 'Precio por confirmar'} = *${valid ? money(amount) : 'Por confirmar'}*`;
  });
  const subtotalValid = completeItems && Number.isSafeInteger(calculatedSubtotal)
    && pricing?.subtotal === calculatedSubtotal && (order.subtotal == null || order.subtotal === calculatedSubtotal);
  const fee = pricing?.deliveryFee;
  const feeValid = Number.isSafeInteger(fee) && fee >= 0 && (delivery || fee === 0);
  const totalValid = subtotalValid && feeValid && Number.isSafeInteger(pricing?.total)
    && pricing.total === calculatedSubtotal + fee;
  const complete = Boolean(name && (!delivery || address) && payment && totalValid && pricing?.canConfirm);
  const title = stage === 'received' ? 'Pedido recibido' : stage === 'updated' ? 'Pedido actualizado' : 'Resumen de tu pedido';
  const footer = !complete ? 'Hay datos por confirmar antes de cerrar el pedido.'
    : stage === 'received' ? 'Pedido recibido. La tienda lo revisará para alistarlo.'
      : stage === 'updated' ? 'Este es el resumen actualizado de los cambios acordados con la tienda.'
        : 'Revisa los productos y los datos de entrega. ¿Confirmamos tu pedido?';
  return { complete, text: [
    `🛒 *${title}*`,
    `*Nombre:* ${name || 'Por confirmar'}\n${delivery ? `*Dirección:* ${address || 'Por confirmar'}` : '*Entrega:* No incluye servicio de domicilio'}`,
    '*Productos*', ...lines,
    `*Subtotal de productos: ${subtotalValid ? money(calculatedSubtotal) : 'Por confirmar'}*\nDomicilio: ${feeValid ? money(fee) : 'Por confirmar'}${!delivery ? ' (no incluido)' : fee === 0 ? ' (sin costo)' : ''}\n*Total: ${totalValid ? money(pricing.total) : 'Por confirmar'}*`,
    `*Medio de pago:* ${payment || 'Por confirmar'}`,
    ...(stage !== 'review' && order.id ? [`Referencia: ${field(order.id)}`] : []),
    footer,
  ].join('\n\n') };
}

// Preserve product blocks when possible; never truncate a large order or split
// a Unicode surrogate pair. The joined parts equal the original message.
export function splitWhatsAppText(text, limit = 4096) {
  if (!Number.isSafeInteger(limit) || limit < 2) throw new RangeError('Invalid message limit');
  const parts = [];
  let remaining = String(text);
  while (remaining.length > limit) {
    let end = limit;
    for (const separator of ['\n\n', '\n', ' ']) {
      const boundary = remaining.lastIndexOf(separator, limit - separator.length);
      if (boundary > 0) { end = boundary + separator.length; break; }
    }
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) parts.push(remaining);
  return parts;
}
