export const DEFAULT_AGENT_NAME = 'Rocío';

// A display name is tenant data, never a custom system instruction.
export function normalizeAgentDisplayName(value) {
  if (typeof value !== 'string' || /[\r\n\t]/u.test(value)) throw invalidName();
  const name = value.normalize('NFC').trim().replace(/ +/g, ' ');
  if (!name || name.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M} .’'\-]*$/u.test(name)) throw invalidName();
  return name;
}

export function agentDisplayNameForTenant(tenant) {
  try { return normalizeAgentDisplayName(tenant?.config?.agentPolicy?.displayName); }
  catch { return DEFAULT_AGENT_NAME; }
}

function invalidName() {
  const error = new Error('El nombre del asistente debe tener entre 1 y 60 caracteres: letras, espacios, puntos, apóstrofes o guiones.');
  error.statusCode = 400;
  error.code = 'invalid_agent_display_name';
  return error;
}
