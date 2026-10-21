import { ApiError } from './errors.js';

export async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs ?? 15_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    accept: 'application/json',
    'x-request-id': options.requestId ?? createRequestId(),
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(options.headers ?? {}),
  };
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(payload?.error ?? `La solicitud falló (${response.status}).`, {
        status: response.status,
        code: payload?.code ?? null,
        payload,
        url,
      });
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ApiError('La solicitud tardó demasiado. Revisa tu conexión e inténtalo de nuevo.', { code: 'request_timeout', url });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getJson(url, options = {}) {
  return requestJson(url, { ...options, method: 'GET' });
}

export function patchJson(url, body, options = {}) {
  return requestJson(url, { ...options, method: 'PATCH', body: JSON.stringify(body) });
}

export function postJson(url, body, options = {}) {
  return requestJson(url, { ...options, method: 'POST', body: JSON.stringify(body) });
}
