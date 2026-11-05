// Provider transport only: no catalog or conversation decisions.
export class LlmProviderGateway {
  async request({ config, prompt, reply = false, attempts = 3 }) {
    const provider = config.provider ?? 'deepseek';
    const apiKey = resolveSecret(config.apiKeyRef, defaultKeyNames(provider));
    if (!apiKey) throw new Error('LLM provider credential unavailable');
    const call = provider === 'google'
      ? (reply ? callGeminiReply : callGemini)
      : (reply ? callChatReply : callChatCompletions);
    return retryTransientProviderCall(() => call({ config, apiKey, prompt }), { attempts });
  }
}

async function callChatCompletions({ config, apiKey, prompt }) {
  const provider = config.provider ?? 'deepseek';
  const url = resolveBaseUrl(config, provider) ?? (provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions');
  const startedAt = Date.now();
  const model = config.model ?? defaultModel(provider);
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: Number(config.temperature ?? 0),
      max_tokens: Number(config.maxTokens ?? 1200),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Responde exclusivamente JSON valido para el contrato solicitado.' },
        { role: 'user', content: prompt },
      ],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  return {
    plan: JSON.parse(stripJson(payload.choices?.[0]?.message?.content ?? '{}')),
    providerMetadata: {
      provider,
      model,
      endpoint: redactedEndpoint(url),
      durationMs: Date.now() - startedAt,
      usage: payload.usage ?? null,
    },
  };
}

async function callChatReply({ config, apiKey, prompt }) {
  const provider = config.provider ?? 'deepseek';
  const url = resolveBaseUrl(config, provider) ?? (provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions');
  const startedAt = Date.now();
  const model = config.model ?? defaultModel(provider);
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: Number(config.temperature ?? 0.2),
      max_tokens: Number(config.maxTokens ?? 350),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Responde exclusivamente JSON valido para el contrato solicitado.' },
        { role: 'user', content: prompt },
      ],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  const parsed = JSON.parse(stripJson(payload.choices?.[0]?.message?.content ?? '{}'));
  return {
    text: String(parsed.reply ?? '').trim(),
    providerMetadata: {
      provider,
      model,
      endpoint: redactedEndpoint(url),
      durationMs: Date.now() - startedAt,
      usage: payload.usage ?? null,
    },
  };
}

async function callGemini({ config, apiKey, prompt }) {
  const model = config.model ?? defaultModel('google');
  const baseUrl = resolveBaseUrl(config, 'google') ?? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const startedAt = Date.now();
  const endpoint = `${baseUrl}${joiner}key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: Number(config.temperature ?? 0),
        maxOutputTokens: Number(config.maxTokens ?? 1200),
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`google API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  return {
    plan: JSON.parse(stripJson(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}')),
    providerMetadata: {
      provider: 'google',
      model,
      endpoint: redactedEndpoint(endpoint),
      durationMs: Date.now() - startedAt,
      usage: payload.usageMetadata ?? null,
    },
  };
}

async function callGeminiReply({ config, apiKey, prompt }) {
  const model = config.model ?? defaultModel('google');
  const baseUrl = resolveBaseUrl(config, 'google') ?? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const endpoint = `${baseUrl}${joiner}key=${encodeURIComponent(apiKey)}`;
  const startedAt = Date.now();
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: Number(config.temperature ?? 0.2),
        maxOutputTokens: Number(config.maxTokens ?? 350),
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`google API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  const parsed = JSON.parse(stripJson(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'));
  return {
    text: String(parsed.reply ?? '').trim(),
    providerMetadata: {
      provider: 'google',
      model,
      endpoint: redactedEndpoint(endpoint),
      durationMs: Date.now() - startedAt,
      usage: payload.usageMetadata ?? null,
    },
  };
}

function resolveBaseUrl(config, provider) {
  const value = config.baseUrl ?? resolveSecret(config.baseUrlRef, defaultBaseUrlNames(provider));
  if (!value) return null;
  if (provider === 'deepseek' && !value.endsWith('/chat/completions')) return `${value.replace(/\/$/, '')}/chat/completions`;
  if (provider === 'openai' && !value.endsWith('/chat/completions')) return `${value.replace(/\/$/, '')}/chat/completions`;
  return value;
}

function resolveSecret(ref, fallbackNames) {
  const names = [ref, ...(fallbackNames ?? [])].filter(Boolean);
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function defaultKeyNames(provider) {
  if (provider === 'openai') return ['OPENAI_API_KEY'];
  if (provider === 'google') return ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
  return ['DEEPSEEK_API_KEY'];
}

function defaultBaseUrlNames(provider) {
  if (provider === 'openai') return ['OPENAI_BASE_URL'];
  if (provider === 'google') return ['GEMINI_BASE_URL', 'GOOGLE_GENERATIVE_LANGUAGE_BASE_URL'];
  return ['DEEPSEEK_BASE_URL'];
}

export function defaultModel(provider) {
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'google') return 'gemini-1.5-flash';
  if (provider === 'mock') return 'mock-structured-parser';
  return 'deepseek-chat';
}

export function stripJson(value) {
  return String(value)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, text: async () => body };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`LLM API timeout after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Tres intentos acotados absorben cortes breves de red o respuestas temporales
// del proveedor sin convertir una degradacion real en una espera indefinida.
async function retryTransientProviderCall(action, { attempts = 3, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientProviderError(error)) throw error;
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

function isTransientProviderError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('fetch failed')
    || message.includes('timeout')
    || /api\s+(429|5\d\d)\b/.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function redactedEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has('key')) url.searchParams.set('key', '***');
    return url.toString();
  } catch {
    return String(value ?? '').replace(/key=[^&]+/i, 'key=***');
  }
}
