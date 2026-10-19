import { SHEET_ORDER_STATUSES } from '../domain/orderStatus.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4';

export const GOOGLE_WORKSPACE_SHEETS = [
  { name: 'Catalogo', range: 'Catalogo!A1:J1000', columns: ['sku', 'nombre', 'categoria', 'marca', 'presentacion', 'precio', 'stock', 'aliases', 'activo', 'drive_file_id'] },
  { name: 'Clientes', range: 'Clientes!A1:H1000', columns: ['telefono_whatsapp', 'nombre', 'direccion_principal', 'barrio', 'notas', 'preferencias', 'creado_en', 'actualizado_en'] },
  { name: 'Pedidos', range: 'Pedidos!A1:M1000', columns: ['pedido_id', 'telefono_whatsapp', 'cliente', 'direccion', 'items_json', 'subtotal', 'estado', 'handoff_id', 'creado_en', 'actualizado_en', 'origen', 'llm_modelo', 'traza'] },
  { name: 'Configuracion', range: 'Configuracion!A1:D200', columns: ['clave', 'valor', 'descripcion', 'actualizado_en'] },
];

export class GoogleWorkspaceService {
  constructor({ config }) {
    this.config = config;
  }

  async exchangeAuthorizationCode({ code, redirectUri }) {
    const payload = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    return payload;
  }

  async refreshAccessToken(refreshToken) {
    const payload = await postForm('https://oauth2.googleapis.com/token', {
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    if (!payload.access_token) throw new Error('Google refresh did not return access_token');
    return payload.access_token;
  }

  async provisionWorkspace({ tenant, accessToken }) {
    const rootFolder = await this.createFolder({
      accessToken,
      name: `Ventas IA - ${tenant.name}`,
    });
    const folders = [];
    for (const name of ['Catalogo y soportes', 'Clientes', 'Pedidos']) {
      folders.push(await this.createFolder({ accessToken, name, parentId: rootFolder.id }));
    }
    const spreadsheet = await this.createSpreadsheet({
      accessToken,
      title: `Ventas IA Operacion - ${tenant.name}`,
      parentId: rootFolder.id,
    });
    await this.writeInitialSheets({ accessToken, spreadsheetId: spreadsheet.id, tenant });
    await this.applyValidationRules({ accessToken, spreadsheetId: spreadsheet.id, sheets: spreadsheet.sheets });
    return {
      tenantId: tenant.id,
      status: 'provisioned',
      mode: 'live',
      rootFolder,
      folders,
      spreadsheet: {
        id: spreadsheet.id,
        name: spreadsheet.name,
        url: spreadsheet.url,
        sheets: GOOGLE_WORKSPACE_SHEETS,
      },
      validationRules: validationRules(),
      provisionedAt: new Date().toISOString(),
    };
  }

  async createFolder({ accessToken, name, parentId }) {
    const payload = await googleFetch(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
      method: 'POST',
      accessToken,
      body: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
    });
    return {
      id: payload.id,
      name: payload.name ?? name,
      url: payload.webViewLink ?? null,
    };
  }

  async createSpreadsheet({ accessToken, title, parentId }) {
    const payload = await googleFetch(`${SHEETS_API}/spreadsheets`, {
      method: 'POST',
      accessToken,
      body: {
        properties: { title },
        sheets: GOOGLE_WORKSPACE_SHEETS.map((sheet) => ({ properties: { title: sheet.name } })),
      },
    });
    if (parentId && payload.spreadsheetId) {
      await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(payload.spreadsheetId)}?addParents=${encodeURIComponent(parentId)}&fields=id,parents`, {
        method: 'PATCH',
        accessToken,
        body: {},
      });
    }
    return {
      id: payload.spreadsheetId,
      name: title,
      url: payload.spreadsheetUrl ?? null,
      sheets: payload.sheets ?? [],
    };
  }

  async writeInitialSheets({ accessToken, spreadsheetId, tenant }) {
    const now = new Date().toISOString();
    const data = GOOGLE_WORKSPACE_SHEETS.map((sheet) => ({
      range: `${sheet.name}!A1:${columnName(sheet.columns.length)}2`,
      values: [
        sheet.columns,
        sheet.name === 'Configuracion'
          ? ['tenant_id', tenant.id, 'Identificador interno del cliente', now]
          : [],
      ].filter((row) => row.length),
    }));
    await googleFetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      accessToken,
      body: {
        valueInputOption: 'RAW',
        data,
      },
    });
  }

  async applyValidationRules({ accessToken, spreadsheetId, sheets }) {
    const pedidosSheetId = sheetIdByTitle(sheets, 'Pedidos');
    if (pedidosSheetId === null) return;
    await googleFetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      accessToken,
      body: {
        requests: [
          {
            setDataValidation: {
              range: {
                sheetId: pedidosSheetId,
                startRowIndex: 1,
                endRowIndex: 1000,
                startColumnIndex: 6,
                endColumnIndex: 7,
              },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: SHEET_ORDER_STATUSES.map((userEnteredValue) => ({ userEnteredValue })),
                },
                inputMessage: 'Estado valido del pedido',
                strict: true,
                showCustomUi: true,
              },
            },
          },
        ],
      },
    });
  }

  async readValues({ accessToken, spreadsheetId, range }) {
    const payload = await googleFetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
      method: 'GET',
      accessToken,
    });
    return payload.values ?? [];
  }

  async updateValues({ accessToken, spreadsheetId, range, values }) {
    return googleFetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: 'PUT',
      accessToken,
      body: {
        range,
        majorDimension: 'ROWS',
        values,
      },
    });
  }

  async clearValues({ accessToken, spreadsheetId, range }) {
    return googleFetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
      method: 'POST',
      accessToken,
      body: {},
    });
  }

  async appendValues({ accessToken, spreadsheetId, range, values }) {
    return googleFetch(`${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      accessToken,
      body: {
        range,
        majorDimension: 'ROWS',
        values,
      },
    });
  }
}

export function sandboxWorkspaceForTenant(tenant, connectionMode = 'sandbox_contract') {
  return {
    tenantId: tenant.id,
    status: 'provisioned',
    mode: connectionMode,
    rootFolder: {
      id: `gdrv-${tenant.id}-root`,
      name: `Ventas IA - ${tenant.name}`,
    },
    folders: [
      { id: `gdrv-${tenant.id}-catalogo`, name: 'Catalogo y soportes' },
      { id: `gdrv-${tenant.id}-clientes`, name: 'Clientes' },
      { id: `gdrv-${tenant.id}-pedidos`, name: 'Pedidos' },
    ],
    spreadsheet: {
      id: `gsheet-${tenant.id}-ops`,
      name: `Ventas IA Operacion - ${tenant.name}`,
      sheets: GOOGLE_WORKSPACE_SHEETS,
    },
    validationRules: validationRules(),
    provisionedAt: new Date().toISOString(),
  };
}

function validationRules() {
  return [
    'Catalogo.sku requerido y unico',
    'Catalogo.precio numerico mayor o igual a cero',
    'Catalogo.stock numerico mayor o igual a cero',
    'Clientes.telefono_whatsapp requerido',
    `Pedidos.estado limitado a ${SHEET_ORDER_STATUSES.join(', ')}`,
  ];
}

async function postForm(url, form) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Google API ${response.status}: ${shorten(JSON.stringify(payload))}`);
    error.statusCode = 502;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function googleFetch(url, { method = 'GET', accessToken, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Google API ${response.status}: ${shorten(JSON.stringify(payload))}`);
    error.statusCode = 502;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function sheetIdByTitle(sheets, title) {
  const sheet = sheets.find((item) => item.properties?.title === title);
  return sheet?.properties?.sheetId ?? null;
}

function columnName(count) {
  let value = count;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function shorten(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
