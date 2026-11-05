import fs from 'node:fs/promises';
import path from 'node:path';

// Read-only over raw runs; write a separate audit, never overwrite a verdict.
const args = process.argv.slice(2);
const validationArg = args.find((p) => p.startsWith('--validation='));
const directories = args.filter((p) => !p.startsWith('--validation=')).map((p) => path.resolve(p));
if (!directories.length) throw new Error('Supply one or more completed contextual run directories');
const sections = ['# Evidencia de aceptación contextual v2 — 2026-11-04', '',
  'Estos son resultados del instrumento v2, no una certificación de producción. Los fallos de proveedor, del evaluador y de la aplicación se distinguen abajo. Los veredictos semánticos requieren revisar sus citas: pueden contener inferencias incorrectas. No se han corregido componentes productivos en esta etapa.', '',
  '**Conclusión:** el 40/40 histórico no acreditaba conversaciones completas. La nueva campaña conserva diálogos, borradores y acciones del tendero, y descubre errores intermedios aunque el pedido final se recupere. [Auditoría manual y ejemplos](Auditoria-manual-aceptacion-contextual-2026-11-04.md).', ''];
const comparisons = [];
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
for (const directory of directories) {
  const summary = JSON.parse(await fs.readFile(path.join(directory, 'summary.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'run-manifest.json'), 'utf8'));
  const folders = await fs.readdir(path.join(directory, 'cases'));
  const cases = await Promise.all(folders.sort().map(async (folder) => JSON.parse(await fs.readFile(path.join(directory, 'cases', folder, 'case-report.json'), 'utf8'))));
  const rel = path.relative(path.resolve('docs'), directory).replaceAll('\\', '/');
  const evaluation = JSON.parse(await fs.readFile(path.join(directory, 'evaluation-v2.1/summary.json'), 'utf8'));
  const revised = new Map(evaluation.cases.map((r) => [r.caseId, r]));
  const details = await Promise.all(cases.map((r) => fs.readFile(path.join(directory, 'evaluation-v2.1', `${r.caseId}.json`), 'utf8').then(JSON.parse)));
  const observedLatencies = cases.flatMap((r) => r.steps.map((s) => s.timing?.receptionToOutboundMs)).filter((n) => Number.isFinite(n));
  comparisons.push({ manifest, summary, cases, revised, rel });
  sections.push(`## ${manifest.groundingEnabled ? 'Grounding activo' : 'Flujo anterior'} — ${summary.runId}`, '',
    `Campaña: ${manifest.campaign}. Casos: ${cases.length}. Turnos cliente/VIA: **${cases.reduce((n, r) => n + r.steps.length, 0)}**. Aprobados por el instrumento original: **${summary.counts.passed}/${summary.counts.total}**. Este porcentaje no es comparable al 40/40 histórico: cambió el oráculo y el número de turnos.`, '',
    `Huella de la fuente PostgreSQL sin cambios: **${summary.acceptance.sourceUnchanged}**. Intentos bloqueados de salida no autorizada: **${summary.counts.blockedNetwork}**. Pedidos persistidos: **${cases.filter((r) => r.orderId).length}**. Flujos del tendero aprobados: **${cases.filter((r) => r.shopkeeper?.status === 'passed').length}**.`, '',
    `p95 acuse: ${summary.timings.webhookAckP95Ms} ms; recepción/procesamiento local: ${summary.timings.workerProcessingP95Ms} ms. Esto no mide rendimiento bajo carga ni latencia real de Meta/Google.`, '',
    `Recepción → primer envío simulado nuevo, solo turnos con respuesta: p50 **${percentile(observedLatencies, .5)} ms**, p95 **${percentile(observedLatencies, .95)} ms** (${observedLatencies.length} muestras). Los silencios se reportan como fallos, no como latencia cero.`, '',
    '### Segunda lectura del mismo diálogo (evaluador 2.1)', '',
    'No se volvió a ejecutar VIA ni se cambiaron resultados originales. Se entregó al juez el catálogo completo, se separaron alternativas del subtotal y se comprobaron cantidades máximas directamente en los borradores. Cada reporte conserva hash del original y del evaluador. La revisión manual sigue siendo necesaria.', '',
    '| Clasificación de la segunda lectura | Casos |', '|---|---:|',
    ...Object.entries(evaluation.counts).map(([key, value]) => `| ${key} | ${value} |`), '',
    `Señales independientes y superpuestas: **${details.filter((r) => r.assertions.some((a) => !a.passed && /basket_(quantity|amount)_limit/.test(a.name))).length} casos exceden cantidades/importes del comprador**; **${details.filter((r) => r.assertions.some((a) => !a.passed && a.name === 'human_task_unique')).length} tienen tareas pendientes duplicadas**; **${cases.filter((r) => r.steps.some((s) => !s.outbound.length)).length} contienen silencio**; **${cases.filter((r) => r.assertions.some((a) => !a.passed && /^turn_\d+_ack$/.test(a.name))).length} superan el objetivo de acuse en algún turno**. No sumar estas categorías como si fueran excluyentes.`, '',
    '| Consumo medido | Solicitudes | Con usage | Entrada | Salida | Total tokens |', '|---|---:|---:|---:|---:|---:|');
  for (const [role, value] of Object.entries(summary.providerUsage)) sections.push(`| ${role} | ${value.requests} | ${value.withUsage} | ${value.inputTokens} | ${value.outputTokens} | ${value.totalTokens} |`);
  sections.push('', 'Comprador y juez consumen tokens de ensayo; **no se suman al consumo operativo de VIA por domicilio**. Solicitudes sin usage no se estiman como cero facturado.', '',
    '| Caso | Turnos | Resultado original | Evaluador 2.1 | Pedido | Evidencia |', '|---|---:|---|---|---|---|');
  for (const r of cases) sections.push(`| ${r.caseId} | ${r.steps.length} | ${r.status} | ${revised.get(r.caseId)?.status ?? 'Sin evaluar'}${manifest.groundingEnabled && r.caseId.startsWith('25-') ? ' **(objeción manual: formato incorrecto)**' : ''} | ${r.orderId ? 'Sí' : 'No'} | [Diálogo](${rel}/cases/${r.caseId}/case-report.md) · [Reevaluación](${rel}/evaluation-v2.1/${r.caseId}.json) |`);
  if (manifest.groundingEnabled) sections.push('', '**Desacuerdo que sigue abierto:** el juez vuelve a aprobar el caso 25, pero la auditoría observa una botella de 180 ml dentro de opciones descritas como sobres de 18 ml. Ese aprobado no acredita corrección funcional. Consultar también los casos 14, 31, 41 y 46 en la auditoría manual.');
  const auditUsage = JSON.parse(await fs.readFile(path.join(directory, 'evaluation-v2.1/judge-provider-requests.json'), 'utf8'));
  sections.push('', `Reevaluación adicional: ${auditUsage.length} solicitudes del juez, ${auditUsage.reduce((n, r) => n + (r.usage?.total_tokens ?? 0), 0)} tokens reportados, ${auditUsage.filter((r) => !r.usage).length} solicitudes sin usage. Este consumo tampoco pertenece al servicio operativo por domicilio.`, '');
  sections.push('', `Manifiesto y configuración: [run-manifest.json](${rel}/run-manifest.json). Uso real por solicitud: [provider-requests.json](${rel}/provider-requests.json). Resumen completo: [summary.json](${rel}/summary.json).`, '');
}
if (comparisons.length === 2) {
  const current = comparisons.find((r) => r.manifest.groundingEnabled);
  const previous = comparisons.find((r) => !r.manifest.groundingEnabled);
  if (current && previous) {
    sections.push('## Comparación acotada con el flag desactivado', '',
      `Mismo hash de fuentes: **${current.manifest.sourceSha256 === previous.manifest.sourceSha256}**. Mismo catálogo: **${current.manifest.catalogSha256 === previous.manifest.catalogSha256}**. Solo se comparan los ${previous.cases.length} casos seleccionados en ambas corridas. El comprador es adaptativo: los diálogos no son idénticos ni esto estima una tasa poblacional de mejora. No se hizo checkout de otro commit; "flujo anterior" significa el mismo árbol de trabajo con grounding apagado.`, '',
      '| Caso | Turnos activo/apagado | Pedido activo/apagado | Evaluación activo/apagado |', '|---|---:|---|---|');
    for (const old of previous.cases) {
      const fresh = current.cases.find((r) => r.caseId === old.caseId);
      if (!fresh) continue;
      sections.push(`| ${old.caseId} | ${fresh.steps.length}/${old.steps.length} | ${fresh.orderId ? 'Sí' : 'No'}/${old.orderId ? 'Sí' : 'No'} | ${current.revised.get(old.caseId)?.status}/${previous.revised.get(old.caseId)?.status} |`);
    }
    sections.push('');
  }
}
if (validationArg) {
  const directory = path.resolve(validationArg.slice('--validation='.length));
  const rel = path.relative(path.resolve('docs'), directory).replaceAll('\\', '/');
  const summary = JSON.parse(await fs.readFile(path.join(directory, 'summary.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'run-manifest.json'), 'utf8'));
  const names = (await fs.readdir(path.join(directory, 'cases'))).sort();
  const reports = await Promise.all(names.map((n) => fs.readFile(path.join(directory, 'cases', n, 'case-report.json'), 'utf8').then(JSON.parse)));
  sections.push('## Validación focalizada del comprador corregido (2.1)', '',
    `Nueva ejecución local ${summary.runId}, instrumento ${manifest.acceptanceVersion}. Solo casos 23, 29, 40 y 50; no reemplaza la campaña de 50 ni es una nueva tasa global. Huella de la fuente sin cambios: **${summary.acceptance.sourceUnchanged}**. No se corrigió el backend entre ambas pruebas.`, '',
    '| Caso | Turnos | Resultado | Terminación | Pedido | Evidencia |', '|---|---:|---|---|---|---|');
  for (const r of reports) sections.push(`| ${r.caseId} | ${r.steps.length} | ${r.status} | ${r.termination} | ${r.orderId ? 'Sí' : 'No'} | [Diálogo y aserciones](${rel}/cases/${r.caseId}/case-report.md) |`);
  sections.push('', `Uso adicional medido: VIA ${summary.providerUsage.application.requests} solicitudes/${summary.providerUsage.application.totalTokens} tokens; comprador ${summary.providerUsage.customer_actor.requests}/${summary.providerUsage.customer_actor.totalTokens}; juez ${summary.providerUsage.semantic_judge.requests}/${summary.providerUsage.semantic_judge.totalTokens}. [Resumen completo](${rel}/summary.json).`, '');
}
sections.push('## Condición para continuar', '',
  'Prioridad 1: preservar identidad y cantidad de cada línea al aclarar o reiterar datos; no pedir confirmación con productos pendientes. Prioridad 2: responder consultas intercaladas y conservar la intención de agregar, retirar o comparar. Prioridad 3: revisar latencias por etapa y fallos del proveedor, sin ocultarlos con respuestas predeterminadas.', '',
  'Antes de corregir la aplicación: cerrar desacuerdos del instrumento y revisar los casos incompletos por actor. Conservar el flag apagado por defecto. Pendientes de liberación: comparación completa de ambas versiones, tres repeticiones críticas, variantes concurrentes de SuperMarket, continuidad del tendero en excepciones desde la UI y comprobación de Sheets real. No se realizó despliegue con este informe.', '');
const output = path.resolve('docs/Evidencia-aceptacion-contextual-v2-2026-11-04.md');
await fs.writeFile(output, sections.join('\n'));
console.log(output);
