import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'via-google-selection-'));
const kit = await createAppAsync({
  dataFile: path.join(directory, 'store.json'),
  storageDriver: 'json',
  authRequired: false,
  csrfRequired: false,
});
const { controlPlane, store } = kit;
const current = {
  tenantId: 'andina',
  status: 'provisioned',
  mode: 'live',
  rootFolder: { id: 'folder-current', name: 'VIA actual' },
  customerProfileFolder: { id: 'folder-customers', name: 'Clientes' },
  folders: [],
  spreadsheet: { id: 'sheet-current', name: 'Hoja actual', sheets: [{ name: 'Catalogo' }] },
};

store.mutate((state) => {
  state.googleConnectionsByTenant.andina = { status: 'connected', mode: 'live', refreshTokenRef: 'google-refresh-ref' };
  state.googleWorkspacesByTenant.andina = current;
});
controlPlane.secretVault.readSecret = () => 'refresh-token';
controlPlane.googleWorkspace = {
  refreshAccessToken: async () => 'access-token',
  listSelectableResources: async () => ({
    spreadsheets: [{ id: 'sheet-correct', name: 'Catalogo de la tienda', mimeType: 'application/vnd.google-apps.spreadsheet' }],
    folders: [{ id: 'folder-correct', name: 'Archivos de la tienda', mimeType: 'application/vnd.google-apps.folder' }],
  }),
  getSpreadsheetMetadata: async () => ({
    spreadsheetId: 'sheet-correct',
    properties: { title: 'Catalogo de la tienda' },
    sheets: [{ properties: { title: 'Catalogo', sheetId: 7, index: 0 } }],
  }),
  getFileMetadata: async ({ fileId }) => ({
    id: fileId,
    name: 'Archivos de la tienda',
    mimeType: 'application/vnd.google-apps.folder',
    trashed: false,
  }),
};

try {
  const resources = await controlPlane.listGoogleResources('andina');
  assert.equal(resources.selectionSupported, true);
  assert.equal(resources.spreadsheets[0].id, 'sheet-correct');

  const selected = await controlPlane.selectGoogleResources('andina', {
    spreadsheetId: 'https://docs.google.com/spreadsheets/d/sheet-correct/edit',
    rootFolderId: 'https://drive.google.com/drive/folders/folder-correct',
    customerProfileFolderId: 'folder-customers',
  });
  assert.equal(selected.workspace.spreadsheet.id, 'sheet-correct');
  assert.equal(selected.workspace.rootFolder.id, 'folder-correct');
  assert.deepEqual(selected.workspace.spreadsheet.sheets[0], { name: 'Catalogo', sheetId: 7, index: 0 });
  assert.equal(store.getState().googleWorkspacesByTenant.andina.spreadsheet.id, 'sheet-correct');
  console.log('google-resource-selection-contract: ok');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
