import { evaluateDeliveryPolicy } from '../../domain/deliveryPolicy.js';

export const catalog = [
  { sku: 'COLA', name: 'Coca-Cola original', presentation: '1.5 L', description: 'Gaseosa familiar', brand: 'Coca-Cola', price: 7200, stock: 40 },
  { sku: 'CHOCO', name: 'Ponqué Chocoramo', presentation: '65 g', description: 'Ponqué cubierto con chocolate', brand: 'Ramo', price: 2800, stock: 20 },
  { sku: 'MILK', name: 'Leche entera Colanta', presentation: '1 L', description: 'Leche entera en bolsa', price: 4800, stock: 10 },
  { sku: 'CHEESE', name: 'Queso campesino', presentation: '500 g', price: 15000, stock: 10, allowsSaleByAmount: true },
  { sku: 'EMPTY', name: 'Pan tajado', price: 6000, stock: 0 },
  { sku: 'RESTRICTED', name: 'Cerveza', category: 'Licores', price: 4000, stock: 20 },
];

export function seedOrderEdit(store, { pending = false } = {}) {
  const state = store.getState();
  const tenant = state.tenants.find(item => item.id === 'andina');
  tenant.config.orderPolicy = { ...(tenant.config.orderPolicy ?? {}), deliveryFee: 3000, deliveryMinimumSubtotal: 5000 };
  const now = new Date().toISOString();
  const items = catalog.slice(0, 2).map(product => ({ sku: product.sku, name: product.name, presentation: product.presentation,
    quantity: 1, unitPrice: product.price, saleMode: 'units', lineTotal: product.price }));
  const order = { id: 'ord-edit-local', tenantId: tenant.id, conversationId: 'chat-edit-local', waId: '573000000001',
    customerName: 'Cliente de prueba', deliveryAddress: 'Calle 100 # 20-30, Bogotá', delivery: true,
    paymentMethod: 'cash', status: pending ? 'pending_human_preparation' : 'preparing', version: 1,
    items, subtotal: 10000, pricing: evaluateDeliveryPolicy({ tenant, items, delivery: true, draftVersion: 1 }),
    createdAt: now, updatedAt: now };
  state.ordersByTenant = { andina: [order], norte: [{ ...structuredClone(order), tenantId: 'norte', id: 'ord-foreign', conversationId: 'chat-foreign' }] };
  state.conversations = [{ id: order.conversationId, tenantId: tenant.id, waId: order.waId, customer: order.customerName,
    status: 'live', stage: 'handoff', zone: 'agent', orderId: order.id, orderDraft: { items: structuredClone(items), version: 1 },
    manualWhatsApp: { active: true }, createdAt: now, updatedAt: now,
    messages: [
      { id: 'm1', role: 'user', text: 'Buenas, una Coca-Cola de litro y medio y un Chocoramo para domicilio.', createdAt: now },
      { id: 'm2', role: 'assistant', text: 'Claro. Los productos valen $10.000 y el domicilio $3.000. Total: $13.000.', createdAt: now },
      { id: 'm3', role: 'user', text: 'Confirmo. Pago en efectivo. Calle 100 # 20-30.', createdAt: now },
      { id: 'm4', role: 'human', text: 'Ya estamos alistando. ¿Necesitas cambiar algo?', createdAt: now },
      { id: 'm5', role: 'user', text: 'Veci, mejor dos gaseosas y cambia el Chocoramo por una leche Colanta. Pago por Bre-B.', createdAt: now },
    ] }];
  state.pendingRequests = pending ? [{ id: 'request-edit-local', tenantId: tenant.id, conversationId: order.conversationId,
    status: 'pending', type: 'approval', title: 'Pedido por preparar', urgency: 'Alta', action: 'prepare_delivery_order',
    createdAt: now, contextSnapshot: { orderId: order.id, items: structuredClone(items), subtotal: 10000, pricing: order.pricing } }] : [];
  state.integrationOutbox = [];
  state.productsByTenant.andina = structuredClone(catalog);
  return order;
}

export function editInput(overrides = {}) {
  return { expectedVersion: 1, customerConfirmed: true, customerName: 'Cliente de prueba',
    deliveryAddress: 'Calle 101 # 21-31, Bogotá', paymentMethod: 'breb', delivery: true, deliveryFee: 3000,
    items: [{ sku: 'COLA', quantity: 2, unitPrice: 7200 }, { sku: 'MILK', quantity: 1, unitPrice: 4800 }],
    expectedTotal: 22200, reason: 'El cliente pidió otra gaseosa y cambió el ponqué por leche.', ...overrides };
}
