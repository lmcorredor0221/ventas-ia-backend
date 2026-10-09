export const RUNTIME_CONFIG = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '127.0.0.1',
  dataFile: process.env.AGENT_DATA_FILE ?? 'server/data/runtime-store.json',
  defaultTenantId: process.env.DEFAULT_TENANT_ID ?? 'andina',
  timezone: process.env.AGENT_TIMEZONE ?? 'America/Bogota',
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v21.0',
  whatsappMode: process.env.WHATSAPP_PROVIDER_MODE ?? 'mock',
};

export const REQUIRED_EVENTS = [
  'agent.started',
  'agent.completed',
  'agent.failed',
  'decision.requested',
  'decision.resolved',
  'tool.binding.changed',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'fallback.activated',
  'budget.threshold_reached',
  'incident.opened',
  'incident.closed',
];
