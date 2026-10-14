import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bogotaCatalogSeed } from '../server/data/bogotaCatalogSeed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

loadEnvFile(path.join(rootDir, '.env.google.local'));

const tenantId = process.argv[2] ?? 'tienda-piloto-google';
const { createAppAsync } = await import('../server/index.js');

const runtime = await createAppAsync();
const { store, secretVault, googleWorkspace } = runtime;

try {
  const state = store.getState();
  const tenant = state.tenants.find((item) => item.id === tenantId);
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  const workspace = state.googleWorkspacesByTenant?.[tenantId];
  const spreadsheetId = workspace?.spreadsheet?.id;
  if (!spreadsheetId) throw new Error(`Tenant ${tenantId} has no Google spreadsheet provisioned`);

  const connection = state.googleConnectionsByTenant?.[tenantId];
  const refreshToken = secretVault.readSecret(connection?.refreshTokenRef);
  if (!refreshToken) throw new Error(`Tenant ${tenantId} has no readable Google refresh token`);

  const accessToken = await googleWorkspace.refreshAccessToken(refreshToken);
  await writeCatalogToSheet({ accessToken, spreadsheetId, products: bogotaCatalogSeed });
  await writeCatalogMirror({ store, tenantId, products: bogotaCatalogSeed });
  await store.flush?.();

  console.log(JSON.stringify({
    tenantId,
    spreadsheetId,
    products: bogotaCatalogSeed.length,
    sheetUrl: workspace.spreadsheet.url,
  }, null, 2));
} finally {
  await store.close?.();
}

async function writeCatalogToSheet({ accessToken, spreadsheetId, products }) {
  const values = [
    ['sku', 'nombre', 'categoria', 'marca', 'presentacion', 'precio', 'stock', 'aliases', 'activo', 'drive_file_id'],
    ...products.map((product) => [
      product.sku,
      product.name,
      product.category,
      product.brand,
      product.presentation,
      product.price,
      product.stock,
      product.aliases.join('|'),
      product.active ? 'TRUE' : 'FALSE',
      product.driveFileId,
    ]),
  ];
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/Catalogo!A1:J${values.length}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Sheets update failed ${response.status}: ${JSON.stringify(payload)}`);
}

async function writeCatalogMirror({ store, tenantId, products }) {
  store.mutate((state) => {
    state.productsByTenant ??= {};
    state.driveFilesByTenant ??= {};
    const current = new Map((state.productsByTenant[tenantId] ?? []).map((item) => [item.sku, item]));
    for (const product of products) {
      current.set(product.sku, {
        sku: product.sku,
        name: product.name,
        category: product.category,
        price: product.price,
        stock: product.stock,
        driveFileId: product.driveFileId,
        aliases: product.aliases,
        brand: product.brand,
        presentation: product.presentation,
        active: product.active,
        updatedAt: new Date().toISOString(),
      });
    }
    state.productsByTenant[tenantId] = [...current.values()].sort((a, b) => a.sku.localeCompare(b.sku));
    state.driveFilesByTenant[tenantId] = products.map((product) => ({
      fileId: product.driveFileId,
      name: `${product.name} - ficha comercial`,
      mimeType: 'application/vnd.google-apps.document',
      summary: `${product.name}. Categoria: ${product.category}. Marca: ${product.brand}. Presentacion: ${product.presentation}. Precio base: ${product.price} COP. Alias: ${product.aliases.join(', ')}.`,
      productSku: product.sku,
      updatedAt: new Date().toISOString(),
    }));
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    if (!process.env[key]) process.env[key] = rest.join('=');
  }
}
