import assert from 'node:assert/strict';
import { resolveCorsOrigins, validateRuntimeConfig } from '../configValidation.js';

const productionConfig = {
  storageDriver: 'postgres',
  databaseUrl: 'postgres://example',
  authRequired: true,
  csrfRequired: true,
  allowDevGoogleLogin: false,
  allowLocalCatalogFallback: false,
  frontendAppUrl: 'https://app.example.com',
  whatsappMode: 'live',
};
const productionEnv = {
  NODE_ENV: 'production',
  WHATSAPP_APP_SECRET: 'secret',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  SECRET_ENCRYPTION_KEY: 'key',
  DEEPSEEK_API_KEY: 'key',
};

assert.equal(validateRuntimeConfig(productionConfig, productionEnv).production, true);
assert.throws(
  () => validateRuntimeConfig({ ...productionConfig, whatsappMode: 'mock' }, productionEnv),
  /WHATSAPP_PROVIDER_MODE=live/,
);

const localPostgres = validateRuntimeConfig({
  storageDriver: 'postgres',
  databaseUrl: 'postgres://local',
  authRequired: false,
  csrfRequired: false,
  allowDevGoogleLogin: true,
  allowLocalCatalogFallback: true,
  frontendAppUrl: 'http://127.0.0.1:3001',
  whatsappMode: 'mock',
}, { NODE_ENV: 'development' });
assert.equal(localPostgres.errors.length, 0);

assert.deepEqual(
  resolveCorsOrigins({ frontendAppUrl: 'https://app.example.com' }, { NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://other.example.com' }),
  ['https://other.example.com', 'https://app.example.com'],
);

console.log('Runtime config validation tests passed');
