import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { judgeConversation } from '../../server/tests/helpers/contextualCustomerActor.js';
import { checkPublicClaims, checkBasketBounds, checkHumanTaskUniqueness } from '../../server/tests/helpers/businessOutcomeAssertions.js';
import { contextualAcceptanceScenarios } from '../../server/tests/fixtures/contextualAcceptanceScenarios.js';

// Re-evaluate immutable observed conversations; do not rerun or rewrite VIA.
// Saved separately so a change of oracle is never disguised as a new E2E run.
if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY required');
const runs = process.argv.slice(2).map((p) => path.resolve(p));
if (!runs.length) throw new Error('Supply completed E2E directories');
const originalFetch = global.fetch;
const origin = new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').origin;
const usage = [];
const scope = new AsyncLocalStorage();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const evaluatorHash = hash(await fs.readFile(new URL('../../server/tests/helpers/businessOutcomeAssertions.js', import.meta.url), 'utf8')
  + await fs.readFile(new URL('../../server/tests/helpers/contextualCustomerActor.js', import.meta.url), 'utf8'));
global.fetch = async (url, options) => {
  if (new URL(url).origin !== origin) throw new Error('Only DeepSeek may leave the evidence audit');
  if (usage.length >= 140) throw new Error('Audit request budget exhausted');
  const headers = new Headers(options.headers); headers.delete('x-e2e-role');
  const trace = { index: usage.length + 1, ...scope.getStore(), usage: null }; usage.push(trace);
  const started = Date.now();
  try {
    const response = await originalFetch(url, { ...options, headers });
    const data = await response.clone().json(); trace.status = response.status; trace.usage = data.usage ?? null; trace.id = data.id ?? null;
    return response;
  } catch (error) { trace.error = error.message; throw error; }
  finally { trace.durationMs = Date.now() - started; }
};
try {
  for (const run of runs) {
    const manifest = JSON.parse(await fs.readFile(path.join(run, 'run-manifest.json'), 'utf8'));
    const usageStart = usage.length;
    const names = (await fs.readdir(path.join(run, 'cases'))).sort();
    const target = path.join(run, 'evaluation-v2.1'); await fs.mkdir(target);
    const reports = []; let index = 0;
    const work = async () => {
      while (index < names.length) {
        const name = names[index++];
        const sourceText = await fs.readFile(path.join(run, 'cases', name, 'case-report.json'), 'utf8');
        const original = JSON.parse(sourceText);
        const scenario = contextualAcceptanceScenarios.find((s) => s.id === original.scenarioId);
        const catalog = [...new Map([...manifest.shadow.baseCatalog, ...scenario.extraProducts].map((p) => [p.sku, p])).values()];
        const report = { caseId: original.caseId, originalStatus: original.status, sourceSha256: hash(sourceText), evaluatorHash,
          status: 'needs_review', assertions: [], errors: [], flags: [] };
        report.assertions = [
          ...original.assertions.filter((a) => !/^(public_|judge_turn_|judge_issue_|semantic_|budget_|payment_claim_requires_review_|payment_not_falsely_verified_)/.test(a.name)),
          ...original.steps.flatMap((s) => checkBasketBounds({ draft: s.orderDraft, scenario }).map((a) => ({ ...a, name: `turn_${s.step}_${a.name}` }))),
          ...checkHumanTaskUniqueness(original.pendingRequests),
        ];
        if (scenario.outcome === 'opening') report.assertions = report.assertions.map((a) => a.name === 'conversation_reached_terminal' ? { ...a, severity: 'REVIEW' } : a);
        try {
          report.verdict = await scope.run({ runId: manifest.runId, caseId: name }, () => judgeConversation({ scenario, dialogue: original.dialogue, catalog, fixtureContext: original.fixtureContext ?? null }));
          report.assertions.push(...checkPublicClaims({ verdict: report.verdict, scenario, catalog,
            dialogue: original.dialogue.map((d, i) => ({ ...d, draft: original.steps[i].orderDraft })) }));
        } catch (error) { report.errors.push(error.message); }
          if (original.actorBlocked) report.flags.push('invalid_actor_consent');
          if (original.errors.length || report.errors.length) report.flags.push('evaluation_or_run_error');
          if (original.steps.some((s) => s.events?.some((e) => e.type === 'llm.plan.fallback'))) report.flags.push('integration_fallback');
          if (original.steps.some((s) => !s.outbound.length)) report.flags.push('application_silence');
          if (scenario.outcome === 'purchase' && !original.orderId && original.termination === 'customer_finished'
            && !original.pendingRequests?.some((p) => p.status === 'pending')) report.flags.push('incomplete_actor');
          // A rejected synthetic consent was never emitted to VIA. Preserve it as
          // a harness failure, not as a commercially incorrect persisted order.
          const integrity = report.assertions.some((a) => !a.passed && a.severity === 'P0' && !a.name.startsWith('confirmation_'));
          if (integrity) report.status = 'failed_integrity';
          else if (report.flags.includes('application_silence')) report.status = 'failed_functional';
          else if (original.actorBlocked) report.status = 'evaluator_error';
          else if (report.flags.includes('integration_fallback')) report.status = 'integration_fallback';
          else if (report.errors.length) report.status = 'evaluator_error';
          else if (original.errors.length) report.status = original.status;
          else if (report.flags.includes('incomplete_actor')) report.status = 'incomplete_actor';
          else if (report.assertions.some((a) => !a.passed && ['EVALUATOR', 'REVIEW'].includes(a.severity))) report.status = 'needs_review';
          else report.status = report.assertions.every((a) => a.passed) ? 'passed' : 'failed_functional';
        await fs.writeFile(path.join(target, `${name}.json`), JSON.stringify(report, null, 2)); reports.push(report);
        console.log(`Audit ${scenario.number}: ${report.status}`);
      }
    };
    await Promise.all([work(), work(), work()]);
    await fs.writeFile(path.join(target, 'summary.json'), JSON.stringify({ sourceRun: manifest.runId, evaluationVersion: '2.1',
      productionReplayed: false, catalogFields: 'all', evaluatorHash, generatedAt: new Date().toISOString(),
      counts: Object.fromEntries(Object.entries(Object.groupBy(reports, (r) => r.status)).map(([key, value]) => [key, value.length])),
      cases: reports.sort((a, b) => a.caseId.localeCompare(b.caseId)).map(({ caseId, originalStatus, status }) => ({ caseId, originalStatus, status })) }, null, 2));
    await fs.writeFile(path.join(target, 'judge-provider-requests.json'), JSON.stringify(usage.slice(usageStart), null, 2));
  }
} finally { global.fetch = originalFetch; }
