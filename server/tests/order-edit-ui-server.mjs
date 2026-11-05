import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { seedOrderEdit } from './fixtures/order-edit.mjs';

// Local UI fixture: real HTTP routes/persistence, no Meta/Google/LLM calls.
globalThis.fetch = () => { throw new Error('External providers disabled in UI fixture'); };
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'via-order-edit-ui-'));
const { app, store, tools } = await createAppAsync({ storageDriver: 'json', dataFile: path.join(directory, 'store.json'),
  authRequired: false, csrfRequired: false, allowDevGoogleLogin: true, backgroundWorkersEnabled: false,
  allowLocalCatalogFallback: true, integrationOutboxEnabled: true, whatsappMode: 'mock' });
const reset = () => { seedOrderEdit(store, { pending: true }); store.save(); };
reset();
tools.liveGoogleContext = async () => null;
app.post('/_fixture/reset', (_request, response) => { reset(); response.json({ ok: true }); });
app.post('/_fixture/message', (_request, response) => {
  store.mutate(state => state.conversations[0].messages.push({ id: 'late-message', role: 'user', text: 'Gracias, aquí te espero.', createdAt: new Date().toISOString() }));
  response.json({ ok: true });
});
app.post('/_fixture/conflict', (_request, response) => {
  store.mutate(state => { state.ordersByTenant.andina[0].version++; });
  response.json({ ok: true });
});
const server = app.listen(3001, '127.0.0.1', () => console.log('Local order editor fixture: http://127.0.0.1:3001'));
process.on('SIGINT', () => server.close(async () => {
  assertLocalDirectory();
  await fs.rm(directory, { recursive: true, force: true }); process.exit(0);
}));
function assertLocalDirectory() { if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error('Unexpected fixture directory'); }
