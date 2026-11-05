import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Explicit evidence directories: never search until finding a passing run.
const directories = process.argv.slice(2).map(directory => path.resolve(directory));
assert.equal(directories.length, 3, 'Supply the three final language-variant runs');
const runs = await Promise.all(directories.map(async directory => ({ directory,
  data: JSON.parse(await fs.readFile(path.join(directory, 'report.json'), 'utf8')) })));
assert.deepEqual(runs.map(r => r.data.reports[0].languageVariant).sort(), [1, 2, 3]);
const hashes = runs[0].data.startHashes;
for (const run of runs) {
  assert.equal(run.data.reports.length, 5, 'Five complete business scenarios per variant');
  assert.deepEqual(run.data.startHashes, hashes);
  assert.deepEqual(run.data.endHashes, hashes, 'Incomplete run or code changed while testing');
}
for (const [file, hash] of Object.entries(hashes)) {
  assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash, `Evidence predates ${file}`);
}
const cases = runs.flatMap(({ directory, data }) => data.reports.map(report => ({
  id: report.id, variant: report.languageVariant, status: report.status, turns: report.turns.length,
  failures: report.failures, evidence: path.relative(process.cwd(), path.join(directory, 'report.json')),
})));
const turns = runs.flatMap(r => r.data.reports.flatMap(c => c.turns));
const timings = turns.map(t => t.durationMs).sort((a, b) => a - b);
const percentile = p => timings[Math.max(0, Math.ceil(timings.length * p) - 1)] ?? null;
const calls = runs.flatMap(r => r.data.calls);
const report = {
  generatedAt: new Date().toISOString(), scope: 'Real DeepSeek; local runtime, simulated Meta/Google; PostgreSQL validated separately',
  sourceHashes: hashes, cases, total: cases.length, passed: cases.filter(c => c.status === 'passed').length,
  turns: turns.length, customerTurns: turns.filter(t => !t.human).length, humanTurns: turns.filter(t => t.human).length,
  turnLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), max: timings.at(-1) },
  usage: { requests: calls.length, withUsage: calls.filter(c => c.usage).length,
    inputTokens: calls.reduce((n, c) => n + (c.usage?.prompt_tokens ?? 0), 0),
    outputTokens: calls.reduce((n, c) => n + (c.usage?.completion_tokens ?? 0), 0),
    totalTokens: calls.reduce((n, c) => n + (c.usage?.total_tokens ?? 0), 0) },
};
const output = path.resolve('test-results/delivery-commerce/final-summary');
await fs.writeFile(`${output}.json`, JSON.stringify(report, null, 2));
await fs.writeFile(`${output}.md`, [
  '# Validación local de condiciones de domicilio', '',
  `${report.passed}/${report.total} casos aprobados; ${report.customerTurns} turnos de comprador y ${report.humanTurns} de tendero.`,
  'DeepSeek real. Meta y Google simulados. No se enviaron mensajes reales. Misma huella de los ocho componentes de producción en las tres campañas y al generar este informe.', '',
  '| Caso | Variante | Resultado | Turnos | Evidencia |', '|---|---:|---|---:|---|',
  ...cases.map(c => `| ${c.id} | ${c.variant} | ${c.status} | ${c.turns} | [JSON](${path.relative(path.dirname(output), path.resolve(c.evidence)).replaceAll('\\', '/')}) |`), '',
  `Latencia local por turno: p50 ${report.turnLatencyMs.p50} ms; p95 ${report.turnLatencyMs.p95} ms. No constituye un SLA de producción.`,
  `DeepSeek de VIA: ${report.usage.requests} llamadas; ${report.usage.inputTokens} tokens de entrada; ${report.usage.outputTokens} de salida.`,
  'Estos escenarios dirigidos no sustituyen la campaña contextual de 50 casos ni borran sus fallos.', '',
].join('\n'));
console.log(JSON.stringify({ total: report.total, passed: report.passed, turns: report.turns, turnLatencyMs: report.turnLatencyMs, usage: report.usage }, null, 2));
