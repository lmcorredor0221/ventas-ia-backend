const args = process.argv.slice(2);
const argumentValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const baseUrl = String(argumentValue('--url') ?? process.env.KEEP_ALIVE_URL ?? '').replace(/\/$/, '');
const healthPath = argumentValue('--path') ?? process.env.KEEP_ALIVE_PATH ?? '/health';
const timeoutMs = Number(process.env.KEEP_ALIVE_TIMEOUT_MS ?? 15_000);

if (!baseUrl) {
  throw new Error('KEEP_ALIVE_URL is required, for example https://ventas-ia-backend.onrender.com');
}

const healthUrl = `${baseUrl}${healthPath.startsWith('/') ? healthPath : `/${healthPath}`}`;

async function ping() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { 'user-agent': 'ventas-ia-render-keepalive/1.0' },
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
    console.log(JSON.stringify({ ok: true, url: healthUrl, status: response.status, at: new Date().toISOString() }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, url: healthUrl, error: error.message, at: new Date().toISOString() }));
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const ok = await ping();
if (!ok) process.exitCode = 1;
