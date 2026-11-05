import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(process.argv[2] ?? 'test-results/delivery-full50');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const entries = await fs.readdir(root, { withFileTypes: true });
const batches = [];
for (const entry of entries.filter(e => e.isDirectory() && e.name.startsWith('batch-'))) {
  const batch = path.join(root, entry.name);
  const runs = (await fs.readdir(batch, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort();
  const run = path.join(batch, runs.at(-1));
  const [summary, manifest, source] = await Promise.all(['summary.json', 'run-manifest.json', 'baseline-source.json'].map(name => read(path.join(run, name))));
  const cases = [];
  for (const c of summary.cases) cases.push(await read(path.join(run, 'cases', c.caseId, 'case-report.json')));
  batches.push({ path: run, summary, manifest, source, cases });
}
assert.equal(batches.length, 4, 'All four completed batches are required');
const cases = batches.flatMap(b => b.cases).sort((a, b) => a.caseId.localeCompare(b.caseId));
assert.equal(cases.length, 50, 'Do not report a partial run as the 50-case campaign');
assert.equal(new Set(cases.map(c => c.caseId)).size, 50, 'No duplicate scenarios');
assert.equal(new Set(batches.map(b => b.manifest.sourceSha256)).size, 1, 'Batch source code must match');
const percentile = (values, p = 0.95) => {
  const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.max(0, Math.ceil(v.length * p) - 1)] : null;
};
const steps = cases.flatMap(c => c.steps ?? []);
const byStatus = Object.fromEntries(Object.entries(Object.groupBy(cases, c => c.status)).map(([status, list]) => [status, list.length]));
const providerUsage = {};
for (const role of ['application', 'customer_actor', 'semantic_judge']) {
  providerUsage[role] = Object.fromEntries(['requests', 'withUsage', 'unreported', 'inputTokens', 'outputTokens', 'totalTokens'].map(key =>
    [key, batches.reduce((sum, b) => sum + (b.summary.providerUsage?.[role]?.[key] ?? 0), 0)]));
}
const failed = c => (c.assertions ?? []).filter(a => !a.passed);
const timing = (extract, p = 0.95) => percentile(steps.flatMap(extract), p);
const report = {
  generatedAt: new Date().toISOString(),
  scope: '50 contextual scenarios in four independent local PostgreSQL clones; no production delivery',
  batches: batches.map(b => ({ path: path.relative(process.cwd(), b.path), runId: b.manifest.runId, sourceSha256: b.manifest.sourceSha256,
    sourceUnchanged: b.source.unchanged, acceptance: b.summary.acceptance })),
  total: cases.length, turns: steps.length, byStatus, providerUsage,
  sourceUnchanged: batches.every(b => b.source.unchanged),
  blockedNetwork: batches.reduce((sum, b) => sum + b.summary.counts.blockedNetwork, 0),
  timings: {
    webhookAckP50Ms: timing(s => [s.timing?.webhookAckMs], 0.5),
    webhookAckP95Ms: timing(s => [s.timing?.webhookAckMs]),
    workerP50Ms: timing(s => [s.timing?.workerProcessingMs], 0.5),
    workerP95Ms: timing(s => [s.timing?.workerProcessingMs]),
    ...Object.fromEntries(['planner', 'grounding', 'composer'].map(stage => [`${stage}P95Ms`, timing(s => (s.timing?.llm ?? []).filter(l => l.stage === stage).map(l => l.durationMs))])),
  },
  cases: cases.map(c => ({ caseId: c.caseId, status: c.status, turns: c.steps.length, durationMs: c.durationMs,
    failedAssertions: failed(c).map(a => ({ name: a.name, severity: a.severity, detail: a.detail })), errors: c.errors,
    evidence: path.relative(process.cwd(), path.join(batches.find(b => b.cases.some(item => item.caseId === c.caseId)).path, 'cases', c.caseId, 'case-report.md')) })),
};
const baselineFile = path.resolve('test-results/cart-continuity-full50/20261104193454_396f8b87/summary.json');
try {
  const baseline = await read(baselineFile);
  report.previousRun = { path: path.relative(process.cwd(), baselineFile), counts: baseline.counts, timings: baseline.timings, providerUsage: baseline.providerUsage,
    note: 'Different LLM executions and concurrency; compare evidence, not only aggregate pass counts.' };
} catch {}
await fs.writeFile(path.join(root, 'consolidated.json'), JSON.stringify(report, null, 2));
const md = [
  '# Regresión contextual local de 50 escenarios', '',
  `Generado: ${report.generatedAt}. Casos: ${report.total}; turnos: ${report.turns}.`,
  `Base de origen intacta en las cuatro campañas: ${report.sourceUnchanged}. Intentos de red bloqueados: ${report.blockedNetwork}.`,
  'Los cuatro grupos tienen el mismo hash de fuentes. La ejecución concurrente local no mide la capacidad ni la latencia de producción.', '',
  '| Estado | Casos |', '|---|---:|', ...Object.entries(byStatus).map(([key, count]) => `| ${key} | ${count} |`), '',
  '| Uso DeepSeek | Solicitudes | Entrada | Salida | Total de tokens |', '|---|---:|---:|---:|---:|',
  ...Object.entries(providerUsage).map(([role, u]) => `| ${role} | ${u.requests} | ${u.inputTokens} | ${u.outputTokens} | ${u.totalTokens} |`), '',
  'No confundir tokens de VIA con los del comprador/juez de pruebas.', '',
  '| Caso | Estado | Turnos | Aserciones incumplidas |', '|---|---|---:|---|',
  ...report.cases.map(c => `| [${c.caseId}](${path.relative(root, path.resolve(c.evidence)).replaceAll('\\', '/')}) | ${c.status} | ${c.turns} | ${c.failedAssertions.map(a => a.name).join(', ') || (c.errors?.length ? 'Error: ver evidencia' : '—')} |`), '',
  'Este informe conserva los estados del oráculo; needs_review y evaluator_error no se cuentan como aprobados. Las causas y decisiones de corrección se documentan en el informe de implementación.', '',
];
await fs.writeFile(path.join(root, 'consolidated.md'), md.join('\n'));
console.log(JSON.stringify({ total: report.total, turns: report.turns, byStatus, sourceUnchanged: report.sourceUnchanged, timings: report.timings, providerUsage }, null, 2));
