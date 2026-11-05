// Read-only analysis of one frozen campaign; does not change raw verdicts.
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2] ?? '');
const read = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const folders = (await fs.readdir(path.join(root, 'cases'))).sort();
const cases = await Promise.all(folders.map(n => read(`cases/${n}/case-report.json`)));
export function stats(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  const p = f => a.length ? a[Math.max(0, Math.ceil(a.length * f) - 1)] : null;
  return { n: a.length, mean: a.length ? Math.round(a.reduce((x,y)=>x+y,0) / a.length) : null,
    p50: p(.5), p95: p(.95), max: a.at(-1) ?? null, over5000: a.filter(x=>x>5000).length, over8000: a.filter(x=>x>8000).length };
}
const steps = cases.flatMap(c => c.steps.map(s => ({ ...s, caseId: c.caseId })));
const auditEvents = steps.flatMap(s => s.events.filter(e=>e.type.startsWith('order.data.audit.'))
  .map(e=>({ caseId:s.caseId, turn:s.step, event:e.type, reason:e.detail, ...e.metadata })));
const hasAudit = s => s.events.some(e=>e.type.startsWith('order.data.audit.'));
const countBy = (a, fn) => Object.fromEntries([...new Set(a.map(fn))].map(k => [k,a.filter(x=>fn(x)===k).length]));
const stageNames = ['planner','grounding','composer','composer_evidence_review'];
const stages = Object.fromEntries(stageNames.map(stage => {
  const rows=steps.flatMap(s=>(s.timing?.llm??[]).filter(l=>l.stage===stage));
  return [stage,{...stats(rows.map(r=>r.durationMs)),inputTokens:rows.reduce((n,r)=>n+(r.usage?.prompt_tokens??0),0),
    outputTokens:rows.reduce((n,r)=>n+(r.usage?.completion_tokens??0),0)}];
}));
stages.auditor = stats(auditEvents.map(e=>e.durationMs));
const latencyRows = steps.map(s => {
  const first=s.outbound[0], last=s.outbound.at(-1);
  const start=first ? Date.parse(first.at)-s.timing.receptionToOutboundMs : null;
  const agent=s.events.find(e=>e.type==='agent.started');
  return {caseId:s.caseId,turn:s.step,audited:hasAudit(s),ackMs:s.timing.webhookAckMs,
    firstOutboundMs:s.timing.receptionToOutboundMs,
    lastOutboundMs:first ? Date.parse(last.at)-start : null,
    beforeAgentMs:start!=null&&agent ? Date.parse(agent.at)-start : null,
    agentToOutboundMs:agent&&first ? Date.parse(first.at)-Date.parse(agent.at) : null,
    observedLlmCalls:(s.timing.llm??[]).length+s.events.filter(e=>e.type.startsWith('order.data.audit.')).length,
    knownLlmMs:(s.timing.llm??[]).reduce((n,l)=>n+(l.durationMs??0),0)+s.events.filter(e=>e.type.startsWith('order.data.audit.')).reduce((n,e)=>n+(e.metadata.durationMs??0),0)};
});
const summary = await read('summary.json').catch(()=>null);
const evidence = {run:path.relative(process.cwd(),root).replaceAll('\\','/'),complete:!!summary,generatedAt:new Date().toISOString(),
  cases:cases.length,byStatus:countBy(cases,c=>c.status),turns:steps.length,
  orders:cases.filter(c=>c.orderId).length,shopkeeperPassed:cases.filter(c=>c.shopkeeper?.status==='passed').length,
  audit:{calls:auditEvents.length,byVerdict:countBy(auditEvents,e=>e.event),cases:[...new Set(auditEvents.map(e=>e.caseId))].length,
    ordersWithAuditStamp:cases.filter(c=>c.orderId&&c.databaseSnapshot?.conversation?.orderDraft?.dataAudit?.revision).length,
    repeatedRevisions:auditEvents.length-new Set(auditEvents.map(e=>`${e.caseId}:${e.revision}`)).size,
    missingFieldsAfterAudit:auditEvents.filter(e=>(cases.find(c=>c.caseId===e.caseId).steps.find(s=>s.step===e.turn).orderDraft?.missingFields??[]).length>0).length,
    beforeCollectionComplete:auditEvents.filter(e=>cases.find(c=>c.caseId===e.caseId).steps.find(s=>s.step===e.turn).plan?.semanticFrame?.collectionComplete!==true).length,
    events:auditEvents},
  latency:{turnsWithoutOutbound:latencyRows.filter(r=>r.lastOutboundMs==null).length,
    byObservedCallCount:Object.fromEntries([...new Set(latencyRows.map(r=>r.observedLlmCalls))].sort((a,b)=>a-b).map(n=>[n,stats(latencyRows.filter(r=>r.observedLlmCalls===n).map(r=>r.lastOutboundMs))])),
    ack:stats(latencyRows.map(r=>r.ackMs)),firstOutbound:stats(latencyRows.map(r=>r.firstOutboundMs)),
    lastOutbound:stats(latencyRows.map(r=>r.lastOutboundMs)),beforeAgent:stats(latencyRows.map(r=>r.beforeAgentMs)),
    agentToOutbound:stats(latencyRows.map(r=>r.agentToOutboundMs)),
    withAudit:stats(latencyRows.filter(r=>r.audited).map(r=>r.lastOutboundMs)),
    withoutAudit:stats(latencyRows.filter(r=>!r.audited).map(r=>r.lastOutboundMs)),
    stages,slowest:latencyRows.filter(r=>r.lastOutboundMs!=null).sort((a,b)=>b.lastOutboundMs-a.lastOutboundMs).slice(0,10),rows:latencyRows},
  sourceUnchanged:summary?.acceptance.sourceUnchanged,providerUsage:summary?.providerUsage,
  technicalIncidents:steps.flatMap(s=>s.events.filter(e=>/fallback|rejected|agent.failed|contract_repair|classification_failed/.test(e.type))
    .map(e=>({caseId:s.caseId,turn:s.step,type:e.type,detail:e.detail,metadata:e.metadata}))),
  failures:cases.filter(c=>c.status!=='passed').map(c=>({caseId:c.caseId,status:c.status,axes:c.failureAxes,
    termination:c.termination,assertions:c.assertions.filter(a=>!a.passed),errors:c.errors,semanticReview:c.semanticReview,
    fallbacks:c.steps.flatMap(s=>s.events.filter(e=>/fallback|rejected|agent.failed/.test(e.type)).map(e=>({turn:s.step,type:e.type,detail:e.detail,metadata:e.metadata}))),
    dialogue:c.steps.map(s=>({turn:s.step,customer:s.customerMessage,reply:s.reply}))})),
  caseTable:cases.map(c=>({caseId:c.caseId,status:c.status,turns:c.steps.length,orderId:c.orderId,
    audits:auditEvents.filter(e=>e.caseId===c.caseId).length,
    latency:stats(latencyRows.filter(r=>r.caseId===c.caseId).map(r=>r.lastOutboundMs)),
    pendingHuman:c.pendingRequests?.filter(p=>p.status==='pending').length??0,
    degraded:c.failureAxes?.degraded??false,assertionsFailed:c.assertions.filter(a=>!a.passed).length}))};
await fs.writeFile(path.join(root,'audit-analysis.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({complete:evidence.complete,cases:evidence.cases,byStatus:evidence.byStatus,turns:evidence.turns,
  auditCalls:evidence.audit.calls,auditVerdicts:evidence.audit.byVerdict,latency:evidence.latency.lastOutbound,
  failed:evidence.failures.map(c=>({id:c.caseId,status:c.status,assertions:c.assertions.map(a=>a.name),errors:c.errors.map(e=>e.message)}))},null,2));
