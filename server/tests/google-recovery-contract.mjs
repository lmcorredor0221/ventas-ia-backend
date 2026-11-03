import assert from 'node:assert/strict';
import { ToolRegistry } from '../services/toolRegistry.js';
import { AgentRuntime } from '../services/agentRuntime.js';

const state = {
  tenants: [{ id: 'store', config: { googleOAuth: { status: 'connected' } }, lifecycle: {} }],
  conversations: [], pendingRequests: [], processedMessages: [], auditEvents: [],
  googleConnectionsByTenant: {
    store: { status: 'connected', mode: 'live', refreshTokenRef: 'ref', connectedAt: 'first' },
    other: { status: 'connected', mode: 'live', refreshTokenRef: 'other' },
  },
  googleWorkspacesByTenant: { store: { status: 'provisioned', spreadsheet: { id: 'existing-sheet' } } },
};
const events = [];
const store = {
  getState: () => state, mutate: fn => fn(state),
  async persistTenantCritical(id) { assert.equal(id, 'store'); },
  async persistConversation() {}, async persistPendingRequest() {},
  async claimProcessedMessage(id) {
    if (state.processedMessages.includes(id)) return false;
    state.processedMessages.push(id); return true;
  },
};
let refreshes = 0;
let failure = Object.assign(new Error('Revoked'), { payload: { error: 'invalid_grant' } });
const sheetRows = [['pedido_id']];
let appends = 0;
const googleWorkspace = {
  async refreshAccessToken() { refreshes++; if (failure) throw failure; return `access-${refreshes}`; },
  async readValues() { return sheetRows; },
  async appendValues({ values }) { appends++; sheetRows.push(...values); },
  async updateValues({ values }) { sheetRows[1] = values[0]; },
};
const tools = new ToolRegistry({ store, events: { emit: e => events.push(e) },
  config: { allowLocalCatalogFallback: false }, googleWorkspace,
  secretVault: { readSecret: () => 'private-test-refresh' } });
const result = await tools.googleSheetsCustomerProfileLookup('store', { wa_id: 'customer' });
assert.equal(result.status, 'connection_required');
assert.equal(state.googleConnectionsByTenant.store.status, 'reconnect_required');
assert.equal(state.googleConnectionsByTenant.other.status, 'connected');
assert.equal(state.googleWorkspacesByTenant.store.spreadsheet.id, 'existing-sheet');
assert.equal(events.filter(e => e.type === 'integration.reconnect_required').length, 1);
await assert.rejects(tools.appendOrderProjection({ tenantId: 'store', order: { id: 'order-1' } }), { code: 'google_connection_required' });

let replies = 0;
const realCall = tools.call.bind(tools);
tools.call = async (name, ...args) => {
  if (name === 'whatsapp_business_messaging') { replies++; return { status: 'sent' }; }
  return realCall(name, ...args);
};
const runtime = new AgentRuntime({ store, events: { emit: e => events.push(e) }, tools,
  planner: { plan: () => { throw new Error('No se debe interpretar un catálogo inaccesible'); } }, config: {}, usage: null });
const message = { tenantId: 'store', waId: 'customer', messageId: 'wamid.revoked',
  messageType: 'text', text: 'Un chocorramo y una coca cola 400' };
await runtime.processInbound(message);
assert.equal(state.pendingRequests.length, 1);
assert.equal(replies, 1);
assert.equal(state.conversations[0].status, 'blocked');
assert.equal((await runtime.processInbound(message)).duplicate, true);
assert.equal(state.pendingRequests.length, 1);
assert.equal(replies, 1, 'Un webhook repetido no repite la notificación');

state.googleConnectionsByTenant.store = { ...state.googleConnectionsByTenant.store, status: 'connected', connectedAt: 'second' };
failure = new Error('Google temporalmente no disponible');
await assert.rejects(tools.liveGoogleContext('store'), /temporalmente/);
assert.equal(state.googleConnectionsByTenant.store.status, 'connected', 'Un timeout no revoca la conexión');
failure = null;
const first = await tools.liveGoogleContext('store');
state.googleConnectionsByTenant.store = { ...state.googleConnectionsByTenant.store, connectedAt: 'third' };
const rotated = await tools.liveGoogleContext('store');
assert.notEqual(rotated.accessToken, first.accessToken, 'La rotación invalida la caché aun con la misma referencia');
const order = { id: 'order-1', status: 'dispatched', items: [], updatedAt: new Date().toISOString() };
await tools.appendOrderProjection({ tenantId: 'store', order });
await tools.appendOrderProjection({ tenantId: 'store', order });
assert.equal(appends, 1, 'Reintentar una proyección no duplica el pedido en Sheets');
console.log('Google recovery and Sheets reconciliation contracts passed');
