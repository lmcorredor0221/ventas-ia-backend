import { GROUNDING_ACTIONS, groundingQueries, validateGroundingDecision } from '../domain/groundingContracts.js';
import { evaluateDeliveryPolicy, deliveryPolicyForTenant, catalogSaleUnitEvidence } from '../domain/deliveryPolicy.js';

export class ConversationGroundingCoordinator {
  constructor({ tools, agent, events, config }) { Object.assign(this, { tools, agent, events, config }); }

  async resolve({ tenantId, conversationId, traceId, items, frame, conversation, tenant, validatedSelection, isCurrent = async () => true }) {
    const startedAt = Date.now();
    const budget = Math.max(1000, Number(this.config.llmGroundingTimeoutMs ?? 15000));
    const maxRounds = Math.max(1, Math.min(2, Number(this.config.llmGroundingMaxRounds ?? 2)));
    const hasValidatedSelection = ['select_product_variant', 'set_payment_method'].includes(validatedSelection?.action);
    const observations = items.map((item) => {
      // An exact UI choice cannot silently replace other basket products. This
      // binding lasts for this structured turn only; later language is re-read.
      const boundSku = hasValidatedSelection && item.resolution?.status === 'resolved' ? item.product?.sku : null;
      return { item, boundSku, rows: [], queries: boundSku ? [] : groundingQueries(item), searched: [] };
    });
    let nextAction = 'continue_order';
    let contractRepair = null;
    const changedIds = new Set((frame?.items ?? []).map(item => item.rawItemId));
    const emit = (type, metadata) => this.events.emit({ type, tenantId, conversationId, detail: type, metadata: { traceId, ...metadata } });
    const fail = (reason) => {
      emit('catalog.grounding.rejected', { reason, durationMs: Date.now() - startedAt });
      return { observations, nextAction: 'human_review', resolutions: observations.map(({ item, rows }) => {
        // A malformed provider response is not evidence that a previously
        // selected product disappeared. Preserve only unchanged identities
        // that were retrieved and validated again in this turn. The overall
        // action still escalates; this cannot authorize a purchase.
        if (frame?.cartMutation?.mode !== 'snapshot' && !changedIds.has(item.rawItemId)
          && item.resolution?.status === 'resolved' && item.product?.sku) {
          const retained = validateGroundingDecision({ action: 'resolved', sku: item.product.sku,
            reason: 'unchanged_selection_revalidated_after_technical_failure' }, { item, rows, tenantId });
          if (retained.status === 'resolved') return retained;
        }
        return validateGroundingDecision({ action: 'human_review', reason }, { item, rows, tenantId });
      }) };
    };
    emit('catalog.grounding.started', { itemCount: items.length });
    if (!items.length) return { observations, resolutions: [], nextAction: 'continue_order' };
    if (items.length > 12) return fail('grounding_item_budget');
    try {
      for (let round = 1; round <= maxRounds; round++) {
        if (!await isCurrent()) return { aborted: true, reason: 'conversation_changed' };
        // Each item is an independent read-only observation. Keep the
        // resolver/LLM as the owner of interpretation, but overlap catalog
        // I/O with a small bound so a two- or three-product request does not
        // pay the full Google latency once per item.
        const readConcurrency = Math.max(1, Math.min(4, Number(this.config.catalogReadConcurrency ?? 4)));
        const readResults = await mapWithConcurrency(observations, readConcurrency, async (obs) => {
          let connectionRequired = false;
          if (obs.boundSku && !obs.searched.length) {
            if (Date.now() - startedAt >= budget) return { obs, connectionRequired: false, deadline: true };
            const result = await withinDeadline(this.tools.call('google_sheets_read_table', tenantId, conversationId,
              { filters: { sku: obs.boundSku }, cache_policy: 'short_ttl' }), budget - (Date.now() - startedAt));
            if (result.status === 'connection_required') connectionRequired = true;
            obs.rows = (result.rows ?? []).filter(row => row.sku === obs.boundSku && (!row.tenantId || row.tenantId === tenantId));
            obs.searched.push(`sku:${obs.boundSku}`);
          }
          for (const query of obs.queries) {
            if (obs.searched.includes(query)) continue;
            if (Date.now() - startedAt >= budget) return { obs, connectionRequired, deadline: true };
            const result = await withinDeadline(this.tools.call('google_sheets_read_table', tenantId, conversationId,
              { filters: { query }, cache_policy: 'short_ttl' }), budget - (Date.now() - startedAt));
            if (result.status === 'connection_required') connectionRequired = true;
            obs.searched.push(query);
            const bySku = new Map(obs.rows.map((row) => [row.sku, row]));
            for (const row of (result.rows ?? []).slice(0, 8)) if (!row.tenantId || row.tenantId === tenantId) bySku.set(row.sku, row);
            obs.rows = [...bySku.values()].slice(0, 16);
          }
          return { obs, connectionRequired, deadline: false };
        });
        if (readResults.some(result => result.deadline)) return fail('grounding_deadline');
        if (readResults.some(result => result.connectionRequired)) return fail('catalog_connection_required');
        for (const obs of observations) {
          emit('catalog.grounding.observed', { round, rawItemId: obs.item.rawItemId, queries: obs.searched,
            candidates: obs.rows.map(({ sku, matchScore, matchEvidence }) => ({ sku, matchScore, matchEvidence })) });
        }
        const remainingMs = budget - (Date.now() - startedAt);
        if (remainingMs <= 0) return fail('grounding_deadline');
        const result = await withinDeadline(this.agent.decide({ tenantId, conversationId, traceId, round, remainingMs, canRefine: round < maxRounds,
          commerce: tenant ? { policy: deliveryPolicyForTenant(tenant),
            review: conversation?.pendingQuestion?.kind === 'delivery_review_resolved' && conversation?.deliveryResolution?.authorized
              ? { outcome: 'approved', resolution: conversation.deliveryResolution, buyerAcceptancePending: true } : null,
            pricing: evaluateDeliveryPolicy({ tenant, items, delivery: frame?.delivery ?? conversation?.orderDraft?.delivery,
              resolution: conversation?.deliveryResolution }),
            note: 'pricing refleja líneas ya resueltas; candidatos de nuevas líneas son evidencia para proponer continuación. El backend recalcula después de tu selección.' } : null,
          frame, validatedSelection, contractRepair, context: { orderDraft: conversation?.orderDraft, pendingQuestion: conversation?.pendingQuestion,
            messages: conversation?.messages?.slice(-12).map(({ role, text }) => ({ role, text: String(text ?? '').slice(0, 600) })) },
          observations: observations.map(({ item, rows, searched, boundSku }) => ({ item, queries: searched, boundSku, coverage: 'partial_search',
            saleUnitEvidence: catalogSaleUnitEvidence(item),
            candidates: rows.map(({ sku, name, brand, category, presentation, normalizedPresentation, description, productFamily, aliases, tags, attributes, allowsSaleByAmount, price, stock, active, matchScore, matchEvidence }) =>
              ({ sku, name, brand, category, presentation, normalizedPresentation, description, productFamily, aliases, tags, attributes, allowsSaleByAmount, price, stock, active, matchScore, matchEvidence })) })) }), remainingMs);
        if (!await isCurrent()) return { aborted: true, reason: 'conversation_changed' };
        const decisions = Array.isArray(result.decisions) ? result.decisions : [];
        const knownIds = new Set(observations.map(obs => obs.item.rawItemId));
        const contractErrors = observations.filter(obs => !obs.boundSku).flatMap(obs => {
          const matches = decisions.filter(decision => decision?.rawItemId === obs.item.rawItemId);
          return matches.length === 1 && GROUNDING_ACTIONS.has(matches[0].action) ? []
            : [`Exactly one valid product decision is required for ${obs.item.rawItemId}, including unchanged lines in observations.`];
        });
        if (decisions.some(decision => !knownIds.has(decision?.rawItemId))) contractErrors.push('Do not invent or reconstruct rawItemId: copy observations[].item.rawItemId exactly.');
        if (contractErrors.length) {
          emit('catalog.grounding.contract_repair', { round, errors: contractErrors });
          if (round >= maxRounds) return fail('invalid_grounding_contract');
          contractRepair = { invalidDecision: result, errors: contractErrors };
          continue; // Same two-round/time budget; searched queries are not repeated.
        }
        contractRepair = null;
        const actions = new Set(['continue_order', 'ask_more', 'confirm_order', 'ask_clarification', 'human_review', 'answer_question', 'invite_additions']);
        nextAction = actions.has(result.nextAction) ? result.nextAction : 'continue_order';
        const observedBySku = new Map(observations.flatMap(obs => obs.rows).map(row => [row.sku, row]));
        let refine = false;
        for (const obs of observations) {
          const decisions = (Array.isArray(result.decisions) ? result.decisions : []).filter((d) => d?.rawItemId === obs.item.rawItemId);
          // The model owns continuation and unresolved needs. Explicit consent
          // binds the existing SKU; fresh catalog guards still reject bad stock,
          // price, tenant or measure. Never infer another SKU from button text.
          const decision = obs.boundSku
            ? { action: decisions.length === 1 && decisions[0].action === 'human_review' ? 'human_review' : 'resolved',
              sku: obs.boundSku, reason: decisions.length === 1 ? decisions[0].reason : 'unchanged_basket_after_validated_interaction' }
            : decisions.length === 1 ? decisions[0] : null;
          // A semantic correction may use evidence from another search in this
          // same tenant/turn. Never import an unobserved SKU or old history.
          const selected = ['resolved', 'human_review'].includes(decision?.action) && decision?.sku ? [decision.sku] : decision?.candidateSkus ?? [];
          if (Array.isArray(selected)) for (const sku of selected) {
            const row = observedBySku.get(sku);
            if (row && (!row.tenantId || row.tenantId === tenantId) && !obs.rows.some(p => p.sku === sku)) {
              obs.rows.push(row);
              emit('catalog.grounding.evidence_reused', { round, rawItemId: obs.item.rawItemId, sku });
            }
          }
          obs.resolution = validateGroundingDecision(decision, { item: obs.item, rows: obs.rows, tenantId });
          if (obs.resolution.status === 'human_review' && decision?.action !== 'human_review') {
            emit('catalog.grounding.rejected', { round, rawItemId: obs.item.rawItemId, reason: obs.resolution.reason });
          }
          obs.queries = [];
          if (decision?.action === 'refine_search') {
            const query = typeof decision.query === 'string' ? decision.query.trim().slice(0, 240) : '';
            if (round < maxRounds && query && !obs.searched.includes(query)) { obs.queries = [query]; refine = true; }
            else obs.resolution = validateGroundingDecision({ action: 'human_review', reason: 'search_budget_exhausted' }, { item: obs.item, rows: obs.rows, tenantId });
          }
        }
        if (!refine) break;
        emit('catalog.grounding.refined', { round });
      }
      emit('conversation.action.selected', { nextAction, durationMs: Date.now() - startedAt,
        resolutions: observations.map((obs) => ({ rawItemId: obs.item.rawItemId, status: obs.resolution.status, reason: obs.resolution.reason })) });
      return { observations, resolutions: observations.map((obs) => obs.resolution), nextAction };
    } catch (error) {
      if (!await isCurrent()) return { aborted: true, reason: 'conversation_changed' };
      return fail(error.code === 'GROUNDING_DEADLINE' ? 'grounding_deadline' : 'grounding_provider_or_tool_failure');
    }
  }
}

// Tools here are read-only. A late read/provider result is discarded; it cannot mutate an order.
async function withinDeadline(promise, remainingMs) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Grounding deadline'), { code: 'GROUNDING_DEADLINE' })), Math.max(1, remainingMs));
    })]);
  } finally { clearTimeout(timer); }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
