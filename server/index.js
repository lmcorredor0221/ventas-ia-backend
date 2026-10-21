import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
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
import { OrderService } from './services/orderService.js';
import { resolveCorsOrigins, validateRuntimeConfig } from './configValidation.js';
import { IntegrationOutbox } from './services/integrationOutbox.js';

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
  const runtimeValidation = validateRuntimeConfig(config);
  const events = new EventService(store);
  const usage = new UsageService({ store, events });
  const secretVault = new SecretVault({ store });
  const googleWorkspace = new GoogleWorkspaceService({ config });
  const tools = new ToolRegistry({ store, events, usage, config, googleWorkspace, secretVault });
  let runtime;
  const integrationOutbox = new IntegrationOutbox({
    store,
    config,
    handlers: {
      'order.sheet_projection': async (entry) => {
        const order = Object.values(store.getState().ordersByTenant ?? {})
          .flat()
          .find((item) => item.id === entry.payload.orderId && item.tenantId === entry.payload.tenantId);
        if (!order) throw new Error(`Order ${entry.payload.orderId} not found for outbox projection`);
        const result = await tools.syncLiveOrderStatus({
          tenantId: entry.payload.tenantId,
          order,
          status: entry.payload.status,
          updatedAt: entry.payload.updatedAt,
        });
        if (result.status === 'synced') {
          store.mutate((state) => {
            const current = (state.ordersByTenant?.[entry.payload.tenantId] ?? []).find((item) => item.id === entry.payload.orderId);
            if (!current) return;
            current.sheetSyncStatus = 'synced';
            current.sheetSyncedAt = new Date().toISOString();
          });
          await store.persistOrder?.(entry.payload.tenantId, entry.payload.orderId);
        }
        return result;
      },
      'order.sheet_create': async (entry) => {
        const order = Object.values(store.getState().ordersByTenant ?? {})
          .flat()
          .find((item) => item.id === entry.payload.orderId && item.tenantId === entry.payload.tenantId);
        if (!order) throw new Error(`Order ${entry.payload.orderId} not found for outbox creation`);
        const result = await tools.appendOrderProjection({
          tenantId: entry.payload.tenantId,
          order,
        });
        store.mutate((state) => {
          const current = (state.ordersByTenant?.[entry.payload.tenantId] ?? []).find((item) => item.id === entry.payload.orderId);
          if (!current) return;
          current.sheetSyncStatus = result.status === 'synced' ? 'synced' : current.sheetSyncStatus;
          if (result.status === 'synced') current.sheetSyncedAt = new Date().toISOString();
          if (result.sourceRef) current.sheetSourceRef = result.sourceRef;
        });
        await store.persistOrder?.(entry.payload.tenantId, entry.payload.orderId);
        return result;
      },
      'order.dispatch_notification': async (entry) => {
        const order = Object.values(store.getState().ordersByTenant ?? {})
          .flat()
          .find((item) => item.id === entry.payload.orderId && item.tenantId === entry.payload.tenantId);
        if (!order) throw new Error(`Order ${entry.payload.orderId} not found for dispatch notification`);
        if (order.dispatchNotification?.sentAt) return { status: 'already_sent', sentAt: order.dispatchNotification.sentAt };
        const conversation = store.getState().conversations.find((item) => item.id === order.conversationId);
        const waId = order.waId ?? conversation?.waId ?? entry.payload.waId;
        if (!waId) throw new Error(`Order ${order.id} has no WhatsApp recipient for dispatch notification`);
        const delivery = await tools.call('whatsapp_business_messaging', order.tenantId, order.conversationId, {
          action: 'send_session_message',
          wa_id: waId,
          text: `Tu pedido ${order.id} ya va en camino. Gracias por comprar con nosotros.`,
        });
        const sentAt = new Date().toISOString();
        store.mutate((state) => {
          const current = (state.ordersByTenant?.[order.tenantId] ?? []).find((item) => item.id === order.id);
          if (!current) return;
          current.dispatchNotification = {
            ...(current.dispatchNotification ?? {}),
            status: 'sent',
            sentAt,
            providerMessageId: delivery?.message_id ?? null,
          };
        });
        await store.persistOrder?.(order.tenantId, order.id);
        return { status: 'sent', sentAt, providerMessageId: delivery?.message_id ?? null };
      },
      'whatsapp.inbound_processing': async (entry) => {
        if (!runtime) throw new Error('Inbound worker started before agent runtime initialization');
        return runtime.processQueuedInbound(entry.payload.messageId);
      },
    },
  });
  tools.setOutbox?.(integrationOutbox);
  const orders = new OrderService({ store, events, tools, outbox: integrationOutbox });
  const planner = new LLMPlanner({ store, events, usage, config });
  runtime = new AgentRuntime({ store, events, tools, planner, usage, config, orders });
  if (config.backgroundWorkersEnabled) {
    runtime.start();
    integrationOutbox.start();
  }
  const controlPlane = new SaasControlPlane({ store, events, config, googleWorkspace, secretVault });
  const auth = new AuthService({ store, events, config });

  const app = express();
  const allowedOrigins = resolveCorsOrigins(config);
  app.use((req, res, next) => {
    req.requestId = req.get('x-request-id') || crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error('CORS origin not allowed');
      error.statusCode = 403;
      error.code = 'cors_origin_not_allowed';
      return callback(error);
    },
  }));
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
  app.get('/health/ready', (_req, res) => {
    const ready = runtimeValidation.errors.length === 0;
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: 'ventas-ia-agent-backend',
      production: runtimeValidation.production,
      warnings: runtimeValidation.warnings,
      errors: runtimeValidation.errors,
      storageDriver: config.storageDriver,
      whatsappMode: config.whatsappMode,
      time: new Date().toISOString(),
    });
  });
  app.use('/api/auth', createAuthRouter({ auth }));
  app.use('/api/billing', createBillingRouter({ controlPlane, auth }));
  app.use('/api/saas', createSaasRouter({ controlPlane, auth }));
  app.use('/api/admin', createAdminRouter({ store, usage, auth, controlPlane }));
  app.use('/api', createApiRouter({ store, events, runtime, tools, orders, controlPlane, usage, auth }));
  app.use('/webhooks', createWhatsAppRouter({ store, runtime, controlPlane, config }));
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

  return { app, store, events, tools, orders, planner, runtime, integrationOutbox, controlPlane, usage, auth, config, googleWorkspace, secretVault };
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (entryPath === modulePath) {
  const runtime = await createAppAsync();
  const { app, config } = runtime;
  app.listen(config.port, config.host, () => {
    console.log(`Ventas IA backend listening on http://${config.host}:${config.port} (${config.storageDriver})`);
  });
  const shutdown = async (signal) => {
    console.log(`Shutting down after ${signal}`);
    runtime.runtime.stop();
    await runtime.integrationOutbox.stop();
    await runtime.store.close?.();
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}
