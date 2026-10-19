import { normalizePaymentMethods } from './paymentMethods.js';

const OWNER_EDITABLE_SECTIONS = new Map([
  ['businessHours', new Set(['start', 'end', 'weekdays'])],
  ['googleSheets', new Set(['range', 'catalogRange', 'customerProfilesRange', 'ordersRange'])],
  ['orderPolicy', new Set(['paymentMethods'])],
]);

const ADMIN_EDITABLE_SECTIONS = new Map([
  ['timezone', null],
  ['businessHours', new Set(['start', 'end', 'weekdays'])],
  ['saas', new Set(['planCode', 'includedDeliveries', 'includedInteractions', 'enforceEntitlement'])],
  ['whatsapp', new Set(['phoneNumberIdRef', 'verifyTokenRef', 'appSecretRef', 'accessTokenRef', 'phoneNumberId', 'wabaId', 'displayPhoneNumber', 'verifiedName'])],
  ['googleSheets', new Set(['spreadsheetIdRef', 'range', 'catalogRange', 'customerProfilesRange', 'ordersRange', 'primaryKey', 'refreshPolicy'])],
  ['googleDrive', new Set(['rootFolderRef', 'customerProfileFolderRef', 'filePolicyRef', 'refreshMode', 'allowedMimeTypes'])],
  ['llm', new Set(['provider', 'model', 'mode', 'simulator', 'apiKeyRef', 'baseUrlRef', 'temperature', 'maxTokens', 'timeoutMs', 'responseLanguage', 'allowedTasks', 'deprecated'])],
  ['agentPolicy', new Set(['tone', 'responseLanguage', 'missingQuantity', 'humanEscalation', 'allowedTasks'])],
  ['orderPolicy', new Set(['customerIdentifier', 'customerRequiredFields', 'missingQuantity', 'customerProfileStore', 'confirmedOrderStore', 'confirmedOrderHandoff', 'paymentMethods'])],
  ['secretsPolicy', null],
]);

export function sanitizeOwnerConfigPatch(patch = {}) {
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
    throw configError('La configuracion del cliente debe incluir al menos una seccion editable.');
  }

  const output = {};
  for (const [section, value] of Object.entries(patch)) {
    const allowedFields = OWNER_EDITABLE_SECTIONS.get(section);
    if (!allowedFields || !isPlainObject(value)) {
      throw configError(`La seccion ${section} solo puede ser administrada por la plataforma.`);
    }

    const cleanSection = {};
    for (const [field, fieldValue] of Object.entries(value)) {
      if (!allowedFields.has(field)) {
        throw configError(`El campo ${section}.${field} no es editable por el cliente.`);
      }
      cleanSection[field] = normalizeOwnerField(section, field, fieldValue);
    }
    output[section] = cleanSection;
  }
  return output;
}

export function sanitizeAdminConfigPatch(patch = {}) {
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
    throw configError('La configuracion administrativa debe incluir al menos una seccion.');
  }

  const output = {};
  for (const [section, value] of Object.entries(patch)) {
    const allowedFields = ADMIN_EDITABLE_SECTIONS.get(section);
    if (!ADMIN_EDITABLE_SECTIONS.has(section)) {
      throw configError(`La seccion ${section} no esta contemplada por el contrato de configuracion.`);
    }
    if (allowedFields === null) {
      output[section] = normalizeAdminValue(section, value);
      continue;
    }
    if (!isPlainObject(value)) {
      throw configError(`La seccion ${section} debe ser un objeto.`);
    }
    const cleanSection = {};
    for (const [field, fieldValue] of Object.entries(value)) {
      if (!allowedFields.has(field)) {
        throw configError(`El campo ${section}.${field} no esta contemplado por el contrato.`);
      }
      cleanSection[field] = normalizeAdminValue(`${section}.${field}`, fieldValue);
    }
    output[section] = cleanSection;
  }
  return output;
}

export function mergeTenantConfig(base, patch) {
  const output = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    output[key] = isPlainObject(value)
      ? mergeTenantConfig(output[key] ?? {}, value)
      : value;
  }
  return output;
}

function normalizeOwnerField(section, field, value) {
  if (section === 'orderPolicy' && field === 'paymentMethods') {
    return normalizePaymentMethodsValue(value);
  }
  if (section === 'businessHours' && field === 'weekdays') {
    if (!Array.isArray(value) || value.some((item) => !Number.isInteger(Number(item)) || Number(item) < 1 || Number(item) > 7)) {
      throw configError('businessHours.weekdays debe contener dias del 1 al 7.');
    }
    return [...new Set(value.map(Number))].sort((a, b) => a - b);
  }
  const normalized = String(value ?? '').trim();
  if (!normalized) throw configError(`${section}.${field} no puede quedar vacio.`);
  return normalized;
}

function normalizeAdminValue(field, value) {
  if (field === 'orderPolicy.paymentMethods') return normalizePaymentMethodsValue(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeAdminValue(field, item));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeAdminValue(`${field}.${key}`, item)]));
  }
  const normalized = String(value ?? '').trim();
  if (!normalized) throw configError(`${field} no puede quedar vacio.`);
  return normalized;
}

function normalizePaymentMethodsValue(value) {
  try {
    return normalizePaymentMethods(value);
  } catch (error) {
    throw configError(error.message);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function configError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  error.code = 'tenant_config_field_not_allowed';
  return error;
}
