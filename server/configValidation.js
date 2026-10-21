export function validateRuntimeConfig(config, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];
  const add = (condition, message) => { if (!condition) errors.push(message); };

  if (production) {
    add(config.storageDriver === 'postgres' && Boolean(config.databaseUrl), 'Producción requiere STORAGE_DRIVER=postgres y DATABASE_URL.');
    add(config.authRequired === true, 'Producción requiere AUTH_REQUIRED=true.');
    add(config.csrfRequired === true, 'Producción requiere CSRF_REQUIRED=true.');
    add(config.allowDevGoogleLogin === false, 'Producción no puede permitir login Google de desarrollo.');
    add(config.allowLocalCatalogFallback === false, 'Producción no puede usar fallback local de catálogo.');
    add(config.frontendAppUrl?.startsWith('https://'), 'FRONTEND_APP_URL debe usar HTTPS en producción.');
    add(config.whatsappMode === 'live', 'Producción requiere WHATSAPP_PROVIDER_MODE=live.');
    add(Boolean(env.WHATSAPP_APP_SECRET || env.META_APP_SECRET), 'Producción requiere secreto de firma de WhatsApp.');
    add(Boolean(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN), 'Producción requiere WHATSAPP_WEBHOOK_VERIFY_TOKEN.');
    add(Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), 'Producción requiere credenciales OAuth de Google.');
    add(Boolean(env.SECRET_ENCRYPTION_KEY || env.GOOGLE_TOKEN_ENCRYPTION_KEY), 'Producción requiere clave para secretos cifrados.');
    add(Boolean(env.DEEPSEEK_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.ALLOW_PRODUCTION_SIMULATOR === 'true'), 'Producción requiere un proveedor LLM real o un simulador explícitamente autorizado.');
  } else {
    if (config.whatsappMode === 'mock') warnings.push('WhatsApp está en modo mock.');
    if (config.allowLocalCatalogFallback) warnings.push('El catálogo local está habilitado.');
  }

  if (errors.length) {
    const error = new Error(`Configuración de runtime inválida: ${errors.join(' ')}`);
    error.code = 'invalid_runtime_config';
    error.statusCode = 500;
    error.validation = { errors, warnings };
    throw error;
  }
  return { production, errors, warnings };
}

export function resolveCorsOrigins(config, env = process.env) {
  const configured = (config.corsAllowedOrigins?.length
    ? config.corsAllowedOrigins
    : String(env.CORS_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  const defaults = [config.frontendAppUrl].filter(Boolean);
  if (env.NODE_ENV !== 'production') defaults.push('http://127.0.0.1:5173', 'http://localhost:5173');
  return [...new Set([...configured, ...defaults])];
}
