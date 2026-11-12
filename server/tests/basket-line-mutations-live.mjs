import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { catalogRowToProduct, validateCatalogCsv } from '../services/catalogImportService.js';

// Opt-in: real DeepSeek, real VIA runtime, local catalog and mock delivery.
// Only sanitized facts from the stopped replay are reconstructed. Its store,
// customer data, credentials and state are never imported or overwritten.
assert.ok(process.env.DEEPSEEK_API_KEY, 'Set DEEPSEEK_API_KEY locally; never paste it into a transcript.');
const fixture = validateCatalogCsv(fs.readFileSync('artifacts/catalogo-colombia-2000-demo-activo.csv', 'utf8'));
assert.equal(fixture.valid, true);
const catalog = fixture.rows.map(catalogRowToProduct);
const selected = [['L1', 'COL-164', 1], ['L2', 'CO-RES-1173', 3], ['L3', 'CO-RES-1178', 2], ['L5', 'BOG-PAN-019', 3]]
  .map(([lineId, sku, quantity]) => {
    const product = catalog.find(item => item.sku === sku);
    assert.ok(product, `Missing fixture SKU ${sku}`);
    return { lineId, product, quantity, selectionStatus: 'selected', catalogQuery: product.name,
      rawName: product.name, available: true, lineTotal: product.price * quantity };
  });
const expectedSubtotal = selected.reduce((sum, item) => sum + item.lineTotal, 0);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-basket-live-'));
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json', dataFile: path.join(tempDir, 'store.json'), whatsappMode: 'mock', googleMode: 'mock',
  allowLocalCatalogFallback: true, contextualProductSelectionV2: true, contextualProductSelectionTenants: ['andina'],
  backgroundWorkersEnabled: false, integrationOutboxEnabled: false, llmResponseComposerEnabled: true,
  llmRequestTimeoutMs: 30000, llmMaxTokens: 1800,
});
const tenantId = 'andina';
const waId = '573990000098';
const conversationId = 'basket-live-local';
store.mutate(state => {
  state.platformSettings.llm = { ...state.platformSettings.llm, provider: 'deepseek', model: 'deepseek-chat', mode: 'json_schema',
    simulator: null, apiKeyRef: 'DEEPSEEK_API_KEY', baseUrlRef: 'DEEPSEEK_BASE_URL', temperature: 0, maxTokens: 1800, timeoutMs: 30000 };
  state.productsByTenant.andina = structuredClone(catalog);
  state.customerProfilesByTenant.andina = [{ waId, name: 'Cliente de prueba', defaultAddress: 'Calle de prueba 1' }];
  state.conversations.unshift({ id: conversationId, tenantId, waId, status: 'live', stage: 'clarification',
    messages: [
      { role: 'user', text: 'Una cubeta de huevos AAA, 3 Cifrut de granadilla, 2 Cifrut de naranja, un brownie Mamai de arequipe y 3 chocorramos.' },
      { role: 'agent', text: 'Ya seleccionaste los huevos, los Cifrut y el Chocoramo. Solo queda pendiente el brownie. ¿Puedes precisar su marca o variedad?' },
    ],
    orderDraft: { delivery: true, items: [...structuredClone(selected), { lineId: 'L4', rawName: 'Brownie Mamai de arequipe',
      catalogQuery: 'brownie mamai arequipe', quantity: 1, selectionStatus: 'not_found', product: null, catalogCandidates: [] }],
      subtotal: expectedSubtotal, missingFields: ['product:brownie mamai arequipe'],
      clarificationState: { version: 1, kind: 'catalog_ambiguity', status: 'open', attempts: 1,
        unresolvedLineIds: ['L4'], scopeKey: 'brownie mamai arequipe' } },
  });
});
const read = () => store.getState().conversations.find(item => item.id === conversationId);
const searches = [];
const sent = [];
const call = runtime.tools.call.bind(runtime.tools);
runtime.tools.call = async (tool, ...args) => {
  if (tool === 'google_sheets_read_table') searches.push(args.at(-1)?.query);
  const result = await call(tool, ...args);
  if (tool === 'whatsapp_business_messaging') sent.push(args.at(-1));
  return result;
};
const report = { catalog: 'catalogo-colombia-2000-demo-activo.csv', model: 'deepseek-chat', turns: [], passed: false };
const offer = purpose => Object.values(store.getState().interactionOffersById ?? {})
  .filter(item => item.conversationId === conversationId && item.status === 'active' && item.purpose === purpose).at(-1);
async function turn(text, option) {
  const fromSearch = searches.length;
  const fromSent = sent.length;
  const before = performance.now();
  await runtime.processInbound({ tenantId, waId, text, provider: 'whatsapp', messageId: `basket-live-${Date.now()}`,
    ...(option ? { messageType: 'interactive', interactive: { type: 'button_reply', optionId: option.id, title: option.title } } : {}),
  });
  const conversation = read();
  const draft = conversation.orderDraft;
  const result = { input: text, durationMs: Math.round(performance.now() - before),
    replies: sent.slice(fromSent).map(payload => ({ text: payload.text, interactive: payload.interactive })),
    plan: { intent: conversation.reasoningPlan?.intent, executionMode: conversation.reasoningPlan?.executionMode,
      lineUpdates: conversation.reasoningPlan?.lineUpdates }, searches: searches.slice(fromSearch),
    items: draft.items.map(item => ({ lineId: item.lineId, sku: item.product?.sku, quantity: item.quantity, status: item.selectionStatus })),
    missingFields: draft.missingFields, subtotal: draft.subtotal, phase: draft.checkout?.phase };
  report.turns.push(result);
  console.log(JSON.stringify(result));
  for (const original of selected) {
    const current = draft.items.find(item => item.lineId === original.lineId);
    assert.equal(current?.product?.sku, original.product.sku);
    assert.equal(current?.quantity, original.quantity);
    assert.equal(current?.selectionStatus, 'selected');
  }
  assert.equal(draft.items.filter(item => item.lineId === 'L4').length, 1);
  return result;
}
try {
  const clarification = await turn('brownie de arequipe de marca Mamai');
  assert.match(clarification.plan.executionMode, /^provider_api/);
  assert.equal(clarification.searches.length, 1, 'Only the clarified line is a catalog task');
  const removal = await turn('entonces el brownie ya no');
  assert.match(removal.plan.executionMode, /^provider_api/);
  assert.equal(removal.items.find(item => item.lineId === 'L4').status, 'removed');
  assert.equal(removal.searches.length, 0);
  assert.equal(removal.subtotal, expectedSubtotal);
  assert.equal(removal.phase, 'review');
  assert.equal(removal.missingFields.some(field => /brownie|L4/.test(field)), false);
  const continueOption = offer('cart_review')?.options.find(item => item.action === 'continue_checkout');
  assert.ok(continueOption);
  await turn(continueOption.title, continueOption);
  // A real profile lookup can require identity first; provide synthetic data.
  if (read().orderDraft.missingFields.includes('customer_name')) await turn('Mi nombre es Cliente de prueba');
  if (read().orderDraft.missingFields.includes('delivery_address')) await turn('Mi dirección es Calle de prueba 1');
  const paymentOption = offer('payment_method')?.options.find(item => item.value === 'cash');
  assert.ok(paymentOption, 'The basket must progress to payment');
  await turn(paymentOption.title, paymentOption);
  const confirmOption = offer('order_confirmation')?.options.find(item => item.action === 'confirm_order');
  assert.ok(confirmOption);
  await turn(confirmOption.title, confirmOption);
  const order = store.getState().ordersByTenant.andina.find(item => item.conversationId === conversationId);
  assert.ok(order);
  assert.equal(order.items.length, 4);
  assert.equal(order.subtotal, expectedSubtotal);
  report.passed = true;
} finally {
  // Events contain aggregate planner usage; do not also sum its stage metrics.
  const calls = (store.getState().events ?? []).filter(event => event.conversationId === conversationId && event.metadata?.providerMetadata?.usage)
    .map(event => ({ type: event.type, usage: event.metadata.providerMetadata.usage, requests: event.metadata.providerMetadata.requestCount }));
  report.providerCalls = calls;
  report.usage = { input: calls.reduce((sum, call) => sum + (call.usage.prompt_tokens ?? 0), 0),
    output: calls.reduce((sum, call) => sum + (call.usage.completion_tokens ?? 0), 0) };
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/basket-line-mutations-live.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, usage: report.usage, report: 'test-results/basket-line-mutations-live.json' }));
  runtime.stop(); integrationOutbox.stop(); await store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
