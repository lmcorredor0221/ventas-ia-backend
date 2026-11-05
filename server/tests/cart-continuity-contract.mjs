import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { LLMPlanner } from '../services/llmPlanner.js';
import { applySemanticCart } from '../domain/groundingContracts.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';
import { semanticFrameFromPlan } from '../domain/semanticContracts.js';
import { ConversationGroundingCoordinator } from '../services/conversationGroundingCoordinator.js';

// Model doubles exercise contract failures, not linguistic accuracy. The real
// provider/Meta simulation campaign is reported separately.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'via-cart-continuity-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(dir, 'state.json'),
  whatsappMode: 'mock', backgroundWorkersEnabled: false, llmGroundingEnabled: true });
const failures = [];
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } }
try {
  app.store.mutate(s => { s.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300); });
  await test('Omitted delivery preserves context; a changed mode requires a contextual source before repair', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    const input = { tenantId: 'andina', conversationId: 'delivery-continuity', normalized: {
      messageId: 'close', text: 'Eso es todo, gracias.' }, conversation: { orderDraft: {
        delivery: true, items: [{ rawItemId: 'pan', rawText: 'pan Bimbo', quantity: 1 }] } } };
    let calls = 0;
    planner.gateway.request = async () => { calls++; return { plan: { intent: 'order_clarification', items: [] } }; };
    assert.equal((await planner.plan(input)).order.delivery, true);
    assert.equal(calls, 1, 'Omission is not an instruction to remove delivery');
    calls = 0;
    planner.gateway.request = async ({ prompt }) => {
      if (++calls === 2) assert.match(prompt, /delivery_change_without_source/);
      return { plan: { intent: 'order_clarification', items: [], delivery: calls === 1 ? false : null } };
    };
    assert.equal((await planner.plan(input)).order.delivery, true);
    assert.equal(calls, 2, 'The LLM corrects unsupported changes; the server does not infer pickup from words');
    planner.gateway.request = async () => ({ plan: { intent: 'order_clarification', items: [], delivery: false,
      deliveryChange: { evidence: 'Mejor paso yo a recogerlo', reason: 'El comprador cambia a recogida' } } });
    assert.equal((await planner.plan({ ...input, normalized: { messageId: 'pickup', text: 'Mejor paso yo a recogerlo' } })).order.delivery, false);
  });
  await test('Duplicate new hypotheses return to the LLM instead of doubling a customer mention', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    const juice = { rawItemId: null, rawText: 'cifrut de granadilla', productHypothesis: 'Jugo Cifrut granadilla', quantity: null };
    const cake = { rawItemId: null, rawText: '3 chocorramos', productHypothesis: 'Chocoramo', quantity: 3 };
    let calls = 0;
    planner.gateway.request = async ({ prompt }) => {
      if (++calls === 2) assert.match(prompt, /duplicate_new_need/);
      return { plan: { intent: 'delivery_order', items: calls === 1 ? [cake, juice, { ...juice }] : [cake, juice] } };
    };
    const input = { tenantId: 'andina', conversationId: 'new-duplicate', normalized: {
      messageId: 'duplicate-first-turn', text: 'Hola veci, me regala porfa 3 chocorramos y cifrut de granadilla para domicilio' } };
    const corrected = await planner.plan(input);
    assert.equal(calls, 2);
    assert.equal(corrected.order.items.length, 2);
    assert.equal(corrected.order.items[1].quantity, null, 'Repair cannot manufacture missing quantity');
    planner.gateway.request = async () => ({ plan: { intent: 'delivery_order', items: [juice, { ...juice }] } });
    assert.equal((await planner.plan(input)).executionMode, 'safe_handoff_fallback', 'An unrepaired duplicate cannot become a priced basket');
    for (const items of [[juice, { ...juice, presentationSignal: '1 L' }],
      [juice, { ...juice, attributes: { recipient: 'otra persona' } }]]) {
      calls = 0;
      planner.gateway.request = async () => { calls++; return { plan: { intent: 'delivery_order', items } }; };
      assert.equal((await planner.plan(input)).order.items.length, 2);
      assert.equal(calls, 1, 'Distinct needs are never merged by product name');
    }
    calls = 0;
    planner.gateway.request = async () => { calls++; return { plan: { intent: 'delivery_order', items: [juice, { ...juice }] } }; };
    assert.equal((await planner.plan({ ...input, normalized: { ...input.normalized,
      text: 'cifrut de granadilla para Ana y cifrut de granadilla para Luis' } })).order.items.length, 2);
    assert.equal(calls, 1, 'Two separate literal mentions remain available for contextual interpretation');
  });
  await test('Interpreter repairs missing line identity instead of duplicating a clarification', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    const previous = [{ rawItemId: 'arepas-original', rawText: '2 arepas boyacenses', rawName: '2 arepas boyacenses', quantity: 2 }];
    let requests = 0;
    planner.gateway.request = async () => ({ plan: { schemaVersion: 'semantic-frame.v2', intent: 'order_clarification',
      items: [{ ...(++requests > 1 ? { rawItemId: 'arepas-original' } : {}), rawText: 'DOS PAQUETES de cinco arepas', productHypothesis: 'Arepa boyacense paquete x5', quantity: 2 }],
      cartMutation: { mode: 'delta' } } });
    const result = await planner.plan({ tenantId: 'andina', conversationId: 'identity', normalized: { messageId: 'clarify', text: 'Son DOS PAQUETES de cinco arepas' }, conversation: { orderDraft: { items: previous } } });
    const items = applySemanticCart(previous, result.order.items, result.semanticFrame.cartMutation);
    assert.equal(items.length, 1); assert.equal(items[0].quantity, 2); assert.equal(items[0].rawItemId, 'arepas-original');
    assert.equal(requests, 2, 'Only invalid contracts need a bounded model repair');
    planner.gateway.request = async () => ({ plan: { items: [{ rawItemId: 'invented-id', rawText: 'arepas', quantity: 2 }], intent: 'order_clarification' } });
    const invalid = await planner.plan({ tenantId: 'andina', conversationId: 'identity', normalized: { text: 'solo esas', messageId: 'invalid' }, conversation: { orderDraft: { items: previous } } });
    assert.equal(invalid.executionMode, 'safe_handoff_fallback');
  });
  await test('A follow-up catalog inquiry can reference its own observed subject without becoming a purchase', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    let calls = 0;
    planner.gateway.request = async () => { calls++; return { plan: { intent: 'catalog_query', catalogSearchReady: true,
      items: [{ rawItemId: 'observed-milk', rawText: 'la Alquería y la Colanta', productHypothesis: 'leche entera bolsa 1 L' }] } }; };
    const result = await planner.plan({ tenantId: 'andina', conversationId: 'catalog-follow-up',
      normalized: { messageId: 'milk-question', text: '¿La Alquería y la Colanta son leche entera en bolsa de 1 litro?' },
      conversation: { catalogGrounding: { items: [{ rawItemId: 'observed-milk', rawText: 'leche en bolsa' }] } } });
    assert.equal(result.executionMode, 'provider_api');
    assert.equal(result.intent, 'catalog_query');
    assert.equal(calls, 1, 'A known catalog subject is not an invalid cart ID');
    assert.equal(result.order.items[0].rawItemId, 'observed-milk');
  });
  await test('Contextual update uses final quantity; explicit new line and removal remain independent', async () => {
    const previous = [{ rawItemId: 'a', quantity: 1 }, { rawItemId: 'b', quantity: 2 }];
    assert.deepEqual(applySemanticCart(previous, [{ rawItemId: 'a', quantity: 3 }]), [{ rawItemId: 'a', quantity: 3 }, previous[1]]);
    assert.equal(applySemanticCart(previous, [{ rawItemId: 'c', quantity: 1 }]).length, 3);
    assert.deepEqual(applySemanticCart(previous, [], { removeItemIds: ['b'] }), [previous[0]]);
    const frame = semanticFrameFromPlan({ items: [{ rawItemId: null, rawText: 'arepas', quantity: 1 }] },
      { messageId: 'new', conversation: { orderDraft: { items: [{ rawItemId: 'old', rawName: 'arepas', quantity: 2 }] } } });
    assert.notEqual(frame.items[0].rawItemId, 'old', 'An explicit new need is not merged by name');
  });
  await test('A provider failure exposes the unprocessed customer need to the next contextual interpretation', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    planner.gateway.request = async () => { throw new Error('timeout'); };
    const text = 'Un pan tajado Bimbo blanco de 500 g para domicilio';
    const failed = await planner.plan({ tenantId: 'andina', conversationId: 'timeout-recovery',
      normalized: { messageId: 'unprocessed', text } });
    assert.equal(failed.pendingInterpretation?.text, text);
    assert.equal(failed.pendingInterpretation.messageId, 'unprocessed');
    assert.equal(failed.order.items.length, 0, 'Failure cannot invent the unprocessed basket');
    planner.gateway.request = async ({ prompt }) => {
      const input = JSON.parse(prompt.split('\n').at(-1));
      assert.equal(input.conversationContext.pendingInterpretation.text, text);
      return { plan: { intent: 'delivery_order', items: [
        { rawItemId: null, rawText: 'pan tajado Bimbo', productHypothesis: 'pan tajado Bimbo blanco 500 g', quantity: 1 },
        { rawItemId: null, rawText: 'queso', productHypothesis: 'queso campesino Colanta 250 g', quantity: 1 },
      ] } };
    };
    const recovered = await planner.plan({ tenantId: 'andina', conversationId: 'timeout-recovery',
      normalized: { messageId: 'addition', text: 'Y agrega un queso campesino Colanta de 250 g' },
      conversation: { reasoningPlan: failed, messages: [{ role: 'customer', text }] } });
    assert.equal(recovered.executionMode, 'provider_api');
    assert.equal(recovered.order.items.length, 2);
    assert.equal(recovered.pendingInterpretation, undefined, 'A successful interpretation replaces the failed plan, not an automatic extra basket');
  });
  await test('An informational clarification without a basket is reinterpreted by the LLM before creating a draft', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    let calls = 0;
    planner.gateway.request = async () => ({ plan: { intent: ++calls === 1 ? 'order_clarification' : 'general_query', items: [],
      customerDelta: {}, proposedAction: 'answer', reasoningSummary: 'Consulta condiciones; no hay pedido' } });
    const result = await planner.plan({ tenantId: 'andina', conversationId: 'query-without-basket', normalized: {
      messageId: 'query-fee', text: 'Solo consulto cuánto vale el envío' }, conversation: { messages: [], catalogGrounding: { items: [] } } });
    assert.equal(calls, 2);
    assert.equal(result.intent, 'general_query');
    assert.equal(result.executionMode, 'provider_api');
  });
  await test('A product inquiry without purchase consent repairs contradictory search readiness through the LLM', async () => {
    const planner = new LLMPlanner({ store: app.store, events: app.events, usage: app.usage, config: app.config });
    planner.getPlannerContext = async () => ({ provider: 'deepseek', config: { provider: 'deepseek' } });
    let calls = 0;
    planner.gateway.request = async () => ({ plan: { intent: 'catalog_query', catalogSearchReady: ++calls > 1,
      items: [{ rawItemId: null, rawText: 'Varela 300 g', productHypothesis: 'Jabón Varela barra 300 g', quantity: null }],
      proposedAction: calls === 1 ? 'ask_clarification' : 'search_catalog' } });
    const result = await planner.plan({ tenantId: 'andina', conversationId: 'query-no-purchase', normalized: {
      messageId: 'query-soap', text: '¿Me confirmas el precio del Varela de 300 g? Solo consulto, no quiero comprar todavía.' }, conversation: { messages: [] } });
    assert.equal(calls, 2);
    assert.equal(result.intent, 'catalog_query');
    assert.equal(result.semanticFrame.catalogSearchReady, true);
    assert.equal(result.order.items[0].quantity, null, 'Searching never fabricates purchase quantity');
    assert.equal(result.executionMode, 'provider_api');
  });
  let conversation;
  const rawIds = ['turn-wamid-same-customer:item-1', 'turn-wamid-same-customer:item-2'];
  const items = rawIds.map((rawItemId, i) => ({ rawItemId, rawText: i ? 'aceite Premier' : 'arroz Diana', rawName: i ? 'aceite Premier' : 'arroz Diana', productHypothesis: i ? 'aceite Premier' : 'arroz Diana', quantity: 1 }));
  app.runtime.planner = { async plan() { return { intent: 'delivery_order', semanticFrame: { items, customerDelta: { name: 'Prueba', address: 'Calle prueba', paymentPreference: 'cash' }, cartMutation: { mode: 'delta' } }, order: { delivery: true, items }, missingFields: [] }; }, async composeReply({ fallbackText }) { return { text: fallbackText }; } };
  app.runtime.grounding.agent = { async decide({ observations }) { return { nextAction: 'confirm_order', decisions: observations.map(({ item, candidates }) => ({ rawItemId: item.rawItemId, action: 'needs_selection', candidateSkus: candidates.filter(p => p.price > 0 && p.stock > 1).slice(0, 2).map(p => p.sku) })) }; } };
  await test('Two pending variants retain two distinct identities even if IDs share a prefix', async () => {
    conversation = (await app.runtime.processInbound({ tenantId: 'andina', waId: '573000009911', messageId: 'cart-1', messageType: 'text', text: 'arroz Diana y aceite Premier' })).conversation;
    assert.deepEqual(conversation.orderDraft.missingFields.filter(f => f.startsWith('presentation:')), rawIds.map(id => `presentation:${id}`));
    assert.notEqual(conversation.stage, 'quote');
  });
  await test('Confirmation is forbidden even when saved missingFields incorrectly says empty', async () => {
    app.store.mutate(s => { const c = s.conversations.find(c => c.id === conversation.id); c.orderDraft.missingFields = []; });
    let orderWrites = 0, continued = 0;
    const originalCall = app.runtime.tools.call.bind(app.runtime.tools);
    app.runtime.tools.call = async (...args) => { if (args[0] === 'google_sheets_order_write') { orderWrites++; throw Error('Incomplete draft reached order write'); } return originalCall(...args); };
    const originalClarification = app.runtime.handleOrderClarification;
    app.runtime.handleOrderClarification = async () => { continued++; return {}; };
    try {
      await app.runtime.handleOrderConfirmation({ tenantId: 'andina', conversationId: conversation.id, normalized: { waId: conversation.waId }, plan: { intent: 'order_confirmation' } });
      assert.equal(orderWrites, 0); assert.equal(continued, 1);
      assert.equal(await app.runtime.createConfirmationOffer({ tenantId: 'andina', conversationId: conversation.id, draftVersion: conversation.orderDraft.version }), null);
    } finally { app.runtime.tools.call = originalCall; app.runtime.handleOrderClarification = originalClarification; }
  });
  await test('Selecting one variant keeps the other pending, then both can be quoted once resolved', async () => {
    let interpretations = 0, contextualDecisions = 0;
    let compositionFacts;
    app.runtime.planner.composeReply = async ({ facts, fallbackText }) => { compositionFacts = facts; return { text: fallbackText }; };
    app.runtime.planner.plan = async () => { interpretations++; return { intent: 'order_clarification',
      semanticFrame: { items: [], customerDelta: {}, cartMutation: { mode: 'delta' } }, order: { delivery: true, items: [] }, missingFields: [] }; };
    app.runtime.grounding.agent.decide = async ({ observations, validatedSelection }) => {
      contextualDecisions++;
      assert.equal(validatedSelection?.action, 'select_product_variant');
      // Adversarial model: reopens even a known choice. Consent must survive;
      // other unresolved lines must still remain pending.
      return { nextAction: 'confirm_order', decisions: observations.map(({ item, candidates }) =>
        ({ rawItemId: item.rawItemId, action: 'needs_selection', candidateSkus: candidates.filter(p => p.price > 0 && p.stock > 1).slice(0, 2).map(p => p.sku) })) };
    };
    for (let index = 0; index < 2; index++) {
      const offer = Object.values(app.store.getState().interactionOffersById).find(o => o.conversationId === conversation.id && o.status === 'active' && o.purpose === 'product_variant');
      assert.ok(offer); const option = offer.options[0];
      const result = await app.runtime.processInbound({ tenantId: 'andina', waId: conversation.waId, messageId: `cart-select-${index}`,
        messageType: 'interactive', text: option.title, interactive: { optionId: option.id, title: option.title, type: 'button_reply' } });
      conversation = result.conversation;
      assert.equal(compositionFacts.validatedSelection?.action, 'select_product_variant', 'Composition must receive the exact choice, not only a truncated button title');
      assert.equal(compositionFacts.validatedSelection.value, option.value);
      assert.equal(conversation.orderDraft.items.length, 2);
      assert.equal(conversation.orderDraft.items.filter(i => !i.product).length, 1 - index);
      const confirmation = Object.values(app.store.getState().interactionOffersById).find(o => o.conversationId === conversation.id && o.status === 'active' && o.purpose === 'order_confirmation');
      assert.equal(Boolean(confirmation), index === 1);
    }
    assert.equal(interpretations, 0, 'A validated choice must not be reinterpreted from a truncated label');
    assert.equal(contextualDecisions, 2, 'Every selection still receives contextual LLM continuation');
    assert.ok(!conversation.orderId, 'Quoting does not authorize an order');
  });
  await test('Validated choices use fresh stock/price/tenant evidence, without locking later text changes', async () => {
    const product = colombiaCatalogTestSeed300.find(p => p.sku === 'BOG-GRA-021');
    const alternate = colombiaCatalogTestSeed300.find(p => p.sku !== product.sku && p.brand === product.brand && p.name.includes('Arroz'));
    assert.ok(alternate);
    const item = { rawItemId: 'chosen', rawText: 'arroz Diana', productHypothesis: 'arroz Diana', quantity: 1,
      product, resolution: { status: 'resolved' } };
    let freshRows = [product, alternate];
    let reads = 0, decisions = 0;
    const coordinator = new ConversationGroundingCoordinator({ config: app.config, events: app.events,
      tools: { async call(name, tenantId, conversationId, payload) {
        reads++; assert.equal(name, 'google_sheets_read_table');
        return { status: 'success', rows: freshRows };
      } },
      agent: { async decide() { decisions++; return { nextAction: 'confirm_order', decisions: [{ rawItemId: item.rawItemId, action: 'resolved', sku: alternate.sku }] }; } } });
    const input = { tenantId: 'andina', conversationId: 'fresh-choice', items: [item],
      validatedSelection: { action: 'select_product_variant', rawItemId: item.rawItemId, value: product.sku } };
    assert.equal((await coordinator.resolve(input)).resolutions[0].product.sku, product.sku);
    assert.equal(reads, 1); assert.equal(decisions, 1, 'LLM still chooses continuation');
    for (const changed of [[], [{ ...product, stock: 0 }], [{ ...product, price: 0 }], [{ ...product, tenantId: 'another-tenant' }]]) {
      freshRows = changed;
      const result = await coordinator.resolve(input);
      assert.equal(result.resolutions[0].status, 'human_review');
      assert.ok(!result.resolutions[0].product, 'A stale offered product is not proof of availability');
    }
    freshRows = [product, alternate];
    const textChange = await coordinator.resolve({ ...input, validatedSelection: undefined,
      items: [{ ...item, rawText: `Mejor ${alternate.name} ${alternate.presentation}` }] });
    assert.equal(textChange.resolutions[0].product.sku, alternate.sku, 'A later contextual change is not frozen by the old selection');
  });
  await test('A confirmation with a new product delta must resolve and re-quote before any write', async () => {
    const original = app.runtime.handleDeliveryOrder;
    let resolutions = 0;
    app.runtime.handleDeliveryOrder = async () => { resolutions++; return {}; };
    try {
      await app.runtime.handleOrderConfirmation({ tenantId: 'andina', conversationId: conversation.id,
        normalized: { waId: conversation.waId }, plan: { intent: 'order_confirmation',
          semanticFrame: { items: [{ rawItemId: 'new-need', rawText: 'otro producto pendiente' }], cartMutation: { mode: 'delta' } } } });
      assert.equal(resolutions, 1);
      assert.ok(!(await app.runtime.getConversation(conversation.id)).orderId);
    } finally { app.runtime.handleDeliveryOrder = original; }
  });
} finally { app.runtime.stop(); await app.store.close?.(); await fs.rm(dir, { recursive: true, force: true }); }
assert.deepEqual(failures, [], 'Cart regressions must all pass');
