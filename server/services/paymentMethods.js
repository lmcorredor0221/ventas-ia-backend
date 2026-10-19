const BASE_PAYMENT_METHODS = [
  {
    id: 'cash',
    label: 'Efectivo',
    aliases: ['efectivo', 'cash'],
    enabled: true,
  },
  {
    id: 'card_terminal',
    label: 'Tarjeta',
    aliases: ['tarjeta', 'tarjeta debito', 'tarjeta débito', 'tarjeta credito', 'tarjeta crédito', 'datafono', 'datáfono', 'card_terminal'],
    enabled: true,
  },
  {
    id: 'breb',
    label: 'Bre-B',
    aliases: ['bre-b', 'bre b', 'breb'],
    enabled: true,
  },
];

export const DEFAULT_PAYMENT_METHODS = Object.freeze(BASE_PAYMENT_METHODS.map((method) => Object.freeze({
  ...method,
  aliases: Object.freeze([...method.aliases]),
})));

export function paymentMethodsForTenant(tenant) {
  return normalizePaymentMethods(tenant?.config?.orderPolicy?.paymentMethods);
}

export function normalizePaymentMethods(value) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error('orderPolicy.paymentMethods debe ser una lista de medios de pago.');
  }
  const methodsById = new Map(DEFAULT_PAYMENT_METHODS.map((method) => [method.id, cloneMethod(method)]));

  for (const rawMethod of value ?? []) {
    if (!rawMethod || typeof rawMethod !== 'object' || Array.isArray(rawMethod)) {
      throw new Error('Cada medio de pago debe incluir identificador y nombre.');
    }
    const id = normalizeId(rawMethod.id ?? rawMethod.label);
    const label = String(rawMethod.label ?? '').trim();
    if (!id || !label) throw new Error('Cada medio de pago debe incluir identificador y nombre.');
    if (label.length > 64) throw new Error('El nombre de un medio de pago no puede superar 64 caracteres.');
    const aliases = uniqueStrings([label, ...(Array.isArray(rawMethod.aliases) ? rawMethod.aliases : [])]);
    const base = methodsById.get(id);
    methodsById.set(id, {
      id,
      label,
      aliases: uniqueStrings([...(base?.aliases ?? []), ...aliases]),
      // Efectivo, tarjeta y Bre-B siempre se mantienen disponibles como base.
      enabled: base ? true : rawMethod.enabled !== false,
    });
  }

  return [...methodsById.values()];
}

export function resolvePaymentMethod(value, methods = DEFAULT_PAYMENT_METHODS) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return null;
  const matches = normalizePaymentMethods(methods)
    .filter((method) => method.enabled !== false)
    .flatMap((method) => uniqueStrings([method.id, method.label, ...(method.aliases ?? [])])
      .map((alias) => ({ method, alias: normalizeText(alias) }))
      .filter((candidate) => candidate.alias && includesPaymentAlias(normalizedValue, candidate.alias)))
    .sort((left, right) => right.alias.length - left.alias.length);
  return matches[0]?.method ?? null;
}

export function paymentMethodLabel(paymentMethod, methods = DEFAULT_PAYMENT_METHODS) {
  return resolvePaymentMethod(paymentMethod, methods)?.label ?? null;
}

export function paymentMethodOptionsLabel(methods = DEFAULT_PAYMENT_METHODS) {
  return joinSpanish(normalizePaymentMethods(methods)
    .filter((method) => method.enabled !== false)
    .map((method) => method.label));
}

function cloneMethod(method) {
  return { ...method, aliases: [...(method.aliases ?? [])] };
}

function normalizeId(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function uniqueStrings(values) {
  const seen = new Set();
  return values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function includesPaymentAlias(text, alias) {
  if (!alias) return false;
  const expression = new RegExp(`(^|\\s)${escapeRegex(alias).replace(/\\ /g, '\\s+')}($|\\s)`, 'u');
  return expression.test(text);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinSpanish(items) {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} o ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} o ${items.at(-1)}`;
}
