// Local fixture for tests/verify_manual_order.py in the frontend repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'via-manual-ui-'));
const runtime = await createAppAsync({ storageDriver: 'json', dataFile: path.join(directory, 'state.json'),
  backgroundWorkersEnabled: false, integrationOutboxEnabled: true, authRequired: true, csrfRequired: true,
  allowDevGoogleLogin: true, allowLocalCatalogFallback: true, whatsappSendMode: 'mock', manualCaseInactivityMinutes: 60,
  corsAllowedOrigins: ['http://127.0.0.1:5177'] });
const now = new Date().toISOString();
runtime.store.mutate(state => {
  state.conversations = [390, 1440, 320].map(width => ({ id: `manual-ui-${width}`, tenantId: 'andina', customer: `Atención manual ${width}`,
    waId: `57300000${width}`, status: 'manual_active', manualMode: 'whatsapp_external', aiPaused: true, stage: 'handoff', caseStatus: 'active', inboxState: 'active',
    manualLastActivityAt: now, messages: [], createdAt: now, updatedAt: now }));
  state.pendingRequests = [];
  state.ordersByTenant = {};
  state.productsByTenant.andina = [{ sku: 'milk', name: 'Leche Colanta', presentation: 'Bolsa 1 L', description: 'Entera', price: 4800, stock: 10 },
    { sku: 'bread', name: 'Pan tajado', presentation: '500 g', price: 5200, stock: 10 }];
});
// Fail closed: this fixture can only talk to its own browser/server.
const originalFetch = global.fetch;
global.fetch = (input, options) => { if (new URL(input).hostname !== '127.0.0.1') throw new Error('External HTTP disabled in local UI fixture'); return originalFetch(input, options); };
const server = runtime.app.listen(3001, '127.0.0.1', () => console.log('Manual order UI fixture ready at 127.0.0.1:3001'));
function close() { server.close(); fs.rmSync(directory, { recursive: true, force: true }); process.exit(0); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
