export function paymentMethodsForTenant(tenant) {
  const configured = tenant?.config?.orderPolicy?.paymentMethods
    ?? tenant?.config?.paymentMethods;
  const methods = Array.isArray(configured) ? configured : [];
  const normalized = methods
    .filter((method) => method && method.enabled !== false)
    .map((method) => typeof method === 'string'
      ? { id: normalizePaymentMethodId(method), label: paymentMethodLabel(method) }
      : { id: normalizePaymentMethodId(method.id ?? method.key ?? method.label), label: method.label ?? paymentMethodLabel(method.id ?? method.key) })
    .filter((method) => method.id && method.label);
  const unique = new Map();
  for (const method of normalized) {
    if (!unique.has(method.id)) unique.set(method.id, method);
  }
  const configuredMethods = [...unique.values()];
  return Array.isArray(configured) ? configuredMethods : [
    { id: 'cash', label: 'Efectivo' },
    { id: 'card_terminal', label: 'Tarjeta' },
    { id: 'bre_b', label: 'Bre-B' },
  ];
}

export function normalizePaymentMethodId(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (['efectivo', 'cash'].includes(normalized)) return 'cash';
  if (['tarjeta', 'datafono', 'card', 'card_terminal'].includes(normalized)) return 'card_terminal';
  if (['bre_b', 'breb'].includes(normalized)) return 'bre_b';
  return normalized;
}

export function paymentMethodLabel(value, configured = []) {
  const configuredMatch = (configured ?? []).find((method) => method.id === value || method.value === value);
  if (configuredMatch?.label) return configuredMatch.label;
  if (value === 'cash') return 'Efectivo';
  if (value === 'card_terminal') return 'Tarjeta';
  if (value === 'bre_b') return 'Bre-B';
  if (value === 'nequi') return 'Nequi';
  if (value === 'daviplata') return 'Daviplata';
  return String(value ?? 'la forma de pago');
}

function normalizeText(value) { return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }

export function paymentChoiceIssues(plan, methods) {
  const choice = plan.customerDelta?.paymentPreference;
  return choice && !methods.some(m => m.id === choice) ? ["customerDelta.paymentPreference must be an enabled paymentMethods ID, or null with unavailablePaymentPreference when unsupported"] : [];
}
