import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_CONFIG } from './config.js';
import { JsonStore } from './store/jsonStore.js';
import { PostgresStore } from './store/postgresStore.js';
import { EventService } from './services/events.js';
import { ToolRegistry } from './services/toolRegistry.js';
import { LLMPlanner } from './services/llmPlanner.js';
import { AgentRuntime } from './services/agentRuntime.js';
import { SaasControlPlane } from './services/saasControlPlane.js';
import { AuthService } from './services/authService.js';
import { UsageService } from './services/usageService.js';
import { SecretVault } from './services/secretVault.js';
import { GoogleWorkspaceService } from './services/googleWorkspaceService.js';
import { createApiRouter } from './routes/api.js';
import { createAuthRouter } from './routes/auth.js';
import { createBillingRouter } from './routes/billing.js';
import { createSaasRouter } from './routes/saas.js';
import { createWhatsAppRouter } from './routes/whatsapp.js';
import { createMercadoPagoRouter } from './routes/mercadoPago.js';
import { createAdminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function createApp(overrides = {}) {
  const config = { ...RUNTIME_CONFIG, ...overrides };
  const store = createStore(config);
  if (config.storageDriver === 'postgres') {
    throw new Error('Use createAppAsync() when STORAGE_DRIVER=postgres');
  }
  store.load();
  return createExpressRuntime({ config, store });
}

export async function createAppAsync(overrides = {}) {
  const config = { ...RUNTIME_CONFIG, ...overrides };
  const store = createStore(config);
  await store.load();
  return createExpressRuntime({ config, store });
}

function createStore(config) {
  if (config.storageDriver === 'postgres') {
    return new PostgresStore({
      databaseUrl: config.databaseUrl,
      ssl: config.databaseSsl,
    });
  }
  return new JsonStore(config.dataFile);
}

function createExpressRuntime({ config, store }) {
  const events = new EventService(store);
  const usage = new UsageService({ store, events });
  const secretVault = new SecretVault({ store });
  const googleWorkspace = new GoogleWorkspaceService({ config });
  const tools = new ToolRegistry({ store, events, usage, config, googleWorkspace, secretVault });
  const planner = new LLMPlanner({ store, events, usage, config });
  const runtime = new AgentRuntime({ store, events, tools, planner, usage, config });
  const controlPlane = new SaasControlPlane({ store, events, config, googleWorkspace, secretVault });
  const auth = new AuthService({ store, events, config });

  const app = express();
  app.use(cors());
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(auth.middleware());
  app.use(auth.csrfMiddleware());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'ventas-ia-agent-backend', version: '0.1.0', time: new Date().toISOString() });
  });
  app.use('/api/auth', createAuthRouter({ auth }));
  app.use('/api/billing', createBillingRouter({ controlPlane, auth }));
  app.use('/api/saas', createSaasRouter({ controlPlane, auth }));
  app.use('/api/admin', createAdminRouter({ store, usage, auth, controlPlane }));
  app.use('/api', createApiRouter({ store, events, runtime, tools, controlPlane, usage, auth }));
  app.use('/webhooks', createWhatsAppRouter({ store, runtime, controlPlane }));
  app.use('/webhooks', createMercadoPagoRouter({ controlPlane, store }));

  const distPath = path.join(rootDir, 'dist');
  app.use(express.static(distPath));
  app.get('*splat', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });

  app.use((error, _req, res, _next) => {
    if ((error.statusCode ?? 500) >= 500) console.error(error);
    res.status(error.statusCode ?? 500).json({
      error: error.message ?? 'Internal server error',
      code: error.code,
      status: error.status,
      validation: error.validation,
    });
  });

  return { app, store, events, tools, planner, runtime, controlPlane, usage, auth, config, googleWorkspace, secretVault };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (entryPath === modulePath) {
  const { app, config } = await createAppAsync();
  app.listen(config.port, config.host, () => {
    console.log(`Ventas IA backend listening on http://${config.host}:${config.port} (${config.storageDriver})`);
  });
}
