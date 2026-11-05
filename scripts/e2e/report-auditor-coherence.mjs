import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(process.argv[2]);
const prior = path.resolve('test-results/contextual50-auditor-20261104/20261105032251_b3b38c96');
const read = (base, file) => fs.readFile(path.join(base, file), 'utf8').then(JSON.parse);
const [a, old, summary, manifest, source, hashes] = await Promise.all([
  read(root, 'audit-analysis.json'), read(prior, 'audit-analysis.json'), read(root, 'summary.json'),
  read(root, 'run-manifest.json'), read(root, 'baseline-source.json'), read(path.dirname(root), 'execution-source-hashes.json'),
]);
const review = await read(root, 'manual-review.json').catch(() => ({ complete: false, findings: [], caseNotes: {} }));
const focusedRoot = process.argv[3] ? path.resolve(process.argv[3]) : null;
const focused = focusedRoot ? {
  analysis: await read(focusedRoot, 'audit-analysis.json'),
  review: await read(focusedRoot, 'manual-review.json'),
  source: await read(focusedRoot, 'baseline-source.json'),
  hashes: await read(path.dirname(focusedRoot), 'execution-source-hashes.json'),
} : null;
const num = n => Number.isFinite(n) ? n.toLocaleString('es-CO') : 'N/D';
const seconds = n => Number.isFinite(n) ? `${(n / 1000).toFixed(3)} s` : 'N/D';
const percent = (n, d) => d ? `${(n * 100 / d).toFixed(1)} %` : 'N/D';
const escape = text => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const link = file => path.relative(path.resolve('docs'), path.join(root, file)).replaceAll('\\', '/');
const outFile = path.resolve('docs/Resultado-50-casos-auditor-corregido-2026-11-05.md');
const evidenceFile = path.resolve('docs/evidencias/resultado-50-casos-auditor-corregido-2026-11-05.json');
const evidence = { generatedAt: new Date().toISOString(), run: a.run, baseline: old.run, responseTargetMs: 8000,
  codeStableDuringRun: hashes.sourcesUnchanged, sourceUnchanged: source.unchanged, manifest,
  acceptance: summary.acceptance, analysis: a, manualReview: review, postCampaignFocusedValidation: focused };
await fs.writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
const stages = Object.entries(a.latency.stages).map(([name, s]) => `| ${name} | ${s.n} | ${seconds(s.p50)} | ${seconds(s.p95)} | ${seconds(s.max)} |`);
const rows = a.caseTable.map(c => {
  const folder = c.caseId;
  return `| [${c.caseId.slice(0, 2)}](${link(`cases/${folder}/case-report.md`)}) | ${c.status} | ${c.turns} | ${c.orderId ? 'Sí' : 'No'} | ${c.audits} | ${seconds(c.latency.max)} | ${escape(review.caseNotes?.[c.caseId.slice(0, 2)] ?? '')} |`;
});
const findings = review.findings.map(f => `| ${escape(f.cases)} | ${escape(f.classification)} | ${escape(f.evidence)} | ${escape(f.remainingAction)} |`);
const doc = [
  '# Auditor corregido: 50 casos E2E, coherencia y latencia', '',
  `Run **${manifest.runId}**. Informe generado ${evidence.generatedAt}. ${a.cases}/50 casos ejecutados, ${a.turns} turnos principales, ${a.orders} pedidos y ${a.shopkeeperPassed} ciclos completos del tendero.`, '',
  '**Resultado:** 41/50 aprobados automáticamente; quedan defectos reales, problemas del evaluador y latencia fuera del objetivo. Después de estos50 se corrigieron dos detalles de tarifa/cantidad y se repitieron cinco conversaciones afectadas. La versión de esos últimos ajustes tiene validación focalizada, no otra campaña completa de50. Los resultados se mantienen separados.', '',
  '## Alcance y cambios', '',
  '- Solo local: PostgreSQL clonado, backend real, Meta y Google simulados y DeepSeek real. Sin despliegue, cambios en producción ni mensajes de WhatsApp reales.',
  '- Selección interactiva: se guarda en el mensaje de cliente el SKU/presentación exactos después de validar la oferta. El auditor recibe esa evidencia y no depende del título truncado.',
  '- Auditoría: se ejecuta sobre una propuesta lista para resumen confirmable. Conserva el historial y corrige datos con evidencia; no verifica pagos, modifica catálogo ni autoriza excepciones.',
  '- Mensaje y botones: redactor y emisor comparten el contrato de interacción. Una aclaración del auditor no puede arrastrar botones de pago/confirmación ni preguntas ajenas.',
  '- Domicilio: el cero no aplicable de un pedido sin entrega no acredita tarifa gratuita. La tarifa general se distingue del cargo cotizado. El LLM interpreta la solicitud/aceptación y el auditor puede rectificar la modalidad; backend recalcula.',
  '- Importe pendiente: se conserva el valor solicitado en la respuesta y se revisa su variante; no se activa la bandera de venta por valor ni se autoriza un producto pendiente.',
  '- Coherencia semántica: la revisión existente recibe estado real del pedido, acción decidida, botones y aclaraciones del auditor. Revisa consultas de una canasta y aclaraciones; corrige texto sin cambiar la intención ni las condiciones comerciales. Invitaciones a agregar y confirmaciones válidas ya auditadas mantienen su número de llamadas; el redactor recibe la instrucción de respetar la acción contextual.',
  '- El objetivo vigente es **8 segundos totales**, de recepción a último envío útil. No se cambió el timeout de cada proveedor a ocho ni se presentó el acuse webhook como respuesta al cliente.', '',
  '## Componentes y regresiones', '',
  '| Archivo | Corrección |', '|---|---|',
  '| [agentRuntime](../server/services/agentRuntime.js) | Evidencia validada del botón, requisito de datos completos antes de auditoría y contrato compartido de la interacción saliente. |',
  '| [orderDataAuditor](../server/services/orderDataAuditor.js) | Historial con selección exacta y contexto del resumen comunicado; interpretación del consentimiento de entrega. |',
  '| [llmReplyComposer](../server/services/llmReplyComposer.js) | Tarifa frente a cargo no aplicable, aclaración frente a botones y reconocimiento del importe pendiente sin autorizar venta. |',
  '| [llmPlanner](../server/services/llmPlanner.js) | Distinguir consulta de tarifa, aceptación contextual de entrega y dirección recordada. |',
  '| [groundingContracts](../server/domain/groundingContracts.js) / [coordinador](../server/services/conversationGroundingCoordinator.js) | Conservar identidad validada de una línea por importe sin permitir su confirmación cuando el catálogo no lo autoriza. Respetar revisión humana elegida por el LLM. |',
  '| Harness local | Medir último envío del turno contra 8 s, registrar activación y comprobar hashes antes/después. No cambiar los veredictos funcionales para aprobarlos. |', '',
  '- Seis regresiones de contrato aprobaron con red deshabilitada, incluyendo no repetir el auditor antes de recoger pago y no autorizar venta por importe con bandera falsa. [Prueba](../server/tests/auditor-coherence-regression.mjs).',
  '- Seis controles adicionales comprueban la entrega al revisor del estado real, las cantidades completas y los botones, la corrección de cierres/pagos prematuros y la ausencia de otra revisión en confirmaciones válidas. [Prueba](../server/tests/reply-coherence-review-contract.mjs). Los dobles no prueban comprensión del español; esa se evalúa con el proveedor real.',
  '- Ocho pruebas focalizadas con DeepSeek real aprobaron: variantes abreviadas, corrección de entrega y reparación/preservación del borrador. [Evidencia](../test-results/order-data-audit/2026-11-05T04-20-00-744Z/report.json). Son pruebas separadas y no se suman a los 50.',
  '- Contratos de auditoría, grounding, domicilio, comercio, redactor y ofertas interactivas pasaron. La rama específica de carrera PostgreSQL de la suite de domicilio no se ejecutó sin su variable de conexión; los 50 sí usan PostgreSQL real local.',
  '- La campaña focalizada anterior de cuatro casos motivó el ajuste final de auditoría tardía e identidad de la venta por importe. Sus tres aprobados y un error de evaluador no se mezclan con esta versión final.',
  '- Primera repetición completa: 42/50 aprobados, 160 turnos, 17 pedidos, 19 auditorías (16 approve, 2 clarify válidas, 1 correct), p95 11,456 s y 44 turnos >8 s. Detectó cierre verbal prematuro en el caso33 y divergencia de pregunta/acción en42, corregidos antes de esta repetición final. [Evidencia previa](../test-results/contextual50-auditor-corregido-20261105/20261105042828_766337dd/audit-analysis.json).',
  '- Domicilio no gratuito: 2/2 conversaciones con DeepSeek real y auditor activo aprobaron, tarifa$3.000, mínimo$10.000/$15.000, consultas de precio, pago por texto y adición de cantidades. Totales registrados$13.000 y$18.600. Almacenamiento JSONlocal en este control complementario; no sustituye PostgreSQL de los50. [Evidencia](../test-results/delivery-commerce/2026-11-05T05-02-49-300Z/report.json).', '',
  '- Una repetición intermedia se interrumpió al detectar que revisar también ask_more duplicaba la decisión contextual y podía generar una contingencia por términos obligatorios. Se retiró esa revisión adicional. No se mezcla esa corrida incompleta con los50 de este informe. [Registro](../test-results/contextual50-auditor-final-20261105/execution-source-hashes.json).',
  '- Controles DeepSeek del alcance final: tres borradores contradictorios se revisaron y la invitación a agregar mantuvo una sola llamada; evidencia y respuestas completas, incluyendo redacción todavía mejorable. Son controles de componente, no otros casos E2E. [Evidencia](../test-results/reply-coherence-live/2026-11-05T05-11-03-446Z/report.json).', '',
  '- Cinco controles posteriores con DeepSeek real aprobaron: tarifa0 conocida, tarifa$3.000, tarifa null desconocida, tarifa0 con mínimo$15.000 y excepción autorizada0 frente a tarifa general$3.000. Duración de componente1,457–1,993s; no es latencia E2E. [Evidencia](../test-results/delivery-evidence-live/2026-11-05T05-51-43-483Z/report.json).', '',
  '## Resultado', '',
  '| Estado automático | Casos |', '|---|---:|',
  ...Object.entries(a.byStatus).map(([k, v]) => `| ${k} | ${v} |`), '',
  `Auditor: **${a.audit.calls}** revisiones en ${a.audit.cases} casos. ${Object.entries(a.audit.byVerdict).map(([k,v]) => `${k.split('.').at(-1)}=${v}`).join('; ')}. Pedidos con sello: ${a.audit.ordersWithAuditStamp}/${a.orders}. Revisiones tras las que aún faltaban campos: ${a.audit.missingFieldsAfterAudit}.`, '',
  `Revisión manual completada: **${review.complete ? 'sí' : 'no'}**. Las etiquetas automáticas no sustituyen la inspección de conversaciones ni convierten un error de evaluador en aprobado.`, '',
  '## Validación posterior de los últimos dos ajustes', '',
  ...(focused ? [
    `Run **${focused.analysis.run}**: ${focused.analysis.cases} conversaciones, ${focused.analysis.turns} turnos. Estados: ${Object.entries(focused.analysis.byStatus).map(([k,v])=>`${k}=${v}`).join(', ')}. No se sustituyen con ellos los resultados originales de50.`, '',
    '| Caso | Estado automático | Inspección posterior |', '|---|---|---|',
    ...focused.analysis.caseTable.map(c=>`| ${c.caseId.slice(0,2)} | ${c.status} | ${escape(focused.review.caseNotes[c.caseId.slice(0,2)])} |`), '',
    `Latencia: mediana ${seconds(focused.analysis.latency.lastOutbound.p50)}, p95 ${seconds(focused.analysis.latency.lastOutbound.p95)}, máximo ${seconds(focused.analysis.latency.lastOutbound.max)}, ${focused.analysis.latency.lastOutbound.over8000}/${focused.analysis.turns} turnos >8s. Tampoco acredita el objetivo. Base fuente intacta: ${focused.source.unchanged}; código congelado durante la repetición: ${focused.hashes.sourcesUnchanged}.`, '',
    `[Evidencia focalizada](../${focused.analysis.run}/audit-analysis.json) y [revisión de conversaciones](../${focused.analysis.run}/manual-review.json).`, '',
  ] : ['No se suministró una repetición posterior completa al generador.', '']),
  '## Comparación de latencia', '',
  '| Métrica | Campaña anterior | Corregida |', '|---|---:|---:|',
  `| Turnos | ${old.turns} | ${a.turns} |`,
  `| Mediana total | ${seconds(old.latency.lastOutbound.p50)} | ${seconds(a.latency.lastOutbound.p50)} |`,
  `| p95 total | ${seconds(old.latency.lastOutbound.p95)} | ${seconds(a.latency.lastOutbound.p95)} |`,
  `| Máximo total | ${seconds(old.latency.lastOutbound.max)} | ${seconds(a.latency.lastOutbound.max)} |`,
  `| Turnos >8 s | ${old.latency.rows.filter(r => r.lastOutboundMs > 8000).length}/${old.turns} | ${a.latency.lastOutbound.over8000}/${a.turns} (${percent(a.latency.lastOutbound.over8000, a.turns)}) |`,
  `| p95 acuse webhook | ${seconds(old.latency.ack.p95)} | ${seconds(a.latency.ack.p95)} |`,
  `| Revisiones del auditor | ${old.audit.calls} | ${a.audit.calls} |`, '',
  `Objetivo de todas las respuestas <=8 s: **${summary.acceptance.allResponsesWithinTarget && a.latency.turnsWithoutOutbound === 0 ? 'cumplido en esta campaña' : 'no cumplido'}**. p95 <=8 s: **${summary.acceptance.processingP95WithinTarget ? 'sí' : 'no'}**. Turnos sin respuesta: **${a.latency.turnsWithoutOutbound}**; se reportan aparte de los percentiles, no se consideran respuestas rápidas. No basta la mediana.`, '',
  'Las conversaciones las genera un comprador LLM y no son idénticas entre campañas. Esta comparación no es un experimento A/B que atribuya cada variación al auditor. No sumar percentiles entre etapas.', '',
  '| Etapa observada | Llamadas | Mediana | p95 | Máxima |', '|---|---:|---:|---:|---:|', ...stages, '',
  '| Llamadas LLM observadas en el turno | Turnos con respuesta | Mediana total | p95 total | >8s |',
  '|---|---:|---:|---:|---:|',
  ...Object.entries(a.latency.byObservedCallCount).map(([n,s])=>`| ${n} | ${s.n} | ${seconds(s.p50)} | ${seconds(s.p95)} | ${s.over8000} |`), '',
  'Conteo por eventos instrumentados, sin atribuir duraciones desconocidas de errores de transporte. La suma de medianas/p95 de componentes no es la latencia de una conversación. La cadena de llamadas y el tiempo antes de procesar se contrastan con cada turno.', '',
  'Diagnóstico: los turnos con1–2 llamadas observadas permanecieron bajo8s; con4 llamadas,43/58 lo superaron; con5,9/9. El auditor aislado tuvo mediana1,695s/p95 2,451s, mientras el tiempo previo al agente tuvo mediana27ms/p95 1,913s/máximo4,248s. Esto señala acumulación de trabajo secuencial y algunos retrasos previos; no demuestra que quitar el auditor resuelva el problema ni atribuye todo a DeepSeek. Las revisiones no se añaden a todos los turnos.', '',
  'Siguiente optimización local: (1) guion fijo y trazas por etapa para comparación reproducible; (2) recortar evidencia duplicada y longitud de salida conservando los atributos relevantes; (3) verificar esperas de agrupación/cola y reutilización de resultados por revisión; (4) conservar intérprete, resolución y auditoría con responsabilidades separadas, sin omitir inferencia ni validar con respuestas prefabricadas. Repetir aceptación y carga después de cada cambio. No implementado ni desplegado en esta tarea.', '',
  '## Hallazgos revisados', '',
  '| Casos | Clasificación | Evidencia | Acción pendiente o conclusión |', '|---|---|---|---|', ...findings, '',
  '## Consumo real por actor', '',
  '| Actor | Solicitudes | Tokens entrada | Tokens salida | Tokens reportados |', '|---|---:|---:|---:|---:|',
  ...Object.entries(summary.providerUsage).map(([k,v]) => `| ${k} | ${v.requests ?? v.calls ?? 'N/D'} | ${num(v.promptTokens ?? v.inputTokens)} | ${num(v.completionTokens ?? v.outputTokens)} | ${num(v.totalTokens)} |`), '',
  'Comprador sintético y juez no son costos operativos del agente. El consumo con usage reportado no incluye tokens desconocidos de llamadas incompletas. Los turnos no equivalen a pedidos: hay consultas y escalamientos.', '',
  '## Los 50 casos', '',
  '| Caso | Estado automático | Turnos | Pedido | Auditorías | Máxima total | Revisión |', '|---|---|---:|---|---:|---:|---|', ...rows, '',
  '## Evidencia y límites', '',
  `- Base fuente intacta: **${source.unchanged ? 'sí' : 'NO'}**. Código estable durante la campaña: **${hashes.sourcesUnchanged ? 'sí' : 'NO'}**. Auditor activo: **${manifest.orderAuditEnabled}**.`,
  `- [Resumen original](${link('summary.json')}), [manifest](${link('run-manifest.json')}), [análisis por turno](${link('audit-analysis.json')}), [revisión manual](${link('manual-review.json')}), [proveedor](${link('provider-requests.json')}), [base original antes/después](${link('baseline-source.json')}).`,
  '- [Consolidado JSON](evidencias/resultado-50-casos-auditor-corregido-2026-11-05.json).',
  '- Catálogo de pruebas de 300 productos más fixtures por caso. No valida los datos ni latencia de Google/Meta reales, carga concurrente ni UI móvil. Se conserva separación por tenant y clone local.',
  '- No se eliminan los fallos de una campaña cambiando sus etiquetas. Pruebas focalizadas y controles con errores inyectados se informan aparte.',
  '', 'Comando de repetición: `node scripts/e2e/run-contextual-audit-local.mjs` (carga credencial local sin imprimirla; crea un clon y un run nuevo).', '',
];
const prose = doc.join('\n').replaceAll('estos50', 'estos 50').replaceAll('de50', 'de 50')
  .replaceAll('los50', 'los 50').replaceAll('caso33', 'caso 33').replaceAll('en42', 'en 42')
  .replaceAll('tarifa$', 'tarifa $').replaceAll('tarifa0', 'tarifa 0')
  .replaceAll('registrados$', 'registrados $').replaceAll('JSONlocal', 'JSON local')
  .replaceAll('componente1,457', 'componente 1,457').replaceAll('con1–2', 'con 1–2')
  .replaceAll('bajo8s', 'bajo 8 s').replaceAll('con4 llamadas,43/58', 'con 4 llamadas, 43/58')
  .replaceAll('con5,9/9', 'con 5, 9/9').replaceAll('mediana1,695s', 'mediana 1,695 s')
  .replaceAll('mediana27ms', 'mediana 27 ms').replaceAll('1,913s/máximo4,248s', '1,913 s/máximo 4,248 s');
await fs.writeFile(outFile, prose);
console.log(JSON.stringify({ report: outFile, evidence: evidenceFile, cases: a.cases, manualComplete: review.complete }));
