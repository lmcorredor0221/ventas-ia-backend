import { nextCustomerTurn, judgeConversation } from './contextualCustomerActor.js';
import { check, checkConsent, checkOrder, checkTurn, checkPublicClaims, checkBasketBounds, checkHumanTaskUniqueness } from './businessOutcomeAssertions.js';

// The buyer's decision has already passed the public-evidence protocol. A
// farewell at the turn cap is not an additional business prerequisite. Retain
// it as unsent evidence; never pretend the application processed it.
export function terminationAtTurnCap(decision, outcome) {
  if (decision?.done && decision.act === 'stop') return 'customer_goal_satisfied';
  return outcome === 'opening' ? 'opening_exercised' : 'turn_budget_exhausted';
}

export async function runContextualScenario({ scenario, meta, runtime, shadow, runId, graphOutbound, resetCatalog, seedCustomer, drain, shopkeeper, summarizeLlm }) {
  const start = Date.now();
  const caseId = `${String(scenario.number).padStart(2, '0')}-${scenario.id}`;
  const waId = `57380${String(scenario.number).padStart(6, '0')}`;
  const report = { caseId, scenarioId: scenario.id, acceptanceVersion: '2.5.0', status: 'passed', steps: [], assertions: [], errors: [],
    graphOutbound: [], actorDecisions: [], dialogue: [], startedAt: new Date().toISOString(), orderId: null };
  const catalog = [...new Map([...shadow.baseCatalog, ...scenario.extraProducts].map((p) => [p.sku, p])).values()];
  const desired = scenario.basket.map((item) => ({ ...catalog.find((p) => p.sku === item.sku), quantity: item.quantity }));
  let accepted = false;
  let conversation;
  let step = scenario.initial;
  try {
    await resetCatalog(runtime.store, shadow, scenario.extraProducts);
    if (scenario.customer === 'known') await seedCustomer(runtime.store, shadow.tenantId, waId, scenario.buyer.name);
    const seededProfile = runtime.store.getState().customerProfilesByTenant?.[shadow.tenantId]?.[waId];
    const seededPolicy = runtime.store.getState().tenants.find(tenant => tenant.id === shadow.tenantId)?.config?.orderPolicy;
    report.fixtureContext = {
      deliveryPolicy: structuredClone(scenario.deliveryPolicy ?? {
        deliveryFee: seededPolicy?.deliveryFee ?? null,
        deliveryMinimumSubtotal: seededPolicy?.deliveryMinimumSubtotal ?? null,
      }),
      existingCustomer: seededProfile ? { name: seededProfile.name, defaultAddress: seededProfile.defaultAddress } : null,
    };
    for (let i = 0; i < scenario.maxTurns; i++) {
      const beforeEvents = new Set((await runtime.store.listEvents({ tenantId: shadow.tenantId, limit: 10000 })).map((e) => e.id));
      const beforeOutbound = graphOutbound.length;
      const messageId = `wamid.${runId}.${scenario.number}.${i + 1}`;
      const began = Date.now();
      const result = step.interactive
        ? await meta.sendInteractive({ messageId, waId, profileName: scenario.customer === 'known' ? scenario.buyer.name : '', option: step.interactive })
        : await meta.sendText({ messageId, waId, profileName: '', text: step.text ?? '', messageType: step.messageType ?? 'text', mediaRef: step.mediaRef });
      report.assertions.push(check(`turn_${i + 1}_ack`, result.body.queued === true && result.elapsedMs < 1000, result.elapsedMs, 'P1'));
      const inbound = await drain(runtime, messageId, 90000);
      if (inbound.status !== 'completed') throw new Error(`Inbound ${inbound.status}: ${inbound.lastError ?? 'unknown'}`);
      conversation = inbound.result?.conversationId ? await runtime.store.getConversation(inbound.result.conversationId) : null;
      const events = (await runtime.store.listEvents({ tenantId: shadow.tenantId, limit: 10000 })).filter((e) => !beforeEvents.has(e.id) && e.conversationId === conversation?.id);
      const outbound = graphOutbound.slice(beforeOutbound).filter((o) => o.recipientKey === waId && o.caseKey === scenario.id);
      // Match with exact case key captured in the fake Graph transport, not a
      // UI history fallback (and never a reply from an earlier turn).
      const order = conversation?.orderId ? runtime.orders.findOrder(conversation.orderId, shadow.tenantId) : null;
      const draft = structuredClone(conversation?.orderDraft ?? null);
      report.assertions.push(...checkTurn({ outbound, order, accepted, draft, catalog }).map((a) => ({ ...a, name: `turn_${i + 1}_${a.name}` })));
      report.assertions.push(...checkBasketBounds({ draft, scenario }).map((a) => ({ ...a, name: `turn_${i + 1}_${a.name}` })));
      report.steps.push({ step: i + 1, messageId, kind: step.interactive?.kind ?? step.messageType ?? 'text',
        customerMessage: step.interactive?.title ?? step.text, inbound: { status: inbound.status, attempts: inbound.attempts, completedAt: inbound.completedAt },
        conversationId: conversation?.id, plan: conversation?.reasoningPlan, orderDraft: draft, events, outbound, reply: outbound.map((m) => m.text).join('\n'),
        timing: { webhookAckMs: result.elapsedMs, workerProcessingMs: Date.now() - began,
          llm: summarizeLlm(events),
          receptionToOutboundMs: outbound.length ? Date.parse(outbound[0].at) - began : null } });
      report.dialogue.push({ turn: i + 1, customer: step.interactive?.title ?? step.text ?? '[imagen]',
        customerInteraction: step.interactive ? { kind: step.interactive.kind, id: step.interactive.id, title: step.interactive.title } : null, outbound });
      report.graphOutbound.push(...outbound);
      if (!outbound.length || order || step.final) { report.termination = !outbound.length ? 'silence' : order ? 'order_created' : 'customer_finished'; break; }
      if (i === 0 && scenario.followUp) { step = { text: scenario.followUp }; continue; }
      let decision;
      try {
        decision = await nextCustomerTurn({ scenario, dialogue: report.dialogue, products: desired });
      } catch (error) {
        report.errors.push({ message: `Evaluator actor: ${error.message}`, stage: 'customer_actor', evaluatorEvidence: error.evaluatorEvidence });
        report.termination = 'invalid_actor_protocol';
        // Keep the failure, but still inspect actual state, tasks, judge and
        // shopkeeper below. A broken buyer must not hide an integrity defect.
        break;
      }
      report.actorDecisions.push({ afterTurn: i + 1, ...decision });
      if (decision.done && !decision.interactive && !String(decision.text ?? '').trim()) { report.termination = 'customer_finished'; break; }
      if (i === scenario.maxTurns - 1) {
        report.termination = terminationAtTurnCap(decision, scenario.outcome);
        report.unsentFinalCustomerMessage = decision.text ?? null;
        break;
      }
      const consentChecks = checkConsent({ action: decision, scenario, catalog, dialogue: report.dialogue });
      report.assertions.push(...consentChecks);
      if (consentChecks.some((a) => !a.passed)) { report.actorBlocked = 'Confirmación rechazada por el oráculo; no se envió.'; report.termination = 'invalid_actor_consent'; break; }
      accepted ||= decision.act === 'confirm_order';
      step = { text: decision.text, interactive: decision.interactive, final: decision.done };
    }
    report.orderId = conversation?.orderId ?? null;
    const orders = (runtime.store.getState().ordersByTenant?.[shadow.tenantId] ?? []).filter((o) => o.waId === waId);
    const order = report.orderId ? runtime.orders.findOrder(report.orderId, shadow.tenantId) : null;
    report.databaseSnapshot = structuredClone({ conversation, order });
    const actorInterrupted = ['invalid_actor_protocol', 'invalid_actor_consent'].includes(report.termination);
    report.assertions.push(...checkOrder({ order, scenario, catalog, tenantId: shadow.tenantId, accepted, count: orders.length })
      .map(a => actorInterrupted && a.name === 'expected_business_outcome' && !order ? { ...a, severity: 'EVALUATOR' } : a));
    const terminal = ['order_created', 'customer_finished', 'customer_goal_satisfied', 'opening_exercised'].includes(report.termination);
    // A cap is not evidence that an informational answer was wrong. Keep it
    // visible for review; do not turn an unverified terminal state into a pass.
    report.assertions.push(check('conversation_reached_terminal', terminal, report.termination,
      actorInterrupted ? 'EVALUATOR' : scenario.outcome !== 'purchase' && report.termination === 'turn_budget_exhausted' || scenario.outcome === 'opening' ? 'REVIEW' : 'P1'));
    if (order) {
      const expectedPayment = scenario.buyer.payment === 'Efectivo' ? 'cash' : scenario.buyer.payment === 'Bre-B' ? 'bre_b' : 'card_terminal';
      report.assertions.push(check('payment_preference_preserved', conversation?.orderDraft?.paymentMethod === expectedPayment, conversation?.orderDraft?.paymentMethod));
    }
    if (scenario.number === 50) for (const act of ['finish_collection', 'confirm_order']) report.assertions.push(check(`context_covered_${act}`, report.actorDecisions.some((a) => a.act === act) && report.steps.some((s) => s.customerMessage === scenario.finishCollectionText), act, 'P1'));
    const pendingResponse = await fetch(`${meta.baseUrl}/api/pending-requests?tenantId=${encodeURIComponent(shadow.tenantId)}`);
    const pending = (await pendingResponse.json()).filter((p) => p.conversationId === conversation?.id);
    report.pendingRequests = pending;
    report.assertions.push(...checkHumanTaskUniqueness(pending));
    if (scenario.outcome === 'purchase' && !order && report.termination === 'customer_finished' && !pending.some((p) => p.status === 'pending')) {
      report.errors.push({ message: 'Evaluator actor: purchase stopped before confirmation without handoff' });
    }
    if (scenario.outcome === 'handoff') {
      const linked = pending.filter((p) => p.status === 'pending');
      report.assertions.push(check('human_task_with_context', linked.some((p) => p.title && p.context && conversation?.messages?.some((m) => m.role === 'customer' || m.role === 'user')), linked, 'P1'));
      if ([28, 45, 46, 49].includes(scenario.number)) report.assertions.push(check('human_snapshot_not_empty', linked.some((p) => Object.keys(p.contextSnapshot ?? {}).length > 0), linked, 'P1'));
      if (scenario.number === 49) {
        const snapshots = JSON.stringify(linked.map((p) => p.contextSnapshot));
        report.assertions.push(check('handoff_partial_cart_preserved', /choco/i.test(snapshots) && /mora/i.test(snapshots) && /3/.test(snapshots), snapshots, 'P1'));
      }
      if (scenario.number === 46) report.assertions.push(check('handoff_attachment_preserved', JSON.stringify(linked).includes(scenario.initial.mediaRef), linked, 'P1'));
    }
    if (scenario.outcome === 'payment_notice') {
      const notices = conversation?.paymentNotices ?? [];
      report.assertions.push(check('informational_payment_notice', notices.length === 1 && notices[0].informational && !notices[0].paymentVerified, notices));
      report.assertions.push(check('no_invented_receipt', notices.every(n => !n.attachment), notices));
      report.assertions.push(check('payment_does_not_block', !pending.some(p => p.status === 'pending') && !['blocked', 'approval_required'].includes(conversation?.status), pending));
      report.assertions.push(check('payment_does_not_create_order', !order, order));
    }
    const duplicate = await meta.sendText({ messageId: `wamid.${runId}.${scenario.number}.1`, waId, text: scenario.initial.text ?? '' });
    report.assertions.push(check('deduplication', duplicate.body.duplicate === true && duplicate.body.queued === false, duplicate.body));
    try {
      report.semanticReview = await judgeConversation({ scenario, dialogue: report.dialogue, catalog, fixtureContext: report.fixtureContext });
      report.assertions.push(...checkPublicClaims({ verdict: report.semanticReview, scenario,
        dialogue: report.dialogue.map((d, i) => ({ ...d, draft: report.steps[i].orderDraft })), catalog }));
    } catch (error) {
      report.errors.push({ message: `Evaluator judge: ${error.message}`, stage: 'semantic_judge', evaluatorEvidence: error.evaluatorEvidence });
      // A judge defect must not prevent testing the real shopkeeper workflow.
    }
    if (order && scenario.outcome === 'purchase') {
      report.shopkeeper = await shopkeeper({ baseUrl: meta.baseUrl, meta, runtime, shadow, orderId: order.id, caseId });
      report.assertions.push(...report.shopkeeper.assertions);
      if (report.shopkeeper.errors.length) report.errors.push(...report.shopkeeper.errors);
    }
    report.outbox = (await runtime.store.listOutbox({ limit: 1000 })).filter((e) => e.tenantId === shadow.tenantId && [conversation?.id, order?.id].includes(e.aggregateId))
      .map(({ id, kind, status, attempts, lastError }) => ({ id, kind, status, attempts, lastError }));
  } catch (error) { report.errors.push({ message: error.message, evaluatorEvidence: error.evaluatorEvidence,
    stack: error.stack?.split('\n').slice(0, 4).join('\n') }); }
  report.durationMs = Date.now() - start;
  report.finishedAt = new Date().toISOString();
  report.failureAxes = {
    integrity: report.assertions.some(a => !a.passed && a.severity === 'P0' && !a.name.startsWith('confirmation_')),
    functional: report.assertions.some(a => !a.passed && a.severity === 'P1'),
    evaluation: report.actorBlocked != null || report.errors.some(e => /Evaluator|Oracle/i.test(e.message)) || report.assertions.some(a => !a.passed && a.severity === 'EVALUATOR'),
    review: report.assertions.some(a => !a.passed && a.severity === 'REVIEW'),
    degraded: report.steps.some(s => s.events.some(e => ['llm.plan.fallback', 'llm.reply.fallback'].includes(e.type))),
  };
  if (report.assertions.some((a) => !a.passed && a.severity === 'P0' && !a.name.startsWith('confirmation_'))) report.status = 'failed_integrity';
  else if (report.steps.some((s) => !s.outbound.length)) report.status = 'failed_functional';
  else if (report.actorBlocked) report.status = 'evaluator_error';
  else if (report.errors.length) report.status = report.errors.some((e) => /Evaluator|Oracle/i.test(e.message)) ? 'evaluator_error' : 'infra_error';
  else if (report.steps.some((s) => s.events.some((e) => ['llm.plan.fallback', 'llm.reply.fallback'].includes(e.type)))) report.status = 'integration_fallback';
  else if (report.assertions.some((a) => !a.passed && ['EVALUATOR', 'REVIEW'].includes(a.severity))) report.status = 'needs_review';
  else if (report.assertions.some((a) => !a.passed)) report.status = 'failed_functional';
  else if (report.semanticReview?.verdict !== 'pass') report.status = 'needs_review';
  return report;
}
