export function normalizePaymentMethodId(value = '') {
  const id = String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
  if (['breb', 'bre_b'].includes(id)) return 'bre_b';
  if (['efectivo', 'cash'].includes(id)) return 'cash';
  if (['tarjeta', 'card_terminal'].includes(id)) return 'card_terminal';
  return id;
}
