import { conversations, pendingRequests, tenants, tools } from '../../src/data/acpModel.js';

const now = () => new Date().toISOString();

export function createSeedState() {
  return {
    schemaVersion: 'ventas-ia-backend-store.v1',
    seededAt: now(),
    tenants: tenants.map((tenant) => ({
      ...tenant,
      config: {
        timezone: 'America/Bogota',
        businessHours: { start: '08:00', end: '18:00', weekdays: [1, 2, 3, 4, 5] },
        whatsapp: {
          phoneNumberIdRef: `${tenant.id.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
          verifyTokenRef: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF',
          appSecretRef: 'WHATSAPP_APP_SECRET_REF',
          accessTokenRef: 'WHATSAPP_ACCESS_TOKEN_REF',
          phoneNumberId: tenant.id === 'andina' ? '100000000001' : tenant.id === 'norte' ? '100000000002' : '100000000003',
        },
        googleSheets: {
          spreadsheetIdRef: `${tenant.id.toUpperCase()}_CATALOG_SPREADSHEET_ID_REF`,
          range: 'Catalogo!A1:H500',
          primaryKey: 'sku',
          refreshPolicy: 'short_ttl',
        },
        googleDrive: {
          filePolicyRef: `${tenant.id.toUpperCase()}_DRIVE_FILE_POLICY_REF`,
          allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
          refreshMode: 'on_demand',
        },
        secretsPolicy: 'references_only_no_plaintext_values',
      },
    })),
    tools: tools.map((tool) => ({
      ...tool,
      bindingCategory: 'design_contract',
      providerMode: 'mock',
      lastSmokeTest: null,
    })),
    productsByTenant: {
      andina: [
        { sku: 'AND-MOS-12', name: 'Mostrador modular 12U', price: 1280000, stock: 18, category: 'mobiliario', driveFileId: 'drv-and-mos-12' },
        { sku: 'AND-VIT-04', name: 'Vitrina comercial LED', price: 890000, stock: 9, category: 'exhibicion', driveFileId: 'drv-and-vit-04' },
        { sku: 'AND-TER-02', name: 'Terminal punto de pago', price: 4650000, stock: 4, category: 'pos', driveFileId: 'drv-and-ter-02' },
      ],
      norte: [
        { sku: 'NOR-REP-33', name: 'Kit repuesto premium', price: 2130000, stock: 7, category: 'repuestos', driveFileId: 'drv-nor-rep-33' },
        { sku: 'NOR-MOT-11', name: 'Motor auxiliar', price: 1750000, stock: 3, category: 'repuestos', driveFileId: 'drv-nor-mot-11' },
      ],
      aurora: [
        { sku: 'AUR-HOG-09', name: 'Set hogar Aurora', price: 710000, stock: 14, category: 'hogar', driveFileId: 'drv-aur-hog-09' },
      ],
    },
    driveFilesByTenant: {
      andina: [
        { fileId: 'drv-and-mos-12', name: 'Ficha mostrador modular.pdf', mimeType: 'application/pdf', summary: 'Dimensiones, colores y capacidad del mostrador modular.' },
        { fileId: 'drv-and-vit-04', name: 'Vitrina LED imagen.png', mimeType: 'image/png', summary: 'Imagen aprobada para soporte comercial.' },
      ],
      norte: [
        { fileId: 'drv-nor-rep-33', name: 'Ficha kit repuesto.pdf', mimeType: 'application/pdf', summary: 'Compatibilidad y garantia del kit.' },
      ],
      aurora: [
        { fileId: 'drv-aur-hog-09', name: 'Catalogo hogar.pdf', mimeType: 'application/pdf', summary: 'Ficha comercial del set Aurora.' },
      ],
    },
    conversations: conversations.map((conversation) => ({
      ...conversation,
      waId: conversation.id.replace('wa-', '57'),
      messages: [{ id: `msg-${conversation.id}-seed`, role: 'user', text: conversation.need, createdAt: now() }],
      updatedAt: now(),
      createdAt: now(),
    })),
    pendingRequests: pendingRequests.map((request) => ({
      ...request,
      status: 'pending',
      createdAt: now(),
      resolvedAt: null,
    })),
    events: conversations.slice(0, 5).map((conversation, index) => ({
      id: crypto.randomUUID(),
      at: now(),
      type: index % 2 === 0 ? 'agent.started' : 'tool.call.completed',
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      detail: `${conversation.lastTool} registrado desde seed ACP`,
      metadata: { source: 'seed' },
    })),
    processedMessages: [],
    transactions: [],
  };
}
