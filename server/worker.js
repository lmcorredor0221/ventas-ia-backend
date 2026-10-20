import { createAppAsync } from './index.js';

const runtime = await createAppAsync({ backgroundWorkersEnabled: true });

console.log(`Ventas IA worker running (${runtime.config.storageDriver})`);

const shutdown = async (signal) => {
  console.log(`Worker shutting down after ${signal}`);
  runtime.runtime.stop();
  await runtime.integrationOutbox.stop();
  await runtime.store.close?.();
  process.exit(0);
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
