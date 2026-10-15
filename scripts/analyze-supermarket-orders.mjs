import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2] ?? '.analysis/whatsapp-supermarket/Chat de WhatsApp con SuperMarket.txt';
const outputDir = process.argv[3] ?? '.analysis/whatsapp-supermarket';
const SESSION_GAP_MINUTES = 90;
const DEEPSEEK_CALLS_PER_STORE_RESPONSE = 1;
const TOKEN_BASELINE_PER_CALL = 2350;

const raw = fs.readFileSync(inputPath, 'utf8');
const sourceLines = raw.split(/\r?\n/);
const messageStart = /^(\d{1,2}\/\d{1,2}\/\d{2}),\s+(.+?)\s+-\s+([^:]+):\s?(.*)$/;

function parseTimestamp(dateText, timeText) {
  const normalized = timeText
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const match = normalized.match(/(\d{1,2}):(\d{2})\s*(a|p)\.\s*m\.?/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (match[3] === 'p' && hours < 12) hours += 12;
  if (match[3] === 'a' && hours === 12) hours = 0;

  const [day, month, year] = dateText.split('/').map(Number);
  return new Date(2000 + year, month - 1, day, hours, minutes);
}

function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

const messages = [];
for (let index = 0; index < sourceLines.length; index += 1) {
  const line = sourceLines[index];
  const match = line.match(messageStart);
  if (!match) {
    if (messages.length && line.trim()) {
      messages[messages.length - 1].text += `\n${line}`;
      messages[messages.length - 1].sourceLineEnd = index + 1;
    }
    continue;
  }

  const [, dateText, timeText, senderText, text] = match;
  const timestamp = parseTimestamp(dateText, timeText);
  if (!timestamp) continue;

  messages.push({
    index: messages.length + 1,
    sourceLineStart: index + 1,
    sourceLineEnd: index + 1,
    timestamp,
    dateText,
    sender: senderText.trim(),
    text: text.trim(),
  });
}

const sessions = [];
let current = [];
let previousTimestamp = null;
for (const message of messages) {
  if (previousTimestamp && message.timestamp - previousTimestamp > SESSION_GAP_MINUTES * 60 * 1000) {
    sessions.push(current);
    current = [];
  }
  current.push(message);
  previousTimestamp = message.timestamp;
}
if (current.length) sessions.push(current);

const orderIntent = /\b(domicilio|pedido|me regalas|me puede|me puedes|tiene(?:s|n)?|hay|cuanto|cual|lleva|quiero|necesito|busco|vende|dame|envia|envie|mandame|mandamelo|traeme|factur|disponib|cuantos|para llevar|a domicilio|mandar|traer|comprar)\b/i;
const productSignal = /\b(choc|cifrut|club|malboro|coca|pepsi|pan|queso|jamon|cerveza|cigarr|brownie|ponque|ducales|galleta|salch|calch|jugo|cafe|arroz|leche|huevo|agua|gaseosa|ramit|six|paquete|taco|bimbo|arequipe|tostado|papel higienico|ambientador|crema para peinar)\b/i;
const paymentSignal = /\b(pago|efectivo|tarjeta|datafono|datáfono|nequi|bre[- ]?b|transferencia|comprobante|billete)\b/i;
const correctionSignal = /\b(sin ese|sin esa|mejor|camb|agrega|agregue|tambien|también|no ese|no esa|quita|quite|entonces sin|en vez de)\b/i;
const deliverySignal = /\b(domicilio|ya salio|ya salio|ya le alist|alistamos|alist|envio|envio|mando|mandamos|llego|lleg[oó]|direcci[oó]n|carrera|calle|transversal|diagonal)\b/i;
const confirmationSignal = /\b(confirmo|confirmado|listo|ok|vale|perfecto|si senor|si señora|si veci|gracias|con gusto|siempre a la orden|ya salio|ya le alist)\b/i;
const multimediaSignal = /<multimedia omitido>|se elimin[oó] este mensaje|eliminaste este mensaje/i;
const greetingOnly = /^(?:buenas?|hola|buenos dias|buenas tardes|buenas noches|buena noche|buen dia|buenas noches veci|buenas tardes veci|buenas noches señor|buenas tardes señor)[.! ]*$/i;

function classifySession(session) {
  const customerMessages = session.filter((message) => message.sender === 'Messi');
  const storeMessages = session.filter((message) => message.sender === 'SuperMarket');
  const customerText = customerMessages.map((message) => message.text).join(' ');
  const allText = session.map((message) => message.text).join(' ');
  const nonGreetingCustomer = customerMessages.filter((message) => !greetingOnly.test(message.text.trim()));
  const hasIntent = orderIntent.test(allText);
  const hasProduct = productSignal.test(allText);
  const isUnclassified = nonGreetingCustomer.length === 0 && !hasIntent && !hasProduct;
  const hasPayment = paymentSignal.test(allText);
  const hasCorrection = correctionSignal.test(customerText);
  const hasDelivery = deliverySignal.test(allText);
  const hasMultimedia = multimediaSignal.test(allText);
  const hasConfirmation = confirmationSignal.test(allText);
  const hasOrderOrCatalogIntent = !isUnclassified && (hasIntent || hasProduct);

  let status = 'consulta_o_pedido';
  if (isUnclassified) status = 'sin_pedido_identificable';
  else if (hasDelivery && hasConfirmation) status = 'pedido_con_indicio_de_cierre';
  else if (hasPayment || hasCorrection) status = 'pedido_en_construccion';
  else if (hasProduct || hasIntent) status = 'consulta_o_pedido';

  return {
    status,
    hasOrderOrCatalogIntent,
    customerMessages,
    storeMessages,
    flags: {
      payment: hasPayment,
      correction: hasCorrection,
      delivery: hasDelivery,
      multimedia: hasMultimedia,
      confirmation: hasConfirmation,
    },
  };
}

const orderRows = [];
const callRows = [];
let orderSequence = 0;
for (const session of sessions) {
  const analysis = classifySession(session);
  const orderId = `SM-PED-${String(++orderSequence).padStart(3, '0')}`;
  const first = session[0];
  const last = session.at(-1);
  const storeCalls = analysis.storeMessages.length * DEEPSEEK_CALLS_PER_STORE_RESPONSE;
  const multimediaMessages = session.filter((message) => multimediaSignal.test(message.text)).length;

  orderRows.push({
    orderId,
    status: analysis.status,
    sourceSession: orderSequence,
    sourceMessageStart: first.index,
    sourceMessageEnd: last.index,
    sourceLineStart: first.sourceLineStart,
    sourceLineEnd: last.sourceLineEnd,
    startedAt: first.timestamp.toISOString(),
    endedAt: last.timestamp.toISOString(),
    totalMessages: session.length,
    customerMessages: analysis.customerMessages.length,
    supermarketResponses: analysis.storeMessages.length,
    deepseekCallsAssumed: storeCalls,
    multimediaMessages,
    paymentMention: analysis.flags.payment,
    correctionMention: analysis.flags.correction,
    deliveryMention: analysis.flags.delivery,
    confirmationMention: analysis.flags.confirmation,
    hasOrderOrCatalogIntent: analysis.hasOrderOrCatalogIntent,
  });

  analysis.storeMessages.forEach((message, responseIndex) => {
    callRows.push({
      orderId,
      sourceMessageIndex: message.index,
      sourceLineStart: message.sourceLineStart,
      sourceLineEnd: message.sourceLineEnd,
      timestamp: message.timestamp.toISOString(),
      responseIndex: responseIndex + 1,
      responseChars: message.text.length,
      responseIsMultimediaOrDeleted: multimediaSignal.test(message.text),
      deepseekCallsAssumed: DEEPSEEK_CALLS_PER_STORE_RESPONSE,
      tokenBaselineApplied: TOKEN_BASELINE_PER_CALL,
    });
  });
}

const orderLike = orderRows.filter((row) => row.hasOrderOrCatalogIntent);
const orderLikeWithResponse = orderLike.filter((row) => row.supermarketResponses > 0);
const unclassified = orderRows.filter((row) => !row.hasOrderOrCatalogIntent);
const values = (rows, field) => rows.map((row) => row[field]).sort((a, b) => a - b);
const percentile = (rows, field, p) => {
  const sorted = values(rows, field);
  if (!sorted.length) return 0;
  return sorted[Math.floor((sorted.length - 1) * p)];
};
const average = (rows, field) => rows.length ? rows.reduce((sum, row) => sum + row[field], 0) / rows.length : 0;

const summary = {
  source: path.normalize(inputPath),
  generatedAt: new Date().toISOString(),
  method: {
    sessionGapMinutes: SESSION_GAP_MINUTES,
    orderDefinition: 'Un bloque de mensajes separado por 90 minutos; se marca como pedido o consulta cuando hay intención de compra, producto o búsqueda de disponibilidad.',
    deepseekCallDefinition: 'Cada mensaje emitido por SuperMarket cuenta como una llamada hipotética independiente a DeepSeek.',
    importantLimitation: 'El export de WhatsApp no contiene un identificador de pedido. Por eso los 365 bloques son unidades operativas, no una verdad contable de pedidos; una misma unidad podría contener una compra y una consulta.',
    tokenBaseline: '2.350 tokens por llamada: referencia de una llamada real DeepSeek registrada en el smoke test del proyecto. No se aplica como medición individual del chat histórico.',
  },
  counts: {
    parsedMessages: messages.length,
    customerMessages: messages.filter((message) => message.sender === 'Messi').length,
    supermarketResponses: messages.filter((message) => message.sender === 'SuperMarket').length,
    sessionsOrOperationalBlocks: orderRows.length,
    orderOrCatalogBlocks: orderLike.length,
    unclassifiedBlocks: unclassified.length,
    orderOrCatalogBlocksWithoutStoreResponse: orderLike.length - orderLikeWithResponse.length,
    multimediaOrDeletedMessages: messages.filter((message) => multimediaSignal.test(message.text)).length,
    deepseekCallsAssumedAllBlocks: callRows.length,
    deepseekCallsAssumedOrderOrCatalog: callRows.filter((row) => orderLike.some((order) => order.orderId === row.orderId)).length,
  },
  callsPerOrderOrCatalogBlock: {
    denominator: 'Bloques con pedido/consulta y al menos una respuesta de SuperMarket',
    average: Number(average(orderLikeWithResponse, 'deepseekCallsAssumed').toFixed(2)),
    median: percentile(orderLikeWithResponse, 'deepseekCallsAssumed', 0.5),
    p75: percentile(orderLikeWithResponse, 'deepseekCallsAssumed', 0.75),
    max: Math.max(...values(orderLikeWithResponse, 'deepseekCallsAssumed')),
  },
  tokenProjectionUsingBaseline: {
    observedOrderOrCatalogBlocks: {
      average: Math.round(average(orderLikeWithResponse, 'deepseekCallsAssumed') * TOKEN_BASELINE_PER_CALL),
      p75: percentile(orderLikeWithResponse, 'deepseekCallsAssumed', 0.75) * TOKEN_BASELINE_PER_CALL,
      total: callRows.filter((row) => orderLike.some((order) => order.orderId === row.orderId)).length * TOKEN_BASELINE_PER_CALL,
    },
    threeHundredOrders: {
      average: Math.round(300 * average(orderLikeWithResponse, 'deepseekCallsAssumed') * TOKEN_BASELINE_PER_CALL),
      p75: 300 * percentile(orderLikeWithResponse, 'deepseekCallsAssumed', 0.75) * TOKEN_BASELINE_PER_CALL,
    },
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'pedidos-supermarket.json'), JSON.stringify({ summary, orders: orderRows, deepseekCalls: callRows }, null, 2));

const orderHeaders = Object.keys(orderRows[0]);
const orderCsv = [orderHeaders.join(','), ...orderRows.map((row) => orderHeaders.map((header) => csvCell(row[header])).join(','))].join('\n');
fs.writeFileSync(path.join(outputDir, 'pedidos-supermarket.csv'), `${orderCsv}\n`);

const callHeaders = Object.keys(callRows[0]);
const callCsv = [callHeaders.join(','), ...callRows.map((row) => callHeaders.map((header) => csvCell(row[header])).join(','))].join('\n');
fs.writeFileSync(path.join(outputDir, 'llamadas-deepseek-supermarket.csv'), `${callCsv}\n`);

console.log(JSON.stringify(summary, null, 2));
