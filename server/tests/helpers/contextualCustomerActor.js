// Test-only LLM actors. Never supplied internal drafts/plans or runtime events.
import { checkConsent, checkPublicClaims } from './businessOutcomeAssertions.js';

const judgeCriteria = new Set(['unsupported_fact', 'lost_need', 'premature_checkout', 'unresolved_ambiguity',
  'repetition', 'payment_accreditation', 'missing_response', 'incoherent_response']);

export async function testLlmJson(role, system, input) {
  const base = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'x-e2e-role': role },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat', temperature: 0,
      max_tokens: role === 'semantic_judge' ? 6000 : 900, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Evaluator ${role}: DeepSeek HTTP ${response.status}`);
  const data = await response.json();
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error(`Evaluator ${role}: truncated JSON`);
  try { return JSON.parse(data.choices?.[0]?.message?.content ?? '{}'); }
  catch { throw new Error(`Evaluator ${role}: invalid JSON`); }
}

export function publicOptions(outbound = []) {
  return outbound.flatMap((message) => {
    const action = message.interactive?.action;
    return [...(action?.buttons ?? []).map((b) => ({ ...b.reply, kind: 'button_reply' })),
      ...(action?.sections ?? []).flatMap((s) => (s.rows ?? []).map((r) => ({ ...r, kind: 'list_reply' })))];
  });
}

const publicDialogue = dialogue => dialogue.map((turn, index) => ({ turn: turn.turn ?? index + 1,
  customer: turn.customer, customerInteraction: turn.customerInteraction ? {
    kind: turn.customerInteraction.kind, id: turn.customerInteraction.id, title: turn.customerInteraction.title } : null,
  outbound: (turn.outbound ?? []).map(message => ({ text: message.text,
    options: publicOptions([message]) })) }));

export async function nextCustomerTurn({ scenario, dialogue, products, repair = null, request = testLlmJson }) {
  const options = publicOptions(dialogue.at(-1)?.outbound ?? []);
  const answer = await request('customer_actor', `Eres un COMPRADOR sintético colombiano, no el asistente de la tienda.
Responde solo a la conversación pública con tus preferencias privadas. No conoces borradores ni planes internos.
No cambies preferencias para ayudar al sistema. No recites todos los datos cada turno ni corrijas silenciosamente sus errores.
No inventes información que VIA omitió: si no responde sabores, composición o precio, pregunta por el dato que falta; no respondas por ella.
Aclara marcas, medidas y cantidades cuando te pregunten. Si pregunta algo más y no falta tu edición pendiente, di que eso es todo.
Consulta NO es compra: no confirmes ni aceptes pagar. No insistas después de un handoff explícito.
Respeta outcome y goal durante todo el diálogo. En outcome=handoff no transformes la necesidad pendiente en una compra aceptada: solicita aclaración o ayuda humana según lo respondido. Un presupuesto por valor/peso NO autoriza inventar una cantidad de porciones para resolverlo; conserva la incógnita del comprador. No atribuyas a VIA haber entendido miles de unidades si solo preguntó cuántas deseas.
En compra, confirma SOLO después de una cotización vigente y correcta de productos, cantidades e importe; entrega y pago pueden estar acordados en mensajes anteriores.
Si deliveryPricingRequired=true, exige subtotal de productos, tarifa de domicilio y total final conocidos y separados antes de confirmar. No confundas el mínimo con la tarifa ni sumes el domicilio para cumplir el mínimo. Si las condiciones son desconocidas o no se cumple el mínimo, pide aclaración o revisión; no autorices tú una excepción.
No exijas repetir todos los datos en un único mensaje. No exijas frases técnicas como "pendiente de acreditar" si VIA no afirmó que recibió el dinero.
Si faltan detalles o hay errores pide aclaración. Precio equivocado no se acepta. No confirmes al terminar de agregar productos.
Usa optionId solo de las opciones adjuntas si cumple tu preferencia. Puedes responder texto si faltan opciones.
Atiende la pregunta vigente: si solicita nombre, dirección, variante o pago, responde esa aclaración con act=clarify. Seleccionar Efectivo/Tarjeta/Bre-B NUNCA es act=confirm_order. Aunque cite un total, primero responde lo que te preguntó. Confirmar el pedido requiere una cotización correcta y los datos comerciales acordados; decir que no agregas más es finish_collection.
Devuelve JSON {text:string, optionId:string|null, done:boolean, act:"clarify"|"finish_collection"|"confirm_order"|"stop",
quoteSubtotal:number|null, quoteDeliveryFee:number|null, quoteTotal:number|null, quoteLines:[{sku,quantity}],
quoteEvidence:string, quoteSubtotalEvidence:string, quoteDeliveryFeeEvidence:string, quoteTotalEvidence:string, reason:string,
stopBasis:null|"order_acknowledged"|"handoff"|"query_answered", stopEvidence:string}.
quoteLines/quoteSubtotal solo cuando confirmas, extraídos de la cotización vigente. quoteEvidence copia SOLO el fragmento del ÚLTIMO mensaje de VIA que acredita el importe, sin puntos suspensivos ni reconstruir citas anteriores.
Cuando deliveryPricingRequired=true, quoteSubtotal es solo productos, quoteDeliveryFee solo domicilio y quoteTotal el importe final a pagar. Sus tres evidencias copian fragmentos literales del último envío de VIA que vinculen cada etiqueta con su importe; pueden ser la misma cita si contiene el desglose completo. No calcules un importe omitido ni conviertas desconocido en 0. Un total sin desglose no permite confirmar.
Cuando deliveryPricingRequired=false, conserva la compatibilidad: un único total de productos se extrae como quoteSubtotal y quoteEvidence; no exijas desglose de domicilio no previsto por este escenario.
done solo al terminar consulta tras obtener respuesta, recibir confirmación o handoff; no abandones compra por una pregunta válida. finish_collection SIEMPRE done=false: terminar de agregar no finaliza la compra.
Si done=true, stopBasis declara por qué terminaste y stopEvidence cita literalmente el envío de VIA que lo respalda. Una cotización, selección de pago o pregunta "¿confirmas?" no es order_acknowledged. En compra no uses query_answered: sigue aclarando o confirma la cotización cuando corresponda. Si repair está presente, corrige solo tu decisión inválida sin alterar lo que VIA dijo ni inventar consentimiento/evidencia.
Si done=true y no tienes otro mensaje usa text="", act="stop". Si tienes una despedida/aclaración final será enviada antes de terminar.
stopEvidence debe ser un fragmento corto (máximo 120 caracteres) copiado literalmente del último envío de VIA; no copies un párrafo ni reformules nombres/preposiciones. Pedir que te pasen con una persona todavía no es haber recibido un handoff. Si el pedido sigue abierto y solo respondieron una duda sobre pago, pide continuar con la cotización; no declares que no hay compra ni la abandones.
En una consulta di "consulto" o "me refiero a", evita fingir una intención de compra con "quiero".`, {
    goal: scenario.goal, outcome: scenario.outcome, buyer: scenario.buyer,
    deliveryPricingRequired: scenario.deliveryPolicy !== undefined,
    desiredProducts: products.map(({ sku, name, presentation, quantity }) => ({ sku, name, presentation, quantity })),
    dialogue: publicDialogue(dialogue), options, repair,
    latestPublicReply: (dialogue.at(-1)?.outbound ?? []).map(m => m.text).join('\n'),
  });
  try {
  if (typeof answer.done !== 'boolean' || !['clarify', 'finish_collection', 'confirm_order', 'stop'].includes(answer.act)) throw new Error('Evaluator actor: invalid decision schema');
  const option = answer.optionId ? options.find((o) => o.id === answer.optionId) : null;
  if (answer.optionId && !option) throw new Error('Evaluator actor: invented interactive option');
  if (!answer.done && !option && !String(answer.text ?? '').trim()) throw new Error('Evaluator actor: empty turn');
  if (answer.done && !['confirm_order', 'finish_collection'].includes(answer.act)) {
    const text = (dialogue.at(-1)?.outbound ?? []).map(m => m.text).join('\n');
    if (!['order_acknowledged', 'handoff', 'query_answered'].includes(answer.stopBasis)
      || !answer.stopEvidence?.trim() || !text.includes(answer.stopEvidence)) throw new Error('Evaluator actor: stopping requires a literal fragment of latestPublicReply, not a previous turn or paraphrase. If the latest reply is not terminal, continue with done=false.');
    if (scenario.outcome === 'purchase' && answer.stopBasis === 'query_answered') throw new Error('Evaluator actor: answering a question does not complete a purchase');
  }
  const confirmsByButton = option?.title === 'Confirmar pedido';
  if (confirmsByButton && answer.act !== 'confirm_order') throw new Error('Evaluator actor: confirmation button contradicts declared act');
  // The LLM decides WHEN. The test protocol makes the act unambiguous and
  // exercises the regression phrase rather than trusting a contradictory text.
  if (answer.act === 'confirm_order') {
    if (option && !confirmsByButton) throw new Error(`Evaluator actor: wrong option for confirmation. Selected "${option.title}" is a clarification, not the Confirmar pedido button. Use act=clarify, done=false for that selection and wait for VIA's next quote; do not bundle consent into the payment selection.`);
    const invalid = checkConsent({ action: answer, scenario, catalog: products, dialogue }).filter(a => !a.passed);
    if (invalid.length) throw new Error(`Evaluator actor: consent lacks public evidence (${invalid.map(a => a.name).join(', ')})`);
    return { ...answer, text: scenario.confirmText, interactive: null, done: false };
  }
  if (answer.act === 'finish_collection' && scenario.finishCollectionText) return { ...answer, text: scenario.finishCollectionText, interactive: null, done: false };
  return { ...answer, interactive: option };
  } catch (error) {
    if (repair) { error.evaluatorEvidence = { invalidDecision: answer, priorRepair: repair }; throw error; }
    const corrected = await nextCustomerTurn({ scenario, dialogue, products, request,
      repair: { previousDecision: answer, errors: [error.message] } });
    return { ...corrected, protocolRepair: { previousDecision: answer, error: error.message } };
  }
}

export async function judgeConversation({ scenario, dialogue, catalog, fixtureContext = null, repair = null, request = testLlmJson }) {
  const verdict = await request('semantic_judge', `Evalúa una conversación de tienda colombiana contra la rúbrica. NO fuerces frases ni un orden fijo de preguntas.
Solo juzga acciones visibles. No presupongas éxito por una explicación del agente. Sé estricto con todas las opciones, no solo una.
Criterios: preserva necesidades/cantidades/medidas y AND/OR; no inventa marca, precio, stock, cualidad o temperatura; interpreta errores;
aclara variantes antes de pedir pago/cerrar; distingue preferencia de pago y acreditación; no repite preguntas resueltas; no pierde adiciones/retiros;
una consulta no autoriza comprar; terminar colección no es confirmar pedido. Todas las opciones deben ser pertinentes o alternativas explícitas.
En una consulta de precio/disponibilidad NO falta una cantidad de compra: missingNeeds solo son necesidades expresadas NO atendidas, no campos del checkout.
Un handoff correcto no salva un caso de compra completado incorrectamente. Modismos no requieren frases literales.
Evalúa la misma expresión según la pregunta anterior: una respuesta afirmativa por texto a una cotización completa puede confirmar el pedido; NO se exige pulsar un botón ni decir literalmente "confirmo". La misma frase tras preguntar si quiere agregar algo solo cierra la lista, y tras ofrecer dos tamaños no elige ninguno por sí sola. Repreguntar por una variante que el comprador aún NO eligió es correcto, aunque haya respondido "sí" o "solo eso"; seguir preguntando una variante ya elegida sí es repetición. Sustenta el juicio en los turnos públicos, sin convertir estos ejemplos en una aprobación automática.
El contrato actual permite cotizar unidades enteras de la presentación catalogada; no tiene conversión automática de presupuesto a peso o fracción. Un precio igual al presupuesto no acredita cuánta mercancía se vende. Consultar al tendero una condición no acreditada es válido si conserva la necesidad y comunica el pendiente; no lo marques lost_need solo por no confirmar una venta por valor. Sigue denunciando pérdida de productos, repetición de preguntas ya respondidas o promesas sin respaldo. Otra aserción independiente verifica que la tarea humana realmente exista.
No conoces preferencias privadas: evalúa ÚNICAMENTE lo que el cliente ya dijo en cada turno. Preguntar marca/tamaño aún NO dicho es correcto.
fixtureContext contiene exclusivamente datos de prueba establecidos ANTES del primer mensaje: condiciones de la tienda y, si existe, un perfil previamente guardado. Son evidencia disponible para VIA, no invenciones ni datos privados futuros del comprador. No incluye decisiones, drafts ni resultados internos del agente.
No exijas que el comprador haya declarado la tarifa/mínimo: los fija la tienda y se verifican contra fixtureContext.deliveryPolicy. Un cero explícito en esa fuente es válido. No confundas la prohibición de usar preferencias futuras privadas con ignorar la configuración comercial que el agente debe comunicar.
Elegir "Efectivo" o decir "queda efectivo como forma de pago" NUNCA acredita recepción de dinero. paymentVerified solo cuando afirma pago recibido/validado.
Verificar pagos está fuera del alcance de VIA. Una declaración o comprobante requiere acuse y aviso informativo a la tienda, sin acreditar dinero ni bloquear compra/preparación/despacho. Recibir una imagen no verifica una transferencia. No exijas aprobación financiera ni comprobante para contraentrega; una promesa de enviarlo sin adjunto no acredita que se recibió.
No exigir repetición de entrega/pago en cada mensaje. No afirmar que un dato no se guardó por no repetirse: no tienes acceso al estado interno.
customerInteraction documenta un botón/lista que el comprador seleccionó y se puede vincular por id a las opciones públicas previas. Su título puede estar abreviado por WhatsApp; no es texto ambiguo inventado por el comprador ni requiere reconfirmar la misma elección. Usa también el cuerpo público donde se describieron las opciones, sin inferir productos no ofrecidos.
Evalúas lo que VIA dijo, no la calidad de tus propias citas: una cita tuya incompleta es un defecto de extracción que debes corregir, no un issue de VIA. Si el precio está en otra frase del mismo envío, cita esa frase o deja unitPrice=null si solo se comunicó importe de línea. Nunca declares un fallo de la app por una referencia incompleta que tú generaste.
repair.previousVerdict y repair.errors son TU informe anterior y errores de TU extracción, no mensajes de VIA. Si asignaste un SKU equivocado a un nombre correcto, corrige esa extracción; no atribuyas a VIA haber pronunciado ese SKU cuando no está en outbound. Conserva los defectos reales respaldados por la conversación, sin convertir el diagnóstico del evaluador en evidencia pública del agente.
Marca, aliases, familia, descripción, presentación y atributos son evidencia válida. Comprueba todos los campos antes de declarar un dato inventado.
Una opción de botella de 180 ml no es un sachet de 18 ml; debe presentarse como alternativa de formato, no como coincidencia exacta.
Si el cliente pregunta composición/sabor/precio, responder otro dato no resuelve la necesidad. Si el propio comprador aporta luego la respuesta, eso no acredita que VIA contestara.
Devuelve JSON {verdict:"pass"|"fail"|"review", issues:[{turn,severity:"P0"|"P1"|"P2",criterion,reason,evidence}],
turns:[{turn, confirmationOffered:boolean, evidence:string, products:[{sku:string|null,name,quantity:number|null,unitPrice:number|null,evidence:string}],
subtotal:number|null,subtotalEvidence:string,deliveryFee:number|null,deliveryFeeEvidence:string,total:number|null,totalEvidence:string,
subtotalScope:"complete"|"priced_lines"|"unknown",subtotalScopeEvidence:string,
minimumSubtotal:number|null,minimumSubtotalEvidence:string,shortfall:number|null,shortfallEvidence:string,paymentVerified:boolean}], missingNeeds:[], summary:string}.
Incluye TODOS los turnos numerados de entrada, incluso sin outbound; en ese caso products:[], subtotal:null y señala falta de respuesta.
Cada issue debe citar uno de estos criterion: unsupported_fact, lost_need, premature_checkout, unresolved_ambiguity, repetition, payment_accreditation, missing_response, incoherent_response. payment_accreditation SOLO denuncia que VIA afirmó haber recibido/validado dinero y requiere paymentVerified=true en ese turno. NO existe un criterio que exija validar pagos; hacerlo no es responsabilidad de VIA. Seleccionar efectivo y registrar un pedido es correcto sin constancia de pago. Si repair está presente, revisa esos errores de tu informe contra los mismos datos públicos; no cambies la evidencia ni elimines un fallo real para aprobar.
products representa TODAS las opciones/productos realmente ofrecidos en ESE turno (no resultados internos ni productos recordados de otro turno).
evidence debe ser un fragmento CONTIGUO y LITERAL de outbound del turno indicado, nunca del comprador. No reconstruyas frases ni introduzcas puntos suspensivos. Copia solo el fragmento necesario. Un SKU debe corresponder exactamente a la referencia del catálogo que respalda la cita; si su identidad es incierta usa sku:null y review. No infieras precio/cantidad que no se dijeron ni confundas stock disponible con cantidad pedida.
No concaténes nombre y precio separados en outbound: copia una frase literal que ya los incluya. Por ejemplo, si dice "*Arroz:* Diana 500 g Precio unitario de Arroz Diana 500 g: $ 3.200", la cita válida es "Precio unitario de Arroz Diana 500 g: $ 3.200", sin añadir otra vez Arroz o Diana al principio.
Ejemplo: "2 x Ponque (65 g). Subtotal $5.600" => quantity:2, unitPrice:null (no se dijo precio unitario); subtotal:5600.
Ejemplo: "queda efectivo, subtotal $5.600, ¿confirmas?" => products:[], paymentVerified:false. No inventes líneas/medidas ausentes.
subtotal solo para subtotal o total de productos afirmado, no presupuesto ni precio unitario; subtotalEvidence copia texto literal.
subtotalScope=priced_lines únicamente si VIA dice explícitamente que el subtotal es parcial, excluye productos pendientes o deja el total por confirmar por esas líneas; subtotalScopeEvidence cita ese fragmento literal. Si comunica una cotización completa usa complete; sin alcance claro usa unknown. No transformes un total incorrecto en parcial para justificarlo. Otra comprobación calcula las líneas cotizables independientemente; el presupuesto de una línea pendiente no se suma.
Con deliveryPricingRequired=true, extrae POR SEPARADO subtotal de productos, deliveryFee (domicilio), total final, minimumSubtotal (mínimo de productos) y shortfall (faltante). Cada evidencia debe vincular la etiqueta correcta y su importe. El total final nunca se anota como subtotal, ni el mínimo como tarifa. Si se omite un importe, usa null; no lo calcules, no infieras que es cero ni copies otro campo para llenar el vacío. El domicilio no ayuda a alcanzar el mínimo y el faltante no es un recargo.
Ejemplo: "Productos $10.000, domicilio $3.000, mínimo $15.000, faltan $5.000, total $13.000" => subtotal:10000, deliveryFee:3000, minimumSubtotal:15000, shortfall:5000, total:13000. No implica que el mínimo esté cumplido.
Con deliveryPricingRequired=false, conserva el contrato histórico: un único "Total" de productos se extrae como subtotal; no exijas al sistema un nuevo desglose de domicilio.
Faltan evidencias o identificación es incierta: review, jamás pass. No apruebes matemáticas: las verifica otro evaluador independiente.`, {
    catalog,
    scenario: { outcome: scenario.outcome, initial: scenario.initial }, dialogue: publicDialogue(dialogue),
    fixtureContext, repair,
    deliveryPricingRequired: scenario.deliveryPolicy !== undefined,
  });
  const invalid = judgeProtocolIssues(verdict, { scenario, dialogue, catalog });
  if (invalid.length) {
    if (repair) throw Object.assign(new Error(`Evaluator judge: invalid evidence or rubric (${invalid.join('; ')})`),
      { evaluatorEvidence: { invalidVerdict: verdict, priorRepair: repair } });
    const corrected = await judgeConversation({ scenario, dialogue, catalog, fixtureContext, request,
      repair: { previousVerdict: verdict, errors: invalid } });
    return { ...corrected, protocolRepair: { previousVerdict: verdict, errors: invalid } };
  }
  return verdict;
}

export function judgeProtocolIssues(verdict, { scenario, dialogue, catalog }) {
  if (!['pass', 'fail', 'review'].includes(verdict.verdict) || !Array.isArray(verdict.issues) || !Array.isArray(verdict.turns)
    || verdict.turns.length !== dialogue.length || dialogue.some((d, i) => verdict.turns.filter(t => t.turn === (d.turn ?? i + 1)).length !== 1)) return ['incomplete turn coverage'];
  const errors = [];
  const skuSet = new Set(catalog.map(product => product.sku));
  const identity = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = row => [identity(row.name), identity(`${row.name} ${row.presentation ?? ''}`)];
  for (const turn of verdict.turns) for (const product of turn.products ?? []) {
    if (product.sku != null && !skuSet.has(product.sku)) errors.push(`turn ${turn.turn}: SKU ${product.sku} does not exist in the supplied catalog. Copy its exact SKU or use null if identity is uncertain; never reconstruct prefixes.`);
    const row = catalog.find(p => p.sku === product.sku);
    const named = catalog.filter(p => names(p).includes(identity(product.name)));
    // Only an unambiguous conflicting catalog identity is a protocol defect.
    // Never use price to choose a replacement SKU or to erase a real price error.
    if (row && named.length === 1 && named[0].sku !== row.sku) errors.push(`turn ${turn.turn}: extracted name ${product.name} belongs to SKU ${named[0].sku}, not ${row.sku} (${row.name}). Recheck the literal public evidence; do not infer a SKU from a neighboring product.`);
    // Name AND presentation together can disambiguate the literal quote even
    // if the judge copied the wrong name into its own extraction. Never use
    // price to choose identity, and do nothing for ambiguous/multiple names.
    const quotedIdentity = catalog.filter(p => p.name && p.presentation
      && identity(product.evidence).includes(identity(`${p.name} ${p.presentation}`)));
    if (row && quotedIdentity.length === 1 && quotedIdentity[0].sku !== row.sku) errors.push(`turn ${turn.turn}: literal identity in evidence belongs to ${quotedIdentity[0].sku}, not ${row.sku}. Re-extract from the exact public name and presentation; keep any actual price discrepancy for the independent oracle.`);
  }
  for (const issue of verdict.issues) {
    if (!judgeCriteria.has(issue.criterion)) errors.push(`unknown rubric criterion: ${issue.criterion}`);
    if (issue.criterion === 'payment_accreditation' && !verdict.turns.find(t => t.turn === issue.turn)?.paymentVerified) errors.push('payment_accreditation contradicts paymentVerified=false; payment verification is out of scope');
  }
  // Only protocol defects get a bounded retry. Actual product/pricing failures
  // keep their verdict; never repair a result merely because it is unfavorable.
  errors.push(...checkPublicClaims({ verdict, scenario, dialogue, catalog })
    .filter(a => !a.passed && a.severity === 'EVALUATOR').map(a => `${a.name}: ${a.detail.slice(0, 600)}`));
  return errors;
}
