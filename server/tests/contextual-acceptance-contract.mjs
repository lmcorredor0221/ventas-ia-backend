import assert from 'node:assert/strict';
import { checkOrder, checkConsent, checkTurn, checkPublicClaims, checkBasketBounds, checkHumanTaskUniqueness, amounts } from './helpers/businessOutcomeAssertions.js';
import { publicOptions, nextCustomerTurn, judgeConversation, judgeProtocolIssues } from './helpers/contextualCustomerActor.js';
import { contextualAcceptanceScenarios } from './fixtures/contextualAcceptanceScenarios.js';
import { terminationAtTurnCap } from './helpers/contextualScenarioRunner.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';
const catalog = [{ sku: 'A', price: 7200, stock: 20 }, { sku: 'B', price: 2800, stock: 20 }];
const coffeeRows = [
  { sku: 'small', name: 'Cafe Sello Rojo molido', presentation: '250 g', price: 13500 },
  { sku: 'large', name: 'Cafe molido tradicional', presentation: '500 g', price: 16500 },
];
const coffeeText = 'Precio unitario de Cafe molido tradicional 500 g: $ 16.500';
const coffeeVerdict = { verdict: 'pass', issues: [], missingNeeds: [], turns: [{ turn: 1, products: [
  { sku: 'small', name: 'Cafe Sello Rojo molido', unitPrice: 16500, evidence: coffeeText },
] }] };
assert.ok(judgeProtocolIssues(coffeeVerdict, { scenario: { outcome: 'query' }, catalog: coffeeRows,
  dialogue: [{ outbound: [{ text: coffeeText }] }] }).some(e => e.includes('literal identity')),
  'A literal different catalog name/presentation is a judge mapping error, not proof of a wrong VIA price');
const trueWrongPrice = structuredClone(coffeeVerdict); trueWrongPrice.turns[0].products[0].sku = 'large';
trueWrongPrice.turns[0].products[0].name = coffeeRows[1].name;
trueWrongPrice.turns[0].products[0].unitPrice = 99900;
trueWrongPrice.turns[0].products[0].evidence = coffeeText.replace('16.500', '99.900');
assert.deepEqual(judgeProtocolIssues(trueWrongPrice, { scenario: { outcome: 'query' }, catalog: coffeeRows,
  dialogue: [{ outbound: [{ text: coffeeText.replace('16.500', '99.900') }] }] }), [],
  'A real incorrect price keeps its unfavorable verdict; it is not an extraction repair');
const paymentClaim = { turns: [{ turn: 1, products: [], paymentVerified: true, evidence: 'Ya verifiqué tu pago.' }], issues: [] };
assert.ok(checkPublicClaims({ verdict: paymentClaim, catalog,
  dialogue: [{ outbound: [{ text: 'Ya verifiqué tu pago.' }] }] }).some(a => !a.passed && a.severity === 'P1'));
assert.ok(checkPublicClaims({ verdict: paymentClaim, catalog,
  dialogue: [{ outbound: [{ text: 'Queda efectivo como medio de pago.' }] }] }).some(a => !a.passed && a.severity === 'EVALUATOR'));
const scenario = { outcome: 'purchase', basket: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 1 }] };
const order = { id: 'o', tenantId: 't', customerName: 'Ana', deliveryAddress: 'Calle 1', subtotal: 10000,
  items: [{ sku: 'A', quantity: 1, unitPrice: 7200, lineTotal: 7200 }, { sku: 'B', quantity: 1, unitPrice: 2800, lineTotal: 2800 }] };
const evaluate = (o, extra = {}) => checkOrder({ order: o, scenario, catalog, tenantId: 't', accepted: true, count: 1, ...extra });
assert.ok(evaluate(order).every((a) => a.passed));
assert.ok(evaluate({ ...order, delivery: false }, { scenario: { ...scenario, expectedDelivery: true } })
  .some(a => a.name === 'delivery_mode_preserved' && !a.passed), 'A correct free subtotal cannot hide lost delivery consent');
assert.ok(evaluate({ ...order, delivery: true }, { scenario: { ...scenario, expectedDelivery: true } }).every(a => a.passed));
const mutations = [
  ['zero subtotal', { ...order, subtotal: 0 }],
  ['swapped prices same total', { ...order, items: order.items.map((i, n) => ({ ...i, unitPrice: n ? 7200 : 2800, lineTotal: n ? 7200 : 2800 })) }],
  ['lost product', { ...order, items: order.items.slice(0, 1) }],
  ['foreign tenant', { ...order, tenantId: 'other' }],
  ['invented sku', { ...order, items: [{ ...order.items[0], sku: 'X' }] }],
  ['wrong quantity', { ...order, items: [{ ...order.items[0], quantity: 10 }, order.items[1]] }],
];
for (const [label, value] of mutations) assert.ok(evaluate(value).some((a) => !a.passed), label);
assert.ok(evaluate(order, { accepted: false }).some((a) => !a.passed));
assert.ok(evaluate(order, { count: 2 }).some((a) => !a.passed));
assert.ok(checkTurn({ outbound: [], catalog }).some((a) => !a.passed), 'old conversation reply cannot replace fresh outbound');
const confirmOutbound = [{ text: '¿Confirmas?', interactive: { action: { buttons: [{ reply: { title: 'Confirmar pedido' } }] } } }];
assert.ok(checkTurn({ outbound: confirmOutbound, catalog, draft: { missingFields: [], items: [{ rawItemId: 'pending', product: null, quantity: 1 }] } })
  .some(a => a.name === 'confirmation_only_complete_basket' && !a.passed), 'Empty missingFields must not hide a pending product');
assert.ok(checkTurn({ outbound: confirmOutbound, catalog, draft: { missingFields: [], items: [{ product: catalog[0], quantity: 1, resolution: { status: 'resolved' } }] } })
  .every(a => a.passed), 'A resolved basket remains confirmable');
const dialogue = [{ outbound: [{ text: 'Total: $ 10.000. ¿Confirmas?' }] }];
const action = { act: 'confirm_order', quoteLines: scenario.basket, quoteSubtotal: 10000, quoteEvidence: 'Total: $ 10.000.' };
assert.ok(checkConsent({ action, scenario, catalog, dialogue }).every((a) => a.passed));
assert.ok(checkConsent({ action: { ...action, quoteSubtotal: 0 }, scenario, catalog, dialogue }).some((a) => !a.passed));
assert.ok(checkConsent({ action, scenario, catalog, dialogue: [] }).some((a) => !a.passed));
assert.ok(checkConsent({ action, scenario, catalog, dialogue: [...dialogue, { outbound: [{ text: 'El precio cambió, aún no confirmes.' }] }] }).some((a) => !a.passed), 'stale quote');
assert.ok(evaluate(null, { scenario: { outcome: 'query', basket: [] }, count: 1 }).some((a) => !a.passed), 'unlinked order hidden from query');
assert.ok(evaluate({ ...order, customerName: 'Other' }, { scenario: { ...scenario, buyer: { name: 'Ana', address: 'Calle 1' } } }).some((a) => !a.passed));
assert.deepEqual(amounts('$7.200,00; COP 7,200.00; 7.200 pesos; $ 7\u00a0200'), [7200, 7200, 7200, 7200]);
const claims = { verdict: 'pass', issues: [], missingNeeds: [], turns: [{ turn: 1, products: [{ sku: 'A', unitPrice: 7200, evidence: 'A $ 7.200' }, { sku: 'X', unitPrice: 9, evidence: 'X $ 9' }] }] };
assert.ok(checkPublicClaims({ verdict: claims, dialogue: [{ outbound: [{ text: 'A $ 7.200, X $ 9' }] }], catalog }).some((a) => !a.passed), 'one valid option must not hide invalid others');
const extracted = { verdict: 'pass', issues: [], missingNeeds: [], turns: [{ turn: 1, products: [{ sku: 'A', evidence: 'A $ 7.200', unitPrice: 7200 }] }] };
assert.ok(checkPublicClaims({ verdict: extracted, dialogue: [{ outbound: [{ text: 'A $ 7.200' }] }], catalog, scenario: { maxBudget: 5000 } }).some((a) => a.name.startsWith('budget_') && !a.passed));
assert.ok(checkPublicClaims({ verdict: extracted, dialogue: [{ outbound: [{ text: 'Hola' }] }], catalog }).some((a) => a.severity === 'EVALUATOR' && !a.passed), 'judge hallucination is not application failure');
const draft = { items: order.items.map((i) => ({ quantity: i.quantity, product: catalog.find((p) => p.sku === i.sku) })) };
const badExtraction = { verdict: 'pass', issues: [], missingNeeds: [], turns: [{ turn: 1, products: [{ sku: 'A', quantity: 2, evidence: 'inventada' }], subtotal: 10000, subtotalEvidence: 'Total $10.000' }] };
const publicResult = checkPublicClaims({ verdict: badExtraction, dialogue: [{ outbound: [{ text: 'Total $10.000' }], draft }], catalog });
assert.ok(publicResult.some((a) => a.severity === 'EVALUATOR' && !a.passed));
assert.ok(!publicResult.some((a) => a.severity === 'P0' && !a.passed), 'bad judge quantity must not manufacture a bad subtotal');
const wrongTotal = structuredClone(badExtraction); wrongTotal.turns[0].subtotal = 0; wrongTotal.turns[0].subtotalEvidence = 'Total $0';
assert.ok(checkPublicClaims({ verdict: wrongTotal, dialogue: [{ outbound: [{ text: 'Total $0' }], draft }], catalog }).some((a) => a.name === 'public_subtotal_1' && !a.passed));
assert.ok(checkBasketBounds({ draft, scenario }).every((a) => a.passed));
assert.ok(checkBasketBounds({ draft: { items: [...draft.items, draft.items[0]] }, scenario }).some((a) => !a.passed), 'duplicate line');
const moneyScenario = { basket: [], amountCaps: [{ sku: 'A', amount: 5000 }] };
assert.ok(checkBasketBounds({ draft: { items: [{ product: { sku: 'A' }, budgetAmount: 10000 }] }, scenario: moneyScenario }).some((a) => !a.passed), 'double monetary amount');
const moneyClaim = { verdict: 'pass', issues: [], missingNeeds: [], turns: [{ turn: 1, products: [], subtotal: 7800, subtotalEvidence: 'Subtotal $7.800' }] };
assert.ok(checkPublicClaims({ verdict: moneyClaim, dialogue: [{ outbound: [{ text: 'Subtotal $7.800' }], draft: { items: [{ product: { sku: 'A' }, quantity: null, budgetAmount: 5000 }, draft.items[1]] } }], catalog, scenario: moneyScenario }).some((a) => !a.passed && a.severity === 'REVIEW'), 'budget alone cannot certify a monetary sale line');
const partialText = 'Subtotal de productos: $2.800. No incluye el producto pendiente; el total queda por confirmar.';
const partialVerdict = { verdict: 'pass', issues: [], missingNeeds: [], turns: [{ turn: 1, products: [],
  subtotal: 2800, subtotalEvidence: 'Subtotal de productos: $2.800.', subtotalScope: 'priced_lines',
  subtotalScopeEvidence: 'No incluye el producto pendiente; el total queda por confirmar.', confirmationOffered: false }] };
const partialDraft = { items: [{ product: { sku: 'A' }, quantity: null, budgetAmount: 5000 }, draft.items[1]] };
const evaluatePartial = (verdict, text = partialText) => checkPublicClaims({ verdict, catalog, scenario: moneyScenario,
  dialogue: [{ outbound: [{ text }], draft: partialDraft }] });
assert.ok(evaluatePartial(partialVerdict).every(a => a.passed), 'An explicitly partial subtotal can be verified against priced lines without selling the pending item');
assert.ok(evaluatePartial({ ...partialVerdict, turns: [{ ...partialVerdict.turns[0], subtotal: 7800,
  subtotalEvidence: 'Subtotal de productos: $7.800.' }] }, partialText.replace('2.800', '7.800'))
  .some(a => !a.passed && a.severity === 'P0'), 'A partial label never excuses counting an unpriced budget');
assert.ok(evaluatePartial({ ...partialVerdict, turns: [{ ...partialVerdict.turns[0], subtotalScopeEvidence: 'invented exclusion' }] })
  .some(a => !a.passed && a.severity === 'EVALUATOR'));
const human = { conversationId: 'c', type: 'approval.requested', gateKey: 'discount', title: 'Descuento', status: 'pending' };
assert.ok(checkHumanTaskUniqueness([human]).every((a) => a.passed));
assert.ok(checkHumanTaskUniqueness([human, { ...human }]).some((a) => !a.passed));
assert.ok(checkHumanTaskUniqueness([human, { ...human, gateKey: 'other_exception', title: 'Otra excepción' }]).every((a) => a.passed), 'distinct work must not be merged');
assert.ok(checkHumanTaskUniqueness([human, { ...human, title: 'Seguimiento al descuento' }]).some((a) => !a.passed), 'a new title does not create a new need');
assert.deepEqual(publicOptions([{ interactive: { action: { sections: [{ rows: [{ id: 'p', title: 'Producto' }] }] } } }]), [{ id: 'p', title: 'Producto', kind: 'list_reply' }]);

// Paid delivery expectations are fixed independently of production pricing snapshots.
const deliveryScenario = { ...scenario, deliveryPolicy: { deliveryFee: 3000, deliveryMinimumSubtotal: 10000 } };
const pricing = { subtotal: 10000, deliveryFee: 3000, total: 13000, minimumSubtotal: 10000,
  shortfall: 0, minimumMet: true, status: 'eligible', currency: 'COP', delivery: true };
const deliveryOrder = { ...order, pricing };
assert.ok(evaluate(deliveryOrder, { scenario: deliveryScenario }).every(a => a.passed));
for (const [label, altered] of [
  ['total stored as product subtotal', { ...deliveryOrder, subtotal: 13000 }],
  ['total stored as snapshot subtotal', { ...deliveryOrder, pricing: { ...pricing, subtotal: 13000 } }],
  ['delivery charged twice', { ...deliveryOrder, pricing: { ...pricing, total: 16000 } }],
  ['missing pricing snapshot', order],
  ['minimum presented as delivery fee', { ...deliveryOrder, pricing: { ...pricing, deliveryFee: 10000 } }],
  ['changed currency', { ...deliveryOrder, pricing: { ...pricing, currency: 'USD' } }],
]) assert.ok(evaluate(altered, { scenario: deliveryScenario }).some(a => !a.passed), label);

const deliveryText = 'Subtotal de productos: $10.000. Domicilio: $3.000. Total: $13.000. ¿Confirmas?';
const deliveryDialogue = [{ outbound: [{ text: deliveryText }], draft }];
const deliveryAction = { ...action, quoteSubtotal: 10000, quoteDeliveryFee: 3000, quoteTotal: 13000,
  quoteSubtotalEvidence: 'Subtotal de productos: $10.000.', quoteDeliveryFeeEvidence: 'Domicilio: $3.000.',
  quoteTotalEvidence: 'Total: $13.000.' };
const deliveryConsent = (overrides = {}, fixture = deliveryScenario, history = deliveryDialogue) =>
  checkConsent({ action: { ...deliveryAction, ...overrides }, scenario: fixture, catalog, dialogue: history });
assert.ok(deliveryConsent().every(a => a.passed));
assert.ok(deliveryConsent({ quoteSubtotal: 13000, quoteSubtotalEvidence: 'Total: $13.000.' }).some(a => !a.passed), 'total is not subtotal');
assert.ok(deliveryConsent({ quoteTotal: 10000, quoteTotalEvidence: 'Subtotal de productos: $10.000.' }).some(a => !a.passed), 'subtotal is not payable total');
assert.ok(deliveryConsent({ quoteTotal: null }).some(a => !a.passed), 'buyer cannot derive an omitted total');
assert.ok(deliveryConsent({}, deliveryScenario, [...deliveryDialogue, { outbound: [{ text: 'Cambió la tarifa; espera la nueva cotización.' }] }]).some(a => !a.passed), 'paid delivery consent must be fresh');
const mislabeled = 'Subtotal de productos: $10.000. Mínimo: $3.000. Total: $13.000.';
assert.ok(deliveryConsent({ quoteDeliveryFeeEvidence: mislabeled }, deliveryScenario, [{ outbound: [{ text: mislabeled }] }])
  .some(a => a.name === 'confirmation_deliveryFee_public_evidence' && !a.passed), 'a number in minimum evidence does not establish a fee');

const belowMinimum = { ...deliveryScenario, deliveryPolicy: { deliveryFee: 3000, deliveryMinimumSubtotal: 12000 } };
assert.ok(deliveryConsent({}, belowMinimum).some(a => a.name === 'confirmation_delivery_eligible' && !a.passed), '13000 total cannot satisfy 12000 product minimum with only 10000 products');
const belowOrderChecks = evaluate({ ...deliveryOrder, pricing: { ...pricing, minimumSubtotal: 12000, shortfall: 0, minimumMet: true } }, { scenario: belowMinimum });
assert.ok(belowOrderChecks.some(a => a.name === 'order_pricing_shortfall' && !a.passed));
assert.ok(belowOrderChecks.some(a => a.name === 'order_pricing_minimumMet' && !a.passed));
assert.ok(belowOrderChecks.some(a => a.name === 'order_delivery_eligible' && !a.passed));
for (const deliveryPolicy of [{ deliveryFee: null, deliveryMinimumSubtotal: 0 }, { deliveryFee: 3000, deliveryMinimumSubtotal: null }, {}]) {
  assert.ok(deliveryConsent({}, { ...scenario, deliveryPolicy }).some(a => a.name === 'confirmation_delivery_eligible' && !a.passed), 'unknown is not free/no minimum');
}
const freeScenario = { ...scenario, deliveryPolicy: { deliveryFee: 0, deliveryMinimumSubtotal: 0 } };
const freePricing = { ...pricing, deliveryFee: 0, total: 10000, minimumSubtotal: 0 };
assert.ok(evaluate({ ...order, pricing: freePricing }, { scenario: freeScenario }).every(a => a.passed));
const freeText = 'Productos $10.000. Domicilio $0. Total $10.000.';
assert.ok(deliveryConsent({ quoteDeliveryFee: 0, quoteTotal: 10000, quoteSubtotalEvidence: freeText,
  quoteDeliveryFeeEvidence: freeText, quoteTotalEvidence: freeText }, freeScenario, [{ outbound: [{ text: freeText }] }]).every(a => a.passed));
assert.ok(deliveryConsent({ quoteDeliveryFee: 0, quoteTotal: 10000, quoteSubtotalEvidence: 'Total $10.000.',
  quoteDeliveryFeeEvidence: freeText, quoteTotalEvidence: freeText }, freeScenario, [{ outbound: [{ text: freeText }] }])
  .some(a => a.name === 'confirmation_subtotal_public_evidence' && !a.passed), 'even equal numeric totals do not establish a subtotal claim');

const deliveryTurn = { turn: 1, products: [], subtotal: 10000, subtotalEvidence: deliveryAction.quoteSubtotalEvidence,
  deliveryFee: 3000, deliveryFeeEvidence: deliveryAction.quoteDeliveryFeeEvidence, total: 13000, totalEvidence: deliveryAction.quoteTotalEvidence,
  confirmationOffered: true, evidence: '¿Confirmas?' };
const deliveryClaims = (turn = deliveryTurn, fixture = deliveryScenario, history = deliveryDialogue) => checkPublicClaims({
  verdict: { verdict: 'pass', issues: [], missingNeeds: [], turns: [turn] }, dialogue: history, catalog, scenario: fixture,
});
assert.ok(deliveryClaims().every(a => a.passed));
assert.ok(deliveryClaims({ ...deliveryTurn, subtotal: 13000, subtotalEvidence: deliveryTurn.totalEvidence })
  .some(a => a.name === 'public_subtotal_evidence_1' && !a.passed), 'judge cannot relabel final total as subtotal');
assert.ok(deliveryClaims({ ...deliveryTurn, total: 16000, totalEvidence: 'Total: $16.000.' }, deliveryScenario,
  [{ ...deliveryDialogue[0], outbound: [{ text: deliveryText.replace('$13.000', '$16.000') }] }])
  .some(a => a.name === 'public_total_1' && !a.passed), 'public total is checked independently');
assert.ok(deliveryClaims({ ...deliveryTurn, deliveryFee: 10000, deliveryFeeEvidence: 'Domicilio: $10.000.' }, deliveryScenario,
  [{ ...deliveryDialogue[0], outbound: [{ text: deliveryText.replace('Domicilio: $3.000', 'Domicilio: $10.000') }] }])
  .some(a => a.name === 'public_deliveryFee_1' && !a.passed), 'public delivery fee is checked independently');
assert.ok(deliveryClaims(deliveryTurn, belowMinimum).some(a => a.name === 'public_confirmation_delivery_eligible_1' && !a.passed));
assert.ok(deliveryClaims({ ...deliveryTurn, confirmationOffered: false }, belowMinimum,
  [{ ...deliveryDialogue[0], outbound: [{ ...confirmOutbound[0], text: deliveryText }] }])
  .some(a => a.name === 'public_confirmation_delivery_eligible_1' && !a.passed), 'judge omission cannot hide a real confirmation button below minimum');
assert.ok(deliveryClaims({ ...deliveryTurn, subtotal: null, deliveryFee: null }, deliveryScenario,
  [{ ...deliveryDialogue[0], outbound: [{ text: 'Total: $13.000. ¿Confirmas?' }] }])
  .some(a => a.name === 'public_confirmation_breakdown_1' && !a.passed), 'a total alone does not establish a full delivery quote');
const shortfallText = `${deliveryText} Mínimo en productos: $12.000. Faltan $2.000.`;
assert.ok(deliveryClaims({ ...deliveryTurn, confirmationOffered: false, minimumSubtotal: 12000, minimumSubtotalEvidence: 'Mínimo en productos: $12.000.',
  shortfall: 2000, shortfallEvidence: 'Faltan $2.000.' }, belowMinimum, [{ ...deliveryDialogue[0], outbound: [{ text: shortfallText }] }]).every(a => a.passed));
assert.ok(deliveryClaims({ ...deliveryTurn, confirmationOffered: false, total: 15000, totalEvidence: 'Total: $15.000.' }, belowMinimum,
  [{ ...deliveryDialogue[0], outbound: [{ text: deliveryText.replace('$13.000', '$15.000') }] }])
  .some(a => a.name === 'public_total_1' && !a.passed), 'shortfall is not a surcharge');
assert.ok(deliveryClaims(deliveryTurn, { ...scenario, deliveryPolicy: { deliveryFee: null, deliveryMinimumSubtotal: 0 } })
  .some(a => a.name === 'public_deliveryFee_1' && !a.passed), 'unknown shipping cannot become a known fee');
assert.ok(deliveryClaims(deliveryTurn, deliveryScenario, [{ ...deliveryDialogue[0], draft: { ...draft, subtotal: 99999, pricing: { total: 99999 } } }]).every(a => a.passed), 'oracle ignores production arithmetic');
assert.ok(deliveryClaims(deliveryTurn, deliveryScenario, [{ ...deliveryDialogue[0], draft: { items: [...draft.items, { product: null, quantity: 1 }] } }])
  .some(a => a.name === 'public_total_1' && !a.passed), 'incomplete basket is not a final quote');

// Inspect actor/judge contracts without making provider calls or exposing fixture prices to them.
const originalFetch = globalThis.fetch;
const actorInputs = [];
globalThis.fetch = async (_url, options) => {
  const payload = JSON.parse(options.body);
  actorInputs.push({ system: payload.messages[0].content, input: JSON.parse(payload.messages[1].content) });
  const paidDelivery = JSON.parse(payload.messages[1].content).deliveryPricingRequired;
  const answer = options.headers['x-e2e-role'] === 'customer_actor'
    ? { ...(paidDelivery ? deliveryAction : action), done: false, text: 'Sí', optionId: null }
    : { verdict: 'pass', issues: [], turns: [paidDelivery ? deliveryTurn : { turn: 1, products: [], subtotal: 10000, subtotalEvidence: 'Total: $ 10.000.' }], missingNeeds: [] };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }));
};
try {
  const buyer = await nextCustomerTurn({ scenario: { ...deliveryScenario, confirmText: 'Confirmo' }, dialogue: deliveryDialogue, products: catalog });
  assert.equal(buyer.quoteTotal, 13000);
  assert.equal(buyer.quoteDeliveryFeeEvidence, deliveryAction.quoteDeliveryFeeEvidence);
  assert.ok(actorInputs[0].system.includes('quoteTotalEvidence') && actorInputs[0].system.includes('quoteDeliveryFee'));
  assert.equal(actorInputs[0].input.deliveryPricingRequired, true);
  const fixtureContext = { deliveryPolicy: { deliveryFee: 3000, deliveryMinimumSubtotal: 10000 }, existingCustomer: { name: 'Cliente registrado', defaultAddress: 'Dirección previamente guardada' } };
  const judged = await judgeConversation({ scenario: deliveryScenario, dialogue: deliveryDialogue, catalog, fixtureContext });
  assert.equal(judged.turns[0].total, 13000);
  assert.ok(actorInputs[1].system.includes('deliveryFeeEvidence') && actorInputs[1].system.includes('shortfallEvidence'));
  assert.equal(actorInputs[1].input.deliveryPricingRequired, true);
  assert.deepEqual(actorInputs[1].input.fixtureContext, fixtureContext);
  assert.equal(Object.hasOwn(actorInputs[1].input.scenario, 'buyer'), false, 'Private future buyer choices must not reach the judge');
  await nextCustomerTurn({ scenario, dialogue, products: catalog });
  await judgeConversation({ scenario, dialogue, catalog });
  assert.equal(actorInputs[2].input.deliveryPricingRequired, false);
  assert.equal(actorInputs[3].input.deliveryPricingRequired, false);
  const withButton = [{ ...dialogue[0], customerInteraction: { kind: 'button_reply', id: 'opaque-option', title: 'Aceite Premier giras', internalSku: 'not-public' } }];
  await judgeConversation({ scenario, dialogue: withButton, catalog });
  assert.deepEqual(actorInputs[4].input.dialogue[0].customerInteraction,
    { kind: 'button_reply', id: 'opaque-option', title: 'Aceite Premier giras' }, 'Preserve the public interaction without exposing private SKU resolution');
} finally { globalThis.fetch = originalFetch; }
let repairs = 0;
const repaired = await nextCustomerTurn({ scenario: { ...scenario, confirmText: 'Confirmo' }, dialogue, products: catalog,
  request: async (_role, _system, input) => {
    repairs++;
    if (!input.repair) return { done: true, act: 'stop', text: '', stopBasis: 'query_answered', stopEvidence: 'Total: $ 10.000.' };
    return { ...action, done: false, text: 'Confirmo', optionId: null };
  } });
assert.equal(repairs, 2); assert.equal(repaired.act, 'confirm_order'); assert.ok(repaired.protocolRepair);
const falsePaymentIssue = { verdict: 'fail', turns: [{ turn: 1, products: [], paymentVerified: false }],
  issues: [{ turn: 1, criterion: 'payment_accreditation', evidence: 'Efectivo', reason: 'No verificó pago' }] };
assert.ok(judgeProtocolIssues(falsePaymentIssue, { scenario, catalog, dialogue: [{ turn: 1, outbound: [{ text: 'Efectivo' }] }] })
  .some(error => error.includes('out of scope')));
assert.ok(judgeProtocolIssues({ ...falsePaymentIssue, issues: [{ ...falsePaymentIssue.issues[0], criterion: 'verify_cash_before_delivery' }] },
  { scenario, catalog, dialogue: [{ turn: 1, outbound: [{ text: 'Efectivo' }] }] }).some(error => error.includes('unknown rubric')));
assert.equal(contextualAcceptanceScenarios.length, 50);
assert.equal(terminationAtTurnCap({ done: true, act: 'stop', text: 'Gracias, ya me quedó claro.' }, 'query'), 'customer_goal_satisfied');
assert.equal(terminationAtTurnCap({ done: false, act: 'clarify', text: 'Todavía falta el precio.' }, 'query'), 'turn_budget_exhausted');
assert.equal(terminationAtTurnCap({ done: false, act: 'clarify' }, 'opening'), 'opening_exercised');
const identityCatalog = [{ sku: 'paper', name: 'Papel higienico', price: 9800 }, { sku: 'soap', name: 'Jabon Varela barra', presentation: '300 g', price: 3300 }];
const identityDialogue = [{ turn: 1, outbound: [{ text: 'Jabón Varela barra 300 g: $ 3.300.' }] }];
const identityVerdict = { verdict: 'pass', issues: [], turns: [{ turn: 1, products: [{ sku: 'paper', name: 'Jabon Varela barra', unitPrice: 3300, evidence: identityDialogue[0].outbound[0].text }] }] };
assert.ok(judgeProtocolIssues(identityVerdict, { scenario, catalog: identityCatalog, dialogue: identityDialogue }).some(e => e.includes('belongs to SKU soap')));
const wrongPriceVerdict = structuredClone(identityVerdict); wrongPriceVerdict.turns[0].products[0].sku = 'soap';
assert.ok(!judgeProtocolIssues(wrongPriceVerdict, { scenario, catalog: identityCatalog.map(p => ({ ...p, price: 9000 })), dialogue: identityDialogue }).some(e => e.includes('belongs to SKU')),
  'A real price mismatch must not trigger identity repair');
assert.equal(new Set(contextualAcceptanceScenarios.map((s) => s.id)).size, 50);
for (const s of contextualAcceptanceScenarios) for (const item of s.basket) assert.ok(colombiaCatalogTestSeed300.some((p) => p.sku === item.sku && p.stock >= item.quantity), `${s.number}: missing oracle SKU`);
console.log('Acceptance v2: 50 legacy scenarios preserved; delivery consent, subtotal/fee/total evidence, minimum eligibility, independent snapshots and actor/judge contracts passed.');
