// Inspect frozen case reports without changing verdicts or running the agent.
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const selected = new Set((process.argv[3] ?? '').split(',').filter(Boolean).map(Number));
const verbose = process.argv.includes('--verbose');
for (const name of (await fs.readdir(path.join(root, 'cases')).catch(() => [])).sort()) {
  if (selected.size && !selected.has(Number(name.slice(0, 2)))) continue;
  const c = await fs.readFile(path.join(root, 'cases', name, 'case-report.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!c) continue;
  if (process.argv.includes('--brief')) {
    console.log(JSON.stringify({ case:c.caseId,status:c.status,turns:c.steps.map(s=>({
      turn:s.step,customer:s.customerMessage,reply:s.reply,ms:s.timing.receptionToOutboundMs,
      buttons:s.outbound.flatMap(o=>o.interactive?.action?.buttons?.map(b=>b.reply?.title)??o.interactive?.action?.sections?.flatMap(x=>x.rows?.map(r=>r.title)??[])??[]),
      audit:s.events.filter(e=>e.type.startsWith('order.data.audit.')).map(e=>({verdict:e.type,reason:e.detail})),
      incidents:s.events.filter(e=>/fallback|rejected|contract_repair|agent.failed/.test(e.type)&&e.type!=='fallback.activated').map(e=>({type:e.type,reason:e.detail})),
      delivery:s.orderDraft?.delivery,total:s.orderDraft?.pricing?.total,
    })),review:c.semanticReview?.issues,errors:c.errors.map(e=>e.message)},null,2));
    continue;
  }
  console.log(JSON.stringify({ case: c.caseId, status: c.status, termination: c.termination,
    failed: c.assertions.filter(a => !a.passed).map(a => verbose ? a : ({ name:a.name, severity:a.severity,
      detail:a.name === 'semantic_conversation' ? 'See semanticReview' : a.detail })),
    errors: verbose ? c.errors : c.errors.map(e => ({ message:e.message, stage:e.stage })),
    turns: c.steps.map(s => ({ turn: s.step, customer: s.customerMessage, reply: s.reply,
      ms: s.timing.receptionToOutboundMs == null ? null : s.timing.receptionToOutboundMs
        + Date.parse(s.outbound.at(-1).at) - Date.parse(s.outbound[0].at),
      buttons: s.outbound.flatMap(o => o.interactive?.action?.buttons?.map(b => b.reply?.title) ??
        o.interactive?.action?.sections?.flatMap(x => x.rows?.map(r => r.title) ?? []) ?? []),
      draft: s.orderDraft && { delivery: s.orderDraft.delivery, payment: s.orderDraft.paymentMethod,
        missing: s.orderDraft.missingFields, pricing: verbose ? s.orderDraft.pricing : {
          status:s.orderDraft.pricing?.status, subtotal:s.orderDraft.pricing?.subtotal,
          fee:s.orderDraft.pricing?.deliveryFee, total:s.orderDraft.pricing?.total },
        items: s.orderDraft.items?.map(i => ({ rawName: i.rawName, sku: i.product?.sku,
          quantity: i.quantity, amount: i.requestedAmount, status: i.resolution?.status })) },
      audits: s.events.filter(e => e.type.startsWith('order.data.audit.')).map(e => ({ type:e.type, reason:e.detail,
        ms:e.metadata?.durationMs, corrections:e.metadata?.corrections, ...(verbose ? { data:e.metadata } : {}) })),
      incidents: s.events.filter(e => /fallback|rejected|contract_repair|agent.failed/.test(e.type))
        .map(e => ({ type:e.type, detail:e.detail, data:e.metadata })),
    })), order: c.databaseSnapshot?.order && { id:c.orderId, total:c.databaseSnapshot.order.total,
      delivery:c.databaseSnapshot.order.delivery, pricing:c.databaseSnapshot.order.pricing },
    semanticReview: c.semanticReview && { verdict:c.semanticReview.verdict, issues:c.semanticReview.issues,
      missingNeeds:c.semanticReview.missingNeeds, summary:c.semanticReview.summary,
      protocolErrors:c.semanticReview.protocolRepair?.errors },
  }, null, 2));
}
