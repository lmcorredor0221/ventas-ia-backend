import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';
import { ConversationGroundingCoordinator } from '../services/conversationGroundingCoordinator.js';
import { validateGroundingDecision, applySemanticCart, groundingQueries, semanticActionIssues } from '../domain/groundingContracts.js';

assert.ok(semanticActionIssues({ intent: 'catalog_query', catalogSearchReady: false,
  items: [{ rawText: 'Varela 300 g', productHypothesis: 'Jabón Varela barra 300 g' }] }, {})
  .some(issue => issue.includes('catalogSearchReady')), 'Contradictory search readiness must return to the interpreter, not silently skip retrieval');
assert.deepEqual(semanticActionIssues({ intent: 'catalog_query', catalogSearchReady: false, items: [] }, {}), []);

assert.deepEqual(groundingQueries({ retrievalText: 'lonchera', queryVariants: ['yogurt'],
  productHypothesis: 'productos para lonchera escolar infantil', rawText: 'que recomienda para un nino' }), ['lonchera', 'yogurt'],
  'Use the retrieval hypotheses supplied by the interpreter instead of dropping its dedicated search field');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'via-grounding-'));
const app = await createAppAsync({ storageDriver: 'json', dataFile: path.join(tmp, 'state.json'), backgroundWorkersEnabled: false,
  whatsappMode: 'mock', llmGroundingEnabled: true, llmGroundingTimeoutMs: 15000 });
try {
  app.store.mutate((s) => { s.productsByTenant.andina = structuredClone(colombiaCatalogTestSeed300);
    s.productsByTenant.andina.push({ sku: 'ATTR', name: 'Producto con atributo', attributes: { acabado: 'iridiscente' }, price: 5000, stock: 4, active: true }); });
  const attr = await app.tools.googleSheetsReadTable('andina', { filters: { query: 'iridiscente' } });
  assert.equal(attr.rows[0].sku, 'ATTR'); assert.deepEqual(attr.rows[0].matchEvidence.attributes, ['iridiscente']);
  const item = { rawItemId: 'coca', rawText: 'Coca Cola litro y medio', productHypothesis: 'Coca-Cola 1.5 L', quantity: 1, presentationSignal: '1.5 L' };
  let calls = 0;
  const agent = { async decide({ observations }) { calls++; assert.ok(observations[0].candidates.some((c) => c.sku === 'BOG-BEB-044'));
    return { decisions: [{ rawItemId: item.rawItemId, action: 'needs_selection', candidateSkus: ['BOG-BEB-044', 'COL-102'], question: '¿Original o sin azúcar?' }], nextAction: 'ask_clarification' }; } };
  const coordinator = new ConversationGroundingCoordinator({ tools: app.tools, agent, events: app.events, config: app.config });
  const result = await coordinator.resolve({ tenantId: 'andina', conversationId: 'contract', items: [item] });
  assert.equal(result.resolutions[0].status, 'needs_selection'); assert.equal(result.resolutions[0].options.length, 2); assert.equal(calls, 1);
  const rows = result.observations[0].rows;
  const reviewIdentity = validateGroundingDecision({ action: 'human_review', sku: 'BOG-BEB-044', reason: 'Condición comercial pendiente' }, { item, rows, tenantId: 'andina' });
  assert.equal(reviewIdentity.product?.sku, 'BOG-BEB-044', 'A human commercial decision can retain an independently observed product identity');
  assert.equal(reviewIdentity.status, 'human_review', 'Retaining identity does not resolve the commercial review');
  assert.equal(validateGroundingDecision({ action: 'human_review', sku: 'FOREIGN' }, { item, rows, tenantId: 'andina' }).product, undefined);
  assert.equal(validateGroundingDecision({ action: 'human_review', sku: 'BOG-BEB-044' }, { item, rows: rows.map(r => ({ ...r, stock: 0 })), tenantId: 'andina' }).product, undefined);
  let commercialEvidence;
  const commercial = new ConversationGroundingCoordinator({ config: app.config, events: app.events,
    tools: { async call() { return { rows: [{ sku: 'portion', name: 'Porción', price: 5000, stock: 5, active: true }] }; } },
    agent: { async decide(input) {
      commercialEvidence = input.observations[0].saleUnitEvidence;
      return { decisions: [{ rawItemId: 'budget', action: 'resolved', sku: 'portion' }], nextAction: 'human_review' };
    } } });
  const budget = await commercial.resolve({ tenantId: 'andina', items: [{ rawItemId: 'budget', rawText: 'por ese valor', quantity: null, budgetAmount: 5000 }] });
  assert.equal(commercialEvidence?.quantityEstablished, false, 'The resolver must observe the same missing sale unit that blocks the writer');
  assert.equal(commercialEvidence.requestedBudget, 5000);
  assert.equal(commercialEvidence.budgetToQuantitySupported, false, 'Equal budget and catalog price do not establish fractional sale terms');
  assert.equal(budget.resolutions[0].product.sku, 'portion', 'Identity can be resolved while commercial terms still need a human');
  assert.equal(budget.nextAction, 'human_review');
  await commercial.resolve({ tenantId: 'andina', items: [{ rawItemId: 'budget', rawText: 'una unidad', quantity: 1, budgetAmount: 5000 }] });
  assert.equal(commercialEvidence.quantityEstablished, true, 'An explicit whole catalog unit must remain orderable');
  const savedItem = { rawItemId: 'saved', rawText: 'bebida', quantity: 1,
    product: { sku: 'known', price: 3200, stock: 5 }, resolution: { status: 'resolved' } };
  let repairCalls = 0, reads = 0;
  const malformed = new ConversationGroundingCoordinator({ config: app.config, events: app.events,
    tools: { async call() { reads++; return { rows: [{ sku: 'known', name: 'Bebida', price: 3200, stock: 5, active: true, tenantId: 'andina' }] }; } },
    agent: { async decide(input) {
      if (++repairCalls === 1) return { decisions: [], nextAction: 'answer_question' };
      assert.ok(input.contractRepair?.errors.length);
      return { decisions: [{ rawItemId: 'saved', action: 'resolved', sku: 'known' }], nextAction: 'answer_question' };
    } } });
  const repaired = await malformed.resolve({ tenantId: 'andina', items: [savedItem], frame: { items: [], cartMutation: { mode: 'delta' } } });
  assert.equal(repairCalls, 2); assert.equal(reads, 1, 'Contract repair reuses already retrieved evidence');
  assert.equal(repaired.resolutions[0].product?.sku, 'known');
  malformed.agent = { async decide() { return { decisions: [], nextAction: 'answer_question' }; } };
  const safe = await malformed.resolve({ tenantId: 'andina', items: [savedItem], frame: { items: [], cartMutation: { mode: 'delta' } } });
  assert.equal(safe.nextAction, 'human_review', 'Repeated malformed output cannot authorize checkout');
  assert.equal(safe.resolutions[0].product?.sku, 'known', 'A transport/contract failure cannot erase fresh evidence for unchanged saved lines');
  const changed = await malformed.resolve({ tenantId: 'andina', items: [savedItem], frame: { items: [{ rawItemId: 'saved' }] } });
  assert.equal(changed.resolutions[0].product, undefined, 'Changed intent is not silently bound to the old product');
  malformed.tools = { async call() { return { rows: [{ sku: 'known', price: 3200, stock: 0, tenantId: 'andina' }] }; } };
  assert.equal((await malformed.resolve({ tenantId: 'andina', items: [savedItem], frame: { items: [] } })).resolutions[0].product, undefined,
    'Retaining identity still requires current stock and price validation');
  const crossSearch = new ConversationGroundingCoordinator({ config: app.config, events: app.events,
    tools: { async call(_tool, _tenant, _conversation, { filters }) { return { rows: [{ sku: filters.query === 'first' ? 'A' : 'B',
      name: 'Observed', price: 2000, stock: 4, active: true, tenantId: 'andina' }] }; } },
    agent: { async decide() { return { decisions: [{ rawItemId: 'a', action: 'resolved', sku: 'B' },
      { rawItemId: 'b', action: 'resolved', sku: 'B' }], nextAction: 'answer_question' }; } } });
  const crossResult = await crossSearch.resolve({ tenantId: 'andina', items: [
    { rawItemId: 'a', productHypothesis: 'first', quantity: 1 }, { rawItemId: 'b', productHypothesis: 'second', quantity: 1 }] });
  assert.equal(crossResult.resolutions[0].product?.sku, 'B', 'The LLM can use catalog evidence retrieved for another need in this turn');
  assert.ok(crossResult.observations[0].rows.some(p => p.sku === 'B'));
  assert.equal(validateGroundingDecision({ action: 'resolved', sku: 'FOREIGN' }, { item, rows, tenantId: 'andina' }).status, 'human_review');
  assert.equal(validateGroundingDecision({ action: 'resolved', sku: 'BOG-BEB-044' }, { item, rows: rows.map((r) => ({ ...r, tenantId: 'other' })), tenantId: 'andina' }).status, 'human_review');
  assert.equal(validateGroundingDecision({ action: 'resolved', sku: 'BOG-BEB-044' }, { item, rows: rows.map((r) => ({ ...r, stock: 0 })), tenantId: 'andina' }).status, 'human_review');
  assert.equal(validateGroundingDecision({ action: 'resolved', sku: 'BOG-BEB-044' }, { item: { ...item, presentationSignal: '3 L' }, rows, tenantId: 'andina' }).status, 'human_review');
  let rounds = 0;
  coordinator.agent = { async decide({ round }) { rounds++; return { decisions: [{ rawItemId: 'missing', action: 'refine_search', query: round === 1 ? 'Brownie de arequipe' : 'Brownie Mamai' }] }; } };
  const missing = await coordinator.resolve({ tenantId: 'andina', conversationId: 'contract', items: [{ rawItemId: 'missing', rawText: 'Browine Mamai de arequipe' }] });
  assert.equal(rounds, 2); assert.equal(missing.resolutions[0].status, 'human_review'); assert.equal(missing.resolutions[0].product, undefined);
  coordinator.agent = { async decide() { throw Error('provider unavailable'); } };
  assert.equal((await coordinator.resolve({ tenantId: 'andina', items: [item] })).resolutions[0].status, 'human_review');
  assert.equal((await coordinator.resolve({ tenantId: 'andina', items: [item], isCurrent: async () => false })).aborted, true);
  assert.deepEqual(applySemanticCart([{ rawItemId: 'a' }, { rawItemId: 'b' }], [{ rawItemId: 'b', quantity: 2 }], { removeItemIds: ['a'] }), [{ rawItemId: 'b', quantity: 2 }]);

  // Full runtime path, with explicit test double for the model (not claimed as DeepSeek).
  app.runtime.grounding.agent = agent;
  const frame = { intent: 'delivery_order', items: [item], cartMutation: { mode: 'delta' }, customerDelta: { name: 'Cliente', address: 'Calle prueba' }, collectionComplete: false };
  app.runtime.planner = { async plan() { return { intent: 'delivery_order', semanticFrame: frame, order: { delivery: true, items: [item] }, missingFields: [] }; }, async composeReply({ fallbackText }) { return { text: fallbackText }; } };
  const inbound = await app.runtime.processInbound({ tenantId: 'andina', waId: '573000001111', messageId: 'ground-test', messageType: 'text', text: item.rawText });
  const conversation = inbound.conversation;
  assert.equal(conversation.orderDraft.items[0].resolution.status, 'needs_selection');
  assert.equal(conversation.orderDraft.items[0].presentationOptions.length, 2);
  assert.equal(conversation.orderDraft.items[0].product, null);
  assert.equal(conversation.pendingQuestion.kind, 'clarification');
  assert.ok(app.store.getState().customerProfilesByTenant.andina[conversation.waId], 'Explicit customer data is saved while selection remains pending');
  const catalogTurn = await app.runtime.handleGroundedCatalogQuery({ tenantId: 'andina', conversationId: conversation.id,
    normalized: { waId: conversation.waId, messageId: 'ground-test', text: item.rawText }, plan: { semanticFrame: frame, order: { items: [item] } } });
  assert.equal(catalogTurn.summary, 'Grounded catalog options sent');
  const catalogEvent = app.store.getState().events.find((event) => event.type === 'catalog.candidates.evaluated' && event.metadata.decision === 'catalog_option_proposed');
  assert.equal(catalogEvent.metadata.resolutionStatus, 'needs_selection');
  assert.equal(catalogEvent.metadata.presentedCandidates.length, 2);
  // A queued message is not necessarily present in conversation.messages yet.
  const listInbound = app.store.listInboundMessages;
  app.store.listInboundMessages = async () => [{ messageId: 'newer-pending' }];
  const stale = await app.runtime.groundCatalogTurn({ tenantId: 'andina', conversationId: conversation.id,
    normalized: { waId: conversation.waId, messageId: 'ground-test' }, plan: {}, items: [item] });
  assert.equal(stale.aborted, true);
  app.store.listInboundMessages = listInbound;
  const bounded = new ConversationGroundingCoordinator({ tools: { call: () => new Promise(() => {}) }, agent, events: app.events,
    config: { llmGroundingTimeoutMs: 1000 } });
  const timeout = await bounded.resolve({ tenantId: 'andina', items: [item] });
  assert.equal(timeout.resolutions[0].reason, 'grounding_deadline');
  console.log('Grounding contracts passed: attributes, variants, isolation, stock, measures, bounded refinement, provider failure, stale turn, cart and runtime.');
} finally { app.runtime.stop(); await app.store.close?.(); await fs.rm(tmp, { recursive: true, force: true }); }
