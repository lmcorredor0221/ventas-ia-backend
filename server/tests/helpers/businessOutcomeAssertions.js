// Independent business oracle: no imports from production calculators/planners.
export const check = (name, passed, detail, severity = 'P0') => ({ name, passed: Boolean(passed), detail: typeof detail === 'string' ? detail : JSON.stringify(detail), severity });
export const sumBasket = (basket, catalog) => basket.reduce((sum, item) => {
  const row = catalog.find((p) => p.sku === item.sku);
  if (!row || !Number.isFinite(row.price) || !Number.isFinite(item.quantity)) throw new Error(`Oracle: unknown SKU/price/quantity ${item.sku}`);
  return sum + row.price * item.quantity;
}, 0);
const sameBasket = (a, b) => JSON.stringify(a.map(({ sku, quantity }) => ({ sku, quantity })).sort((x, y) => x.sku.localeCompare(y.sku)))
  === JSON.stringify(b.map(({ sku, quantity }) => ({ sku, quantity })).sort((x, y) => x.sku.localeCompare(y.sku)));
export const amounts = (text = '') => [...text.matchAll(/(?:\$\s*|COP\s*)(\d[\d.,]*(?:[ \u00a0]\d{3})*)|(\d[\d.,]*)\s*pesos/gi)].map((m) => {
  let raw = (m[1] ?? m[2]).replace(/\s/g, '').replace(/[.,]$/, '');
  if (/[.,]\d{2}$/.test(raw)) { const decimals = raw.slice(-2); raw = raw.slice(0, -3).replace(/[.,]/g, '') + '.' + decimals; }
  else raw = raw.replace(/[.,]/g, '');
  return Number(raw);
});
const hasEvidence = (text, evidence) => Boolean(evidence) && text.replace(/\s+/gu, ' ').includes(evidence.replace(/\s+/gu, ' '));
const hasDeliveryPolicy = (scenario) => scenario?.deliveryPolicy !== undefined;

// Expectations come only from test fixtures/catalog, never from order.pricing.
function expectedDeliveryPricing(subtotal, scenario, complete = true) {
  const delivery = scenario.delivery !== false;
  const policy = scenario.deliveryPolicy ?? {};
  for (const value of [policy.deliveryFee, policy.deliveryMinimumSubtotal]) {
    if (value != null && (!Number.isSafeInteger(value) || value < 0)) throw new Error('Oracle: invalid delivery policy fixture');
  }
  const deliveryFee = delivery ? policy.deliveryFee ?? null : 0;
  const minimumSubtotal = delivery ? policy.deliveryMinimumSubtotal ?? null : 0;
  const minimumMet = complete && minimumSubtotal != null ? subtotal >= minimumSubtotal : null;
  const total = complete && deliveryFee != null ? subtotal + deliveryFee : null;
  if (!Number.isSafeInteger(subtotal) || (total != null && !Number.isSafeInteger(total))) throw new Error('Oracle: unsafe COP amount');
  return { subtotal, deliveryFee, minimumSubtotal, total, minimumMet,
    shortfall: complete && minimumSubtotal != null ? Math.max(0, minimumSubtotal - subtotal) : null,
    delivery, currency: 'COP',
    status: !complete ? 'basket_incomplete' : !delivery ? 'not_applicable'
      : deliveryFee == null || minimumSubtotal == null ? 'configuration_incomplete' : minimumMet ? 'eligible' : 'below_minimum' };
}

const amountLabels = {
  subtotal: '(?:subtotal(?: de productos)?|(?:total(?: de| en)? )?productos)',
  deliveryFee: '(?:costo (?:del domicilio|de env[ií]o|de entrega)|tarifa(?: (?:de|del) (?:domicilio|env[ií]o|entrega))?|domicilio|env[ií]o|entrega)',
  total: 'total(?!\\s+(?:de |en )?productos)(?: final| a pagar| del pedido)?',
  minimumSubtotal: '(?:pedido m[ií]nimo|m[ií]nimo(?: (?:de|en) productos)?)',
  shortfall: '(?:faltan|faltante(?: para el m[ií]nimo)?)',
};
function hasLabeledAmount(evidence, field, value) {
  if (typeof evidence !== 'string' || !Number.isSafeInteger(value) || value < 0) return false;
  // Bind the amount to its label. Finding both numbers anywhere in a quote is insufficient.
  const pattern = new RegExp(`\\b${amountLabels[field]}\\s*(?:(?:es|son|de|por|cuesta)\\s*)?[:=]?\\s*((?:\\$\\s*|COP\\s*)\\d[\\d.,]*(?:[ \\u00a0]\\d{3})*|\\d[\\d.,]*\\s*pesos)`, 'gi');
  return [...evidence.matchAll(pattern)].some((match) => amounts(match[0]).includes(value));
}
const labeledEvidence = (text, evidence, field, value) => hasEvidence(text, evidence) && hasLabeledAmount(evidence, field, value);

function independentDraftSubtotal(draft, catalog, scenario) {
  let subtotal = 0; let priced = 0; let uncertain = false;
  for (const item of draft?.items ?? []) {
    const row = catalog.find((p) => p.sku === item.product?.sku);
    if (!row || (item.resolution && item.resolution.status !== 'resolved')) { uncertain = true; continue; }
    if (Number.isSafeInteger(item.quantity) && item.quantity > 0) { subtotal += row.price * item.quantity; priced++; }
    else uncertain = true; // A private budget cap is not evidence of a sale unit.
  }
  return { subtotal, priced, uncertain, complete: priced > 0 && !uncertain };
}

export function checkConsent({ action, scenario, catalog, dialogue }) {
  if (action.act !== 'confirm_order') return [];
  const text = (dialogue.at(-1)?.outbound ?? []).map((m) => m.text).join('\n');
  if (hasDeliveryPolicy(scenario)) {
    const expected = expectedDeliveryPricing(sumBasket(scenario.basket, catalog), scenario);
    const result = [
      check('confirmation_purchase_only', scenario.outcome === 'purchase', scenario.outcome),
      check('confirmation_basket', sameBasket(action.quoteLines ?? [], scenario.basket), action.quoteLines),
      check('confirmation_delivery_eligible', ['eligible', 'not_applicable'].includes(expected.status) && expected.subtotal > 0, expected),
    ];
    for (const [field, key, evidenceKey] of [
      ['subtotal', 'quoteSubtotal', 'quoteSubtotalEvidence'],
      ['deliveryFee', 'quoteDeliveryFee', 'quoteDeliveryFeeEvidence'],
      ['total', 'quoteTotal', 'quoteTotalEvidence'],
    ]) {
      result.push(check(`confirmation_${field}`, expected[field] != null && action[key] === expected[field], { quoted: action[key], expected: expected[field] }));
      result.push(check(`confirmation_${field}_public_evidence`, labeledEvidence(text, action[evidenceKey], field, action[key]), action[evidenceKey]));
    }
    return result;
  }
  const total = sumBasket(scenario.basket, catalog);
  return [
    check('confirmation_purchase_only', scenario.outcome === 'purchase', scenario.outcome),
    check('confirmation_basket', sameBasket(action.quoteLines ?? [], scenario.basket), action.quoteLines),
    check('confirmation_total', action.quoteSubtotal === total && total > 0, { quoted: action.quoteSubtotal, expected: total }),
    check('confirmation_public_evidence', hasEvidence(text, action.quoteEvidence) && amounts(action.quoteEvidence).includes(total), action.quoteEvidence),
  ];
}

export function checkOrder({ order, scenario, catalog, tenantId, accepted, count }) {
  const result = [check('at_most_one_order', count <= 1, count),
    check('no_unlinked_order', count === (order ? 1 : 0), count),
    check('no_order_for_non_purchase', scenario.outcome === 'purchase' || count === 0, count)];
  if (!order) {
    result.push(check('expected_business_outcome', scenario.outcome !== 'purchase', 'No hay pedido persistido.', 'P1'));
    return result;
  }
  result.push(check('order_tenant', order.tenantId === tenantId, order.tenantId));
  result.push(check('order_requires_consent', accepted && scenario.outcome === 'purchase', { accepted, outcome: scenario.outcome }));
  result.push(check('order_exact_basket', sameBasket(order.items ?? [], scenario.basket), order.items));
  if (typeof scenario.expectedDelivery === 'boolean') {
    result.push(check('delivery_mode_preserved', order.delivery === scenario.expectedDelivery,
      { expected: scenario.expectedDelivery, actual: order.delivery }));
  }
  for (const item of order.items ?? []) {
    const row = catalog.find((p) => p.sku === item.sku);
    result.push(check(`price_${item.sku}`, row && item.unitPrice === row.price, { item, price: row?.price }));
    result.push(check(`line_${item.sku}`, row && item.lineTotal === row.price * item.quantity, item));
    result.push(check(`stock_${item.sku}`, row && row.active !== false && row.stock >= item.quantity && item.quantity > 0, item));
  }
  result.push(check('order_subtotal_exact', order.subtotal === sumBasket(scenario.basket, catalog) && order.subtotal > 0, order.subtotal));
  if (hasDeliveryPolicy(scenario)) {
    const expected = expectedDeliveryPricing(sumBasket(scenario.basket, catalog), scenario);
    result.push(check('order_delivery_eligible', ['eligible', 'not_applicable'].includes(expected.status), expected));
    result.push(check('order_pricing_snapshot', Boolean(order.pricing), order.pricing));
    for (const [field, value] of Object.entries(expected)) {
      result.push(check(`order_pricing_${field}`, order.pricing?.[field] === value, { stored: order.pricing?.[field], expected: value }));
    }
  }
  result.push(check('delivery_details', Boolean(order.customerName && order.deliveryAddress), { name: order.customerName, address: order.deliveryAddress }));
  const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (scenario.buyer) {
    result.push(check('customer_preserved', normalize(order.customerName) === normalize(scenario.buyer.name), order.customerName));
    result.push(check('address_preserved', normalize(order.deliveryAddress) === normalize(scenario.buyer.address), order.deliveryAddress));
  }
  return result;
}

export function checkTurn({ outbound, order, accepted, draft, catalog }) {
  const result = [check('fresh_outbound', outbound.length > 0, `${outbound.length} nuevos envíos`, 'P1'),
    check('no_premature_order', !order || accepted, order?.id ?? 'sin pedido')];
  const offersConfirmation = outbound.some((message) => (message.interactive?.action?.buttons ?? [])
    .some((button) => button.reply?.title === 'Confirmar pedido'));
  if (offersConfirmation) {
    const pending = (draft?.items ?? []).filter((item) => !item.product?.sku || item.resolution?.status !== 'resolved'
      || !Number.isSafeInteger(item.quantity) || item.quantity <= 0);
    result.push(check('confirmation_only_complete_basket', Boolean(draft?.items?.length)
      && pending.length === 0 && !(draft?.missingFields?.length), { pendingIds: pending.map(i => i.rawItemId), missing: draft?.missingFields }));
  }
  for (const item of draft?.items ?? []) {
    if (!item.product?.sku) continue;
    const row = catalog.find((p) => p.sku === item.product.sku);
    result.push(check(`draft_price_${item.product.sku}`, row && item.product.price === row.price, item.product));
    if (Number.isFinite(item.quantity) && item.lineTotal != null) result.push(check(`draft_line_${item.product.sku}`, row && item.lineTotal === row.price * item.quantity, item));
  }
  return result;
}

export function checkPublicClaims({ verdict, dialogue, catalog, scenario }) {
  const result = [];
  for (const turn of verdict.turns) {
    const actual = dialogue[turn.turn - 1];
    const text = (actual?.outbound ?? []).map((m) => [m.text, ...(m.interactive?.action?.buttons ?? []).map((b) => b.reply?.title ?? ''), ...(m.interactive?.action?.sections ?? []).flatMap((s) => s.rows.map((r) => `${r.title} ${r.description ?? ''}`))].join('\n')).join('\n');
    result.push(check(`judge_turn_${turn.turn}_grounded`, Boolean(actual), turn.turn, 'EVALUATOR'));
    for (const claim of turn.products ?? []) {
      const row = catalog.find((p) => p.sku === claim.sku);
      const grounded = hasEvidence(text, claim.evidence);
      result.push(check(`public_evidence_${turn.turn}_${claim.sku}`, grounded, claim, 'EVALUATOR'));
      // A public name-to-SKU mapping is still a judgement, unlike a stored SKU.
      if (grounded) result.push(check(`public_product_${turn.turn}_${claim.sku}`, Boolean(row), claim, 'REVIEW'));
      if (claim.unitPrice != null) {
        const priceEvidence = grounded && amounts(claim.evidence).includes(claim.unitPrice);
        result.push(check(`public_price_evidence_${turn.turn}_${claim.sku}`, priceEvidence, claim, 'EVALUATOR'));
        if (priceEvidence) result.push(check(`public_price_${turn.turn}_${claim.sku}`, row && claim.unitPrice === row.price, claim, 'REVIEW'));
        if (priceEvidence && scenario?.maxBudget != null) result.push(check(`budget_option_${turn.turn}_${claim.sku}`, claim.unitPrice <= scenario.maxBudget, { price: claim.unitPrice, budget: scenario.maxBudget }));
      }
    }
    if (hasDeliveryPolicy(scenario)) {
      const basket = independentDraftSubtotal(actual?.draft, catalog, scenario);
      const expected = expectedDeliveryPricing(basket.subtotal, scenario, basket.complete);
      for (const field of ['subtotal', 'deliveryFee', 'minimumSubtotal', 'shortfall', 'total']) {
        if (turn[field] == null) continue;
        const grounded = labeledEvidence(text, turn[`${field}Evidence`], field, turn[field]);
        result.push(check(`public_${field}_evidence_${turn.turn}`, grounded, turn[`${field}Evidence`], 'EVALUATOR'));
        if (!grounded) continue;
        if (field === 'subtotal' && (!basket.priced || basket.uncertain)) {
          result.push(check(`public_subtotal_unverified_${turn.turn}`, false, turn[field], 'REVIEW'));
        } else {
          result.push(check(`public_${field}_${turn.turn}`, expected[field] != null && turn[field] === expected[field], { public: turn[field], expected: expected[field] }));
        }
      }
      const publicButton = (actual?.outbound ?? []).some((m) => (m.interactive?.action?.buttons ?? []).some((b) => b.reply?.title === 'Confirmar pedido'));
      if (turn.confirmationOffered) result.push(check(`public_confirmation_evidence_${turn.turn}`, hasEvidence(text, turn.evidence), turn.evidence, 'EVALUATOR'));
      if (publicButton || (turn.confirmationOffered && hasEvidence(text, turn.evidence))) {
        result.push(check(`public_confirmation_delivery_eligible_${turn.turn}`, ['eligible', 'not_applicable'].includes(expected.status), expected));
        result.push(check(`public_confirmation_breakdown_${turn.turn}`, ['subtotal', 'deliveryFee', 'total']
          .every((field) => hasLabeledAmount(text, field, expected[field])), 'La cotización pública debe acreditar productos, domicilio y total por separado.', 'REVIEW'));
      }
      if (turn.total != null && scenario.maxBudget != null && labeledEvidence(text, turn.totalEvidence, 'total', turn.total)) {
        result.push(check(`budget_total_${turn.turn}`, turn.total <= scenario.maxBudget, turn.total));
      }
    } else if (turn.subtotal != null) {
      const totalEvidence = hasEvidence(text, turn.subtotalEvidence) && amounts(turn.subtotalEvidence).includes(turn.subtotal);
      result.push(check(`public_subtotal_evidence_${turn.turn}`, totalEvidence, turn, 'EVALUATOR'));
      // Offered alternatives are NOT a basket. Compute only from the exact
      // persisted draft, using independent catalog prices/private monetary caps.
      // Never promote an unverified quantity extracted by the judge into a P0.
      const { subtotal: expected, priced, uncertain } = independentDraftSubtotal(actual?.draft, catalog, scenario);
      const partialEvidence = turn.subtotalScope === 'priced_lines' && hasEvidence(text, turn.subtotalScopeEvidence);
      if (turn.subtotalScope === 'priced_lines') result.push(check(`public_partial_scope_${turn.turn}`, partialEvidence, turn.subtotalScopeEvidence, 'EVALUATOR'));
      const confirms = turn.confirmationOffered || (actual?.outbound ?? []).some(m => (m.interactive?.action?.buttons ?? []).some(b => b.reply?.title === 'Confirmar pedido'));
      if (totalEvidence && priced && (!uncertain || (partialEvidence && !confirms))) result.push(check(`public_subtotal_${turn.turn}`, expected > 0 && turn.subtotal === expected, { public: turn.subtotal, expected }));
      else if (totalEvidence) result.push(check(`public_subtotal_unverified_${turn.turn}`, false, { public: turn.subtotal, expected: null }, 'REVIEW'));
      if (totalEvidence && scenario?.maxBudget != null) result.push(check(`budget_total_${turn.turn}`, turn.subtotal <= scenario.maxBudget, turn.subtotal));
    }
    if (turn.paymentVerified) result.push(check(`payment_verification_out_of_scope_${turn.turn}`, false, turn.evidence,
      hasEvidence(text, turn.evidence) ? 'P1' : 'EVALUATOR'));
  }
  for (const issue of verdict.issues) {
    const messages = (dialogue[issue.turn - 1]?.outbound ?? []).map((m) => m.text).join('\n');
    result.push(check(`judge_issue_${issue.turn}_evidence`, hasEvidence(messages, issue.evidence), issue, 'EVALUATOR'));
  }
  result.push(check('semantic_conversation', verdict.verdict === 'pass' && verdict.issues.every((i) => i.severity === 'P2') && !(verdict.missingNeeds?.length), verdict, verdict.verdict === 'review' ? 'REVIEW' : 'P1'));
  return result;
}

// These private buyer limits are fixed before execution and never reach VIA.
export function checkBasketBounds({ draft, scenario }) {
  const result = [];
  for (const limit of scenario.quantityCaps ?? scenario.basket ?? []) {
    const quantity = (draft?.items ?? []).filter((i) => i.product?.sku === limit.sku)
      .reduce((sum, i) => sum + (Number.isFinite(i.quantity) ? i.quantity : 0), 0);
    result.push(check(`basket_quantity_limit_${limit.sku}`, quantity <= limit.quantity, { quantity, limit: limit.quantity }));
  }
  for (const limit of scenario.amountCaps ?? []) {
    const amount = (draft?.items ?? []).filter((i) => i.product?.sku === limit.sku)
      .reduce((sum, i) => sum + (Number.isFinite(i.budgetAmount) ? i.budgetAmount : 0), 0);
    result.push(check(`basket_amount_limit_${limit.sku}`, amount <= limit.amount, { amount, limit: limit.amount }));
  }
  return result;
}

export function checkHumanTaskUniqueness(pending = []) {
  const groups = new Map();
  for (const task of pending.filter((p) => p.status === 'pending')) {
    const key = JSON.stringify([task.tenantId, task.conversationId, task.type, task.action ?? null,
      task.gateKey ?? null, task.contextSnapshot?.orderId ?? null,
      task.contextSnapshot?.plan?.semanticFrame?.humanTask?.newNeed ? task.id : null]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([key, count]) => check('human_task_unique', count <= 1, { key, count }, 'P1'));
}
