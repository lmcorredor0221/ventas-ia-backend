import { buildCandidateSet, presentationMeasure, presentationMatches } from './semanticContracts.js';
import { catalogLineTotal } from './deliveryPolicy.js';

export const GROUNDING_ACTIONS = new Set(['resolved', 'needs_selection', 'human_review', 'unavailable', 'refine_search']);

// Scores rank evidence; this guard only checks objective business invariants.
export function validateGroundingDecision(decision, { item, rows, tenantId }) {
  const candidateSet = buildCandidateSet({ item, rows });
  const base = { schemaVersion: 'resolution-set.v1', rawItemId: item.rawItemId, candidateSet, options: [] };
  const reject = (reason) => ({ ...base, status: 'human_review', reason });
  if (!decision || !GROUNDING_ACTIONS.has(decision.action)) return reject('invalid_grounding_decision');
  // Human review can concern sale terms, not product identity. Keep an
  // explicitly supplied SKU only after the same current-evidence guards.
  const hasIdentity = decision.action === 'resolved' || (decision.action === 'human_review' && Boolean(decision.sku));
  const ids = hasIdentity ? [decision.sku] : decision.candidateSkus ?? [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length) return reject('invalid_candidate_ids');
  const candidates = ids.map((sku) => candidateSet.candidates.find((c) => c.sku === sku));
  if (candidates.some((c) => !c || (c.product.tenantId && c.product.tenantId !== tenantId))) return reject('unknown_or_foreign_candidate');
  const requested = presentationMeasure(item.presentationSignal ?? item.requestedPresentation);
  if (hasIdentity || decision.action === 'needs_selection') {
    if (!candidates.length) return reject('missing_candidate');
    if (candidates.some((c) => !c.active || !Number.isFinite(c.price) || c.price <= 0 || c.stock < Number(item.quantity ?? 1))) return reject('invalid_price_or_stock');
    if (requested && candidates.some((c) => !presentationMatches(c.product, requested))) return reject('explicit_measure_mismatch');
    if (decision.action === 'resolved' && item.saleMode === 'amount' && candidates.some(c => c.product.allowsSaleByAmount !== true)) {
      // All identity/tenant/measure/stock guards above passed. Reject the sale
      // terms without erasing the chosen identity and asking for it again.
      return { ...reject('amount_sale_not_authorized'), product: candidates[0].product };
    }
  }
  return { ...base, status: decision.action, reason: String(decision.reason ?? 'grounded_llm_decision').slice(0, 400),
    question: String(decision.question ?? '').slice(0, 600),
    ...(hasIdentity ? { product: candidates[0].product } : {}),
    options: decision.action === 'needs_selection' ? candidates.slice(0, 10) : [] };
}

export function groundingQueries(item) {
  return [...new Set([item.retrievalText, ...(item.queryVariants ?? []), item.productHypothesis, item.rawText ?? item.rawName]
    .filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim().slice(0, 240)))].slice(0, 2);
}

export function applySemanticCart(previous = [], incoming = [], mutation = {}) {
  if (mutation.mode === 'snapshot') return incoming;
  const removed = new Set(mutation.removeItemIds ?? []);
  const items = previous.filter((item) => !removed.has(item.rawItemId));
  for (const item of incoming) {
    const index = items.findIndex((old) => old.rawItemId === item.rawItemId);
    if (index < 0) items.push(item);
    else items[index] = { ...items[index], ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined)) };
    const updated = items[index < 0 ? items.length - 1 : index];
    if (item.saleMode === 'amount') updated.quantity = null;
    if (item.saleMode === 'units') updated.requestedAmount = null;
  }
  return items;
}

// Identity is selected by the interpreter, never guessed from a name or SKU.
// A null ID explicitly introduces a new need; a known ID updates that need.
export function semanticCartIdentityIssues(plan, previous = [], sourceText = '') {
  const known = new Set(previous.map((item) => item.rawItemId));
  const seen = new Set();
  const issues = [];
  for (const [index, item] of (plan.items ?? []).entries()) {
    if (!Object.hasOwn(item, 'rawItemId')) issues.push(`items[${index}].rawItemId is required (null for a new need, existing ID for an update)`);
    else if (item.rawItemId !== null) {
      if (!known.has(item.rawItemId)) issues.push(`items[${index}].rawItemId is not in existingOrder`);
      if (seen.has(item.rawItemId)) issues.push(`items[${index}].rawItemId repeats an update; express the final quantity once`);
      seen.add(item.rawItemId);
    }
  }
  for (const id of plan.cartMutation?.removeItemIds ?? []) {
    if (!known.has(id) || seen.has(id)) issues.push('removeItemIds must reference existing lines not simultaneously updated');
  }
  // Detect only repeated, identical NEW hypotheses without separate source
  // mentions. Return the inconsistency to the LLM; never merge by name/SKU or
  // decide quantities here. Distinct attributes or presentations stay distinct.
  const canonical = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase() : value ?? null;
  const groups = new Map();
  for (const [index, item] of (plan.items ?? []).entries()) {
    if (item.rawItemId !== null || !item.rawText?.trim()) continue;
    const key = JSON.stringify(canonical(Object.fromEntries(['rawText', 'productHypothesis', 'brandHint', 'categoryHint',
      'quantity', 'budgetAmount', 'saleMode', 'requestedAmount', 'presentationSignal', 'occasion', 'attributes'].map(field => [field, item[field] ?? (field === 'attributes' ? {} : null)]))));
    const group = groups.get(key) ?? { rawText: canonical(item.rawText), indexes: [] };
    group.indexes.push(index); groups.set(key, group);
  }
  for (const { rawText, indexes } of groups.values()) {
    if (indexes.length < 2) continue;
    const mentions = canonical(sourceText).split(rawText).length - 1;
    if (mentions < indexes.length) issues.push(`duplicate_new_need: items[${indexes.join(',')}] repeat an identical hypothesis without separate literal mentions. Reinterpret the original message: represent the intended quantity once, or distinguish separate needs with their actual source text/attributes. Do not invent quantities or merge different variants.`);
  }
  return issues;
}

export function semanticActionIssues(plan, conversation, sourceText = '') {
  const previousDelivery = conversation?.orderDraft?.delivery;
  if (typeof previousDelivery === 'boolean' && typeof plan.delivery === 'boolean' && plan.delivery !== previousDelivery) {
    const evidence = String(plan.deliveryChange?.evidence ?? '').trim();
    // Changing commercial terms needs an attributed customer instruction. The
    // LLM interprets its meaning; this guard does not classify pickup keywords.
    if (!evidence || !sourceText.includes(evidence) || !plan.deliveryChange?.reason?.trim()) {
      return ['delivery_change_without_source: delivery differs from existingOrder.delivery. Reinterpret the latest message in context. If the customer changed delivery/pickup, supply deliveryChange={evidence:exact quote from this message,reason:brief contextual explanation}; otherwise return delivery=null to preserve the current mode. Closing the product list or choosing payment does not by itself change delivery.'];
    }
  }
  if (plan.intent === 'catalog_query' && plan.catalogSearchReady === false && plan.items?.length) {
    return ['catalogSearchReady=false contradicts identified search subjects in items. Reinterpret whether those subjects can be searched using message/history. Readiness is not purchase consent, quantity, payment or completeness: a price/attribute query can be searched without buying. If no subject is actually inferable, remove placeholder items and explain the missing subject; otherwise set catalogSearchReady=true.'];
  }
  if (plan.intent !== 'order_clarification' || conversation?.orderDraft?.items?.length
    || plan.items?.length || plan.cartMutation?.removeItemIds?.length) return [];
  // Customer details can legitimately start being collected before products.
  // An informational turn, however, cannot clarify a nonexistent basket.
  const delta = plan.customerDelta ?? {};
  if (['name', 'address', 'paymentPreference', 'unavailablePaymentPreference'].some(field => delta[field])) return [];
  return ['order_clarification has no existing basket, product mutation or customer data. Reinterpret this informational turn from context as general_query or catalog_query (recover subjects from history if needed), without creating an empty purchase.'];
}

// Recheck commercial completeness from the actual basket, not just a cached
// missingFields list. This is a write/offer invariant, not intent recognition.
export function orderDraftBlockingFields(draft) {
  const fields = [...(draft?.missingFields ?? [])];
  const items = draft?.items ?? [];
  if (!items.length) fields.push('order_items');
  for (const item of items) {
    const subject = item.rawItemId ?? item.catalogQuery ?? item.rawName;
    if (!item.product || (item.resolution?.status && item.resolution.status !== 'resolved')) {
      fields.push(`${item.resolution?.status === 'needs_selection' ? 'presentation' : 'product'}:${subject}`);
    } else {
      if (item.product.active === false || !Number.isFinite(Number(item.product.price)) || Number(item.product.price) <= 0) fields.push(`product:${subject}`);
      if (item.available === false || Number(item.product.stock ?? 0) < Number(item.quantity ?? 1)) fields.push(`stock:${subject}`);
    }
    if (item.saleMode === 'amount' ? catalogLineTotal(item) === null : !Number.isSafeInteger(item.quantity) || item.quantity <= 0) fields.push(`quantity:${item.catalogQuery ?? item.rawName ?? subject}`);
  }
  if (!draft?.paymentMethod) fields.push('payment_method');
  if (draft?.pricing && !draft.pricing.canConfirm) fields.push(`delivery_policy:${draft.pricing.status}`);
  return [...new Set(fields)];
}
