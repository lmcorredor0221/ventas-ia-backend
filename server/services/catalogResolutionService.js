import { supportsAmountSale } from '../domain/catalogCommerce.js';

/**
 * Reconciles catalog evidence after the existing parallel searches.
 *
 * This is intentionally a bounded, single adjudication step. It does not
 * search the catalog, calculate prices, or apply business policy; those
 * responsibilities remain in ToolRegistry, AgentRuntime and checkout.
 */
export class CatalogResolutionService {
  constructor({ getPlanner, events = null, telemetry = null, enabled = false }) {
    this.getPlanner = getPlanner;
    this.events = events;
    this.telemetry = telemetry;
    this.enabled = enabled;
  }

  isEnabled(tenantId = null) {
    return typeof this.enabled === 'function' ? Boolean(this.enabled(tenantId)) : Boolean(this.enabled);
  }

  canAdjudicate(tenantId = null) {
    return this.isEnabled(tenantId) && typeof this.getPlanner?.()?.adjudicateCatalogCandidates === 'function';
  }

  async resolve({ tenantId, conversationId, normalized, conversation, items = [] }) {
    const prepared = items.map((item, index) => prepareItem(item, index));
    // A customer can explicitly remove an unresolved line. It remains in the
    // draft as audit evidence, but it is no longer a catalog task and must not
    // be re-adjudicated on later checkout turns.
    const ambiguous = prepared.filter((item) => (
      item.selectionStatus !== 'removed' && item.catalogCandidates.length > 1 && !item.product
    ));
    if (!ambiguous.length) {
      return { items: prepared, status: 'not_needed', decisions: [] };
    }

    if (!this.canAdjudicate(tenantId)) {
      return { items, status: 'legacy_fallback', decisions: [] };
    }

    const startedAt = performance.now();
    const planner = this.getPlanner();
    try {
      const adjudication = await planner.adjudicateCatalogCandidates({
        tenantId,
        conversationId,
        context: {
          traceId: normalized?.traceId ?? conversation?.traceId ?? null,
          latestMessage: normalized?.text ?? '',
          conversation: compactConversation(conversation),
          orderDraft: compactDraft(conversation?.orderDraft),
          items: prepared.filter((item) => !item.product && item.selectionStatus !== 'removed').map(compactItem),
        },
      });
      const decisions = Array.isArray(adjudication?.decisions) ? adjudication.decisions : [];
      const resolved = prepared.map((item) => item.product || item.selectionStatus === 'removed'
        ? item : applyDecision(item, decisions.find((decision) => decision.lineId === item.lineId)));
      const metadata = {
        status: adjudication?.executionMode ?? 'provider_api',
        durationMs: Math.round(performance.now() - startedAt),
        decisionCount: decisions.length,
        pendingCount: resolved.filter((item) => item.selectionStatus === 'pending').length,
      };
      this.telemetry?.record('catalog', 'reconciliation', {
        durationMs: metadata.durationMs,
        status: 'ok',
        tenantId,
        traceId: normalized?.traceId ?? conversation?.traceId ?? null,
        metadata,
      });
      this.events?.emit?.({
        type: 'catalog.reconciliation.completed',
        tenantId,
        conversationId,
        detail: 'Catalog candidates reconciled with bounded contextual adjudication',
        metadata,
      });
      return { items: resolved, status: 'adjudicated', decisions, metadata };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      this.telemetry?.record('catalog', 'reconciliation', {
        durationMs,
        status: 'fallback',
        tenantId,
        traceId: normalized?.traceId ?? conversation?.traceId ?? null,
        metadata: { errorCode: error.code ?? null },
      });
      this.events?.emit?.({
        type: 'catalog.reconciliation.fallback',
        tenantId,
        conversationId,
        detail: error.message,
        metadata: { durationMs, errorCode: error.code ?? null },
      });
      // A failed adjudication must never invent a SKU. Keep the evidence so
      // the conversation can ask for a selection or escalate safely.
      return {
        items: prepared.map((item) => item.product || item.selectionStatus === 'removed' ? item : { ...item, product: null, selectionStatus: item.catalogCandidates.length ? 'pending' : 'not_found' }),
        status: 'error_fallback',
        decisions: [],
      };
    }
  }
}

function prepareItem(item = {}, index = 0) {
  const candidates = uniqueCandidates(item.catalogCandidates ?? item.presentationOptions ?? []);
  const lineId = String(item.lineId ?? `${lineKey(item.catalogQuery ?? item.rawName ?? 'item')}:${index + 1}`);
  const product = item.product ?? null;
  const removedByCustomer = item.removedByCustomer === true || item.selectionStatus === 'removed';
  return {
    ...item,
    lineId,
    catalogCandidates: candidates,
    // `removed` is a terminal customer decision. Do not infer a pending state
    // merely because the retained audit line intentionally has no product.
    removedByCustomer,
    product: removedByCustomer ? null : product,
    selectionStatus: removedByCustomer ? 'removed' : product ? 'selected' : candidates.length ? 'pending' : 'not_found',
    presentationOptions: removedByCustomer ? [] : (item.presentationOptions?.length ? item.presentationOptions : candidates),
  };
}

function applyDecision(item, decision) {
  if (item.removedByCustomer === true || item.selectionStatus === 'removed') {
    return {
      ...item,
      product: null,
      removedByCustomer: true,
      selectionStatus: 'removed',
    };
  }
  // The model has already identified an amount-based purchase.  When the
  // catalogue proves that every retrieved candidate is the same sellable
  // product (only physical presentations differ), a backing reference is
  // needed to quote and carry that line forward.  This does not translate
  // money into weight, nor decide a product from text: it preserves the
  // monetary intent and relies exclusively on catalog facts.
  const amountSaleReference = canonicalAmountSaleReference(item.catalogCandidates, item);
  if (amountSaleReference && !['remove', 'handoff'].includes(decision?.action)) {
    return selectCandidate(item, amountSaleReference, {
      action: 'select',
      confidence: null,
      reason: 'El catálogo confirmó una única identidad comercial habilitada para venta por valor.',
      question: null,
      source: 'catalog_amount_sale_identity',
    });
  }

  if (!decision) return item;
  const requestedAction = ['select', 'ask', 'preserve', 'remove', 'handoff'].includes(decision.action) ? decision.action : 'ask';
  const selected = candidateForDecision(item.catalogCandidates, decision);
  const amountSalePresentationVariants = isAmountSalePresentationVariantSet(item.catalogCandidates, selected, item);
  // The model may rank one candidate higher, but ranking is not customer
  // confirmation. A multi-variant line remains pending until the latest
  // customer message explicitly selects one of those variants. This keeps
  // the LLM in charge of contextual interpretation without allowing an
  // adjudication call to silently change the basket.
  const action = requestedAction === 'select'
    && item.catalogCandidates.length > 1
    && decision.customerSelected !== true
    && !amountSalePresentationVariants
    ? 'ask'
    : requestedAction;
  const evidence = {
    action,
    confidence: Number.isFinite(Number(decision.confidence)) ? Number(decision.confidence) : null,
    reason: String(decision.reason ?? '').trim().slice(0, 500) || null,
    question: String(decision.question ?? '').trim().slice(0, 500) || null,
    source: 'llm_catalog_adjudication',
  };

  if (action === 'select' && selected) return selectCandidate(item, selected, evidence);
  if (action === 'preserve' && item.product) {
    return { ...item, selectionStatus: 'selected', selectionEvidence: evidence };
  }
  if (action === 'remove') {
    return { ...item, removedByCustomer: true, product: null, selectionStatus: 'removed', selectionEvidence: evidence };
  }
  return {
    ...item,
    product: null,
    selectionStatus: action === 'handoff' ? 'handoff' : 'pending',
    selectionQuestion: evidence.question,
    selectionEvidence: evidence,
  };
}

function selectCandidate(item, selected, evidence) {
  return {
    ...item,
    product: selected,
    selectionStatus: 'selected',
    selectionQuestion: null,
    selectionEvidence: evidence,
    presentationOptions: [selected, ...item.catalogCandidates.filter((candidate) => candidate.sku !== selected.sku)],
  };
}

// A customer who asks for a monetary amount is buying that value, not a
// package size. The LLM may select one catalog reference without an explicit
// list reply only when the candidates are the *same* sellable-by-amount item
// and differ solely in their physical presentation. This is an integrity
// guard over catalog evidence, not text interpretation or a price/weight
// conversion; distinct brands, flavours or varieties still require a choice.
function isAmountSalePresentationVariantSet(candidates = [], selected, item = {}) {
  if (!isPositiveAmount(item.budgetAmount) || !supportsAmountSale(selected) || candidates.length < 2) return false;
  const selectedIdentity = amountSaleProductIdentity(selected);
  if (!selectedIdentity) return false;
  return candidates.every((candidate) => (
    supportsAmountSale(candidate)
    && amountSaleProductIdentity(candidate) === selectedIdentity
  ));
}

function canonicalAmountSaleReference(candidates = [], item = {}) {
  if (!isPositiveAmount(item.budgetAmount) || !candidates.length) return null;
  const firstIdentity = amountSaleProductIdentity(candidates[0]);
  if (!firstIdentity || !candidates.every((candidate) => (
    supportsAmountSale(candidate)
    && amountSaleProductIdentity(candidate) === firstIdentity
  ))) return null;
  // The reference only supports the request while its catalog stock says it
  // is available. A zero-stock family stays unresolved so the normal
  // availability/human-review path can explain it truthfully.
  return candidates.find((candidate) => Number(candidate?.stock ?? 0) > 0) ?? null;
}

function amountSaleProductIdentity(product = {}) {
  const presentation = normalizeCatalogText(product.presentation ?? product.normalizedPresentation);
  const name = normalizeCatalogText(product.name).replace(presentation, '').replace(/\s+/g, ' ').trim();
  const brand = normalizeCatalogText(product.brand);
  const family = normalizeCatalogText(product.productFamily);
  // A product family may be absent in a tenant sheet. The normalized name and
  // brand remain enough to prove that these are presentation variants only.
  return name ? `${name}|${brand}|${family}` : null;
}

function isPositiveAmount(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;
}

function normalizeCatalogText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function candidateForDecision(candidates, decision = {}) {
  if (decision.selectedSku) return candidates.find((candidate) => String(candidate.sku) === String(decision.selectedSku)) ?? null;
  if (Number.isInteger(Number(decision.candidateIndex))) return candidates[Number(decision.candidateIndex)] ?? null;
  return candidates.length === 1 ? candidates[0] : null;
}

function uniqueCandidates(candidates = []) {
  const bySku = new Map();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = String(candidate.sku ?? `${candidate.name ?? 'product'}:${candidate.presentation ?? ''}`);
    if (!bySku.has(key)) bySku.set(key, compactProduct(candidate));
  }
  return [...bySku.values()].slice(0, 8);
}

function compactProduct(product = {}) {
  return {
    sku: product.sku ?? null,
    name: product.name ?? null,
    price: product.price ?? null,
    stock: product.stock ?? null,
    category: product.category ?? null,
    brand: product.brand ?? null,
    presentation: product.presentation ?? null,
    normalizedPresentation: product.normalizedPresentation ?? null,
    description: product.description ?? null,
    aliases: Array.isArray(product.aliases) ? product.aliases.slice(0, 8) : [],
    tags: Array.isArray(product.tags) ? product.tags.slice(0, 8) : [],
    productFamily: product.productFamily ?? null,
    attributes: product.attributes ?? null,
    matchScore: product.matchScore ?? null,
    matchType: product.matchType ?? null,
    allowsSaleByAmount: product.allowsSaleByAmount === true,
  };
}

function compactItem(item = {}) {
  return {
    lineId: item.lineId,
    rawName: item.rawName ?? null,
    catalogQuery: item.catalogQuery ?? null,
    quantity: item.quantity ?? null,
    budgetAmount: item.budgetAmount ?? null,
    requestedPresentation: item.requestedPresentation ?? null,
    requestedAttributes: item.requestedAttributes ?? null,
    selectionStatus: item.selectionStatus,
    removedByCustomer: item.removedByCustomer === true,
    currentProduct: item.product ? compactProduct(item.product) : null,
    candidates: item.catalogCandidates.map(compactProduct),
  };
}

function compactDraft(draft) {
  if (!draft) return null;
  return {
    delivery: Boolean(draft.delivery),
    paymentMethod: draft.paymentMethod ?? null,
    subtotal: draft.subtotal ?? null,
    missingFields: Array.isArray(draft.missingFields) ? draft.missingFields.slice(0, 30) : [],
    items: Array.isArray(draft.items) ? draft.items.map(compactItem) : [],
  };
}

function compactConversation(conversation) {
  return (conversation?.messages ?? []).slice(-12).map((message) => ({
    role: message.role,
    text: String(message.text ?? '').slice(0, 600),
  }));
}

function lineKey(value) {
  return String(value ?? 'item').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'item';
}
