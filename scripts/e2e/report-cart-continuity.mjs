import fs from 'node:fs/promises';
import path from 'node:path';
import { checkBasketBounds } from '../../server/tests/helpers/businessOutcomeAssertions.js';
import { contextualAcceptanceScenarios } from '../../server/tests/fixtures/contextualAcceptanceScenarios.js';

// Independent read-only comparison. Raw run reports and judge verdicts remain
// immutable; business invariants and the global judgement are reported apart.
const [beforeArg, afterArg, finalArg] = process.argv.slice(2);
if (!beforeArg || !afterArg) throw Error('Usage: node scripts/e2e/report-cart-continuity.mjs <before-run> <after-run>');
async function load(dir) {
  const root = path.resolve(dir);
  const summary = JSON.parse(await fs.readFile(path.join(root, 'summary.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'run-manifest.json'), 'utf8'));
  const cases = await Promise.all((await fs.readdir(path.join(root, 'cases'))).sort().map(async folder => {
    const report = JSON.parse(await fs.readFile(path.join(root, 'cases', folder, 'case-report.json'), 'utf8'));
    const scenario = contextualAcceptanceScenarios.find(s => s.id === report.scenarioId);
    const overflow = report.steps.filter(s => checkBasketBounds({ draft: s.orderDraft, scenario }).some(a => !a.passed));
    const premature = report.steps.filter(s => s.outbound.some(o => (o.interactive?.action?.buttons ?? []).some(b => b.reply?.title === 'Confirmar pedido'))
      && (!(s.orderDraft?.items?.length) || s.orderDraft.items.some(i => !i.product?.sku || i.resolution?.status !== 'resolved' || (!(i.quantity > 0) && !(i.budgetAmount > 0)))));
    return { report, overflow, premature, repairs: report.steps.flatMap(s => s.events).filter(e => e.type === 'llm.cart_identity.repair').length };
  }));
  return { root, summary, manifest, cases };
}
const [before, after] = await Promise.all([load(beforeArg), load(afterArg)]);
const totals = run => ({ cases: run.cases.length, turns: run.cases.reduce((n,c) => n+c.report.steps.length,0),
  overflow: run.cases.filter(c=>c.overflow.length).length, premature: run.cases.filter(c=>c.premature.length).length,
  orders: run.cases.filter(c=>c.report.orderId).length, tendero: run.cases.filter(c=>c.report.shopkeeper?.status==='passed').length,
  silence: run.cases.filter(c=>c.report.steps.some(s=>!s.outbound.length)).length,
  repair: run.cases.reduce((n,c)=>n+c.repairs,0) });
const b=totals(before), a=totals(after);
const final = finalArg ? await load(finalArg) : null;
const relative = root => path.relative(path.resolve('docs'),root).replaceAll('\\','/');
const lines = ['# Resultado local: continuidad de canasta — 2026-11-04','',
  'DeepSeek real, catálogo de 300 productos, webhook firmado y Graph simulado sobre clones PostgreSQL locales. No hubo despliegue. Los actores son adaptativos: se compara el mismo corpus, no una reproducción idéntica de cada frase. Las expectativas comerciales no se redujeron para obtener aprobaciones.','',
  `Antes: [${before.manifest.runId}](${relative(before.root)}/summary.md). Después: [${after.manifest.runId}](${relative(after.root)}/summary.md).`,'',
  '| Medida | Antes | Después |','|---|---:|---:|',
  ...[['Casos','cases'],['Turnos','turns'],['Casos con cantidades/importes superiores a la canasta del comprador','overflow'],['Casos con botón Confirmar pedido y producto pendiente','premature'],['Pedidos persistidos','orders'],['Flujos del tendero aprobados','tendero'],['Casos con silencio','silence'],['Reparaciones del contrato de identidad','repair']].map(([label,key])=>`| ${label} | ${b[key]} | ${a[key]} |`),'',
  'La medida de confirmación anterior inspecciona botones efectivamente enviados y el borrador del mismo turno; no pretende detectar todas las frases de confirmación posibles. Las cantidades incluyen todos los borradores intermedios, no solo el pedido final.','',
  '## Resultado completo del evaluador','',
  '| Clasificación automática | Casos |','|---|---:|',
  ...Object.entries(Object.groupBy(after.cases,c=>c.report.status)).map(([status,cases])=>`| ${status} | ${cases.length} |`),'',
  'Una clasificación needs_review/evaluator_error no certifica éxito ni demuestra por sí sola un fallo de VIA. Las citas, diálogos y aserciones quedan disponibles. Los fallos ajenos a estas dos correcciones no se descartan.','',
  '## Detalle por caso','',
  '| Caso | Excesos antes → después (turnos) | Confirmación incompleta después | Pedido / tendero | Resultado global |','|---|---:|---:|---|---|',
  ...after.cases.map(c=> { const old=before.cases.find(p=>p.report.caseId===c.report.caseId); return `| [${c.report.caseId}](${relative(after.root)}/cases/${c.report.caseId}/case-report.md) | ${old?.overflow.length??'—'} → ${c.overflow.length} | ${c.premature.length} | ${c.report.orderId?'Sí':'No'} / ${c.report.shopkeeper?.status??'No ejecutado'} | ${c.report.status} |`; }), '',
  '## Consumo, latencia y aislamiento','',
  '| Rol | Solicitudes y tokens reales |','|---|---|',
  ...Object.entries(after.summary.providerUsage??{}).map(([role,usage])=>`| ${role} | ${JSON.stringify(usage)} |`),'',
  `Mediciones locales: ${JSON.stringify(after.summary.timings)}. No constituyen una prueba de capacidad o latencia de WhatsApp real.`, '',
  `Huella PostgreSQL fuente sin cambios: **${after.summary.acceptance.sourceUnchanged}**. Salidas no autorizadas: **${after.summary.counts.blockedNetwork}**.`, '',
  `Hash de fuentes probadas: ${after.manifest.sourceSha256}. Catálogo idéntico a la referencia anterior: ${after.manifest.catalogSha256===before.manifest.catalogSha256}.`, '',
  '## Alcance de la conclusión','',
  `Se observaron ${a.overflow} casos con excesos de canasta y ${a.premature} con botón de confirmación incompleta en esta corrida. Estos resultados se complementan con las regresiones de contrato y no reemplazan repeticiones críticas, concurrencia, UI o Sheets real.`, '',
  'Los problemas de unidad frente a paquete, consultas intercaladas de precios/flete, escalamiento duplicado y silencios se revisan separadamente. El flag de grounding conserva su valor predeterminado deshabilitado. No se declara preparada la liberación por corregir dos defectos.','',
  ...(final ? ['## Repetición focalizada de la versión final','',
    'La campaña de 50 casos detectó una regresión de selección: el título abreviado del botón volvía al intérprete y reabría la variante. Después se corrigió para conservar la elección validada, consultar el SKU actual y pedir al resolutor LLM la continuación. No se atribuye esa corrección posterior a la campaña anterior.', '',
    `Ejecución final: [${final.manifest.runId}](${relative(final.root)}/summary.md). Hash: ${final.manifest.sourceSha256}.`, '',
    '| Caso | Turnos | Excesos de canasta | Confirmación incompleta | Pedido / tendero | Resultado global |',
    '|---|---:|---:|---:|---|---|',
    ...final.cases.map(c=>`| [${c.report.caseId}](${relative(final.root)}/cases/${c.report.caseId}/case-report.md) | ${c.report.steps.length} | ${c.overflow.length} | ${c.premature.length} | ${c.report.orderId?'Sí':'No'} / ${c.report.shopkeeper?.status??'No ejecutado'} | ${c.report.status} |`), '',
    `Totales de repetición: ${JSON.stringify(totals(final))}. Base fuente sin cambios: ${final.summary.acceptance.sourceUnchanged}; salidas no autorizadas: ${final.summary.counts.blockedNetwork}.`, '',
    `Consumo de VIA en repetición: ${JSON.stringify(final.summary.providerUsage?.application)}. Latencia: ${JSON.stringify(final.summary.timings)}.`, '',
    'Las clasificaciones globales conservan los fallos de experiencia y del evaluador; una selección correcta no significa venta completa. Los siete grupos de regresión de contrato, grounding, arquitectura y contrato del evaluador pasaron con esta versión. WhatsApp y Google externos no se ejercitan en estas campañas.', '',
    'La [revisión manual y los pendientes](Correccion-canasta-y-confirmacion-local-2026-11-04.md) distinguen el bloqueo de botones corregido, las consultas de flete sin responder, el identificador de pago por texto y los fallos del juez.',''] : [])];
const output=path.resolve('docs/Resultado-canasta-confirmacion-local-2026-11-04.md');
await fs.writeFile(output,lines.join('\n'));
console.log(JSON.stringify({output,before:b,after:a,sourceUnchanged:after.summary.acceptance.sourceUnchanged}));
