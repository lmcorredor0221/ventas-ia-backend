export function catalogSemanticGuide() {
  return [
    'Interpreta el lenguaje del cliente como hipótesis contextual, no como coincidencias exactas.',
    'Conserva literalmente el texto original y separa atributos explícitos de inferidos.',
    'Corrige ortografía, abreviaturas y modismos colombianos solo como hipótesis que luego debe verificar el catálogo.',
    '“Familiar”, “grande” y “personal” dependen del contexto y de las presentaciones disponibles; no uses umbrales fijos.',
    'No inventes SKU, precio, stock, presentación ni disponibilidad. Esos hechos vienen exclusivamente del catálogo.',
    'Si falta evidencia o quedan varias interpretaciones razonables, conserva la incertidumbre y solicita una aclaración.',
  ];
}

/**
 * Compact tenant vocabulary used only to ground product interpretation.
 *
 * This deliberately contains family/product names and brands only. It is not
 * a catalog lookup and must never be used to invent SKU, presentation, price,
 * stock or availability. Keeping this prefix stable for a catalogVersion also
 * lets providers such as DeepSeek reuse their automatic prompt cache while the
 * per-message conversation remains in the dynamic suffix below.
 */
export function buildTenantProductVocabulary(index) {
  const combinations = new Map();
  for (const product of Object.values(index?.products ?? {})) {
    const productName = String(product?.family ?? product?.productFamily ?? product?.name ?? '').trim();
    if (!productName) continue;
    const brand = String(product?.brand ?? '').trim() || null;
    const key = `${normalizeVocabularyValue(productName)}|${normalizeVocabularyValue(brand ?? '')}`;
    if (!key.replace('|', '')) continue;
    combinations.set(key, { product: productName, brand });
  }
  return {
    catalogVersion: index?.catalogVersion ?? null,
    products: [...combinations.values()].sort((a, b) => (
      `${a.product}|${a.brand ?? ''}`.localeCompare(`${b.product}|${b.brand ?? ''}`, 'es', { sensitivity: 'base' })
    )),
  };
}

export function tenantVocabularyPrompt(vocabulary) {
  if (!vocabulary?.products?.length) {
    return [
      'No hay un vocabulario publicado disponible para este tenant en este turno. Conserva las hipótesis del mensaje y deja la validación a la herramienta de catálogo.',
    ];
  }
  return [
    'Vocabulario compacto del catálogo de este tenant (solo evidencia para reconocer producto y marca):',
    `catalogVersion: ${vocabulary.catalogVersion ?? 'unknown'}`,
    JSON.stringify(vocabulary.products),
    'Usa este vocabulario para corregir nombres incompletos, errores ortográficos o modismos. No lo trates como disponibilidad, precio, presentación ni selección de SKU: esos hechos los devuelve la herramienta de catálogo.',
  ];
}

function normalizeVocabularyValue(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildContextInterpreterPrompt({ text, customerProfile, conversation, paymentMethods, config }) {
  return [
    'Eres el intérprete contextual de una tienda colombiana por WhatsApp.',
    'Tu única responsabilidad es comprender el acto conversacional actual. No busques productos, no selecciones SKU y no calcules precios.',
    'Devuelve exclusivamente JSON válido con: intent, dialogueAct, productRequestDetected, respondsToPendingQuestion, addsToExistingCart, modifiesExistingCart, explicitHumanRequest, handoffReason, customerDetails, pendingAction, lineUpdates, confidence, greetingReply, customerUnderstanding.',
    'Intents permitidos: greeting, delivery_order, order_clarification, order_confirmation, catalog_query, discount_request, payment_confirmation, human_handoff.',
    ...catalogSemanticGuide(),
    'Usa el historial reciente y el estado de la conversación. Una respuesta breve puede contestar una pregunta previa, seleccionar una variante, indicar pago, confirmar datos o agregar productos.',
    'pendingAction solo puede ser null, continue_checkout, select_payment, confirm_order, adjust_order o request_human. Elígela por el significado del mensaje junto con la última pregunta y el estado del pedido, no por una palabra aislada.',
    'Si la canasta ya está resuelta y el último mensaje de la tienda mostró el resumen con la pregunta de agregar o continuar, una aceptación contextual como «confirmado», «listo», «sí, así está», «con eso» o su equivalente debe usar intent:order_clarification y pendingAction:continue_checkout. Eso termina la recolección y permite preguntar el pago; todavía no confirma ni crea el pedido.',
    'Solo usa pendingAction:confirm_order cuando el medio de pago ya está definido y el cliente acepta el resumen final que pregunta si confirma el pedido. Si el cliente quiere cambiar o añadir productos, usa adjust_order; si pide una persona, request_human.',
    'Usa human_handoff únicamente cuando el cliente pida explícitamente hablar con una persona/tienda, exista un reclamo operativo que requiera intervención o una política obligatoria lo exija. Una baja confianza, un producto no encontrado o una ambigüedad de catálogo no son por sí solos una intención human_handoff: conserva la intención comercial y deja la duda para que el catálogo y el diálogo la resuelvan.',
    'Cuando uses human_handoff, marca explicitHumanRequest:true solo si el cliente lo pidió literalmente o por una expresión equivalente; explica handoffReason. Para una escalación obligatoria de política, explicitHumanRequest puede ser false pero handoffReason debe explicar la restricción.',
    'customerDetails solo incluye nombre o dirección expresados en el mensaje actual; no copies el perfil automáticamente.',
    'lineUpdates solo actualiza líneas existentes del orderDraft cuando el cliente responde sobre ellas. Cada entrada es {lineId, quantity, quantityExplicit, requestedMeasure, requestedWeight, requestedAttributes}. Usa el lineId exacto del borrador. quantity es exclusivamente un número de unidades positivas. Para un peso explícito conserva el texto en requestedMeasure y, si el cliente indicó una unidad inequívoca, usa requestedWeight:{amount:number,unit:"g"|"kg"|"lb"|"arroba"}; nunca lo conviertas en unidades. Si una respuesta como “una de cada una” aplica a varias líneas pendientes, emite una actualización por cada lineId correspondiente.',
    `Identidad y voz: ${JSON.stringify({ name: config.agentName, tone: config.tone, language: config.responseLanguage })}.`,
    JSON.stringify({
      message: text,
      customerProfile,
      conversationContext: conversationContextForStage(conversation),
      orderDraft: conversation?.orderDraft ?? null,
      existingCommercePolicy: conversation?.commercePolicy ?? null,
      paymentMethods: (paymentMethods ?? []).map(({ id, label, aliases }) => ({ id, label, aliases })),
    }),
  ].join('\n');
}

export function buildProductInferencePrompt({ text, contextAnalysis, customerProfile, conversation, config, tenantCatalogVocabulary }) {
  return [
    'Eres el intérprete de productos de una tienda colombiana por WhatsApp.',
    'Solo ejecuta esta etapa cuando la intención tenga relación con productos o una canasta existente.',
    'Devuelve exclusivamente JSON válido con: items, lineUpdates, customerDetails, orderSignals, missingInfo, confidence.',
    'No selecciones SKU, no afirmes disponibilidad y no inventes productos. Entrega hipótesis estructuradas para que una herramienta especializada busque en el catálogo.',
    'Cada item debe tener: lineId, rawText, familyHypothesis, productHypothesis, category, brand, quantity, quantityExplicit, budgetAmount, budgetAmountExplicit, requestedMeasure, requestedWeight, explicitAttributes, inferredAttributes, uncertainties, searchQuery, confidence, skuHint, skuHintSource.',
    'quantityExplicit es true únicamente cuando el cliente expresó la cantidad en este turno. Si la respuesta solo elige una variante de una línea pendiente, no inventes ni cambies la cantidad: usa quantity:null y quantityExplicit:false.',
    'budgetAmountExplicit es true únicamente cuando el cliente expresó un monto en este turno. Si la respuesta solo elige una variante de una línea pendiente que ya era por valor, no inventes ni elimines ese monto: usa budgetAmount:null y budgetAmountExplicit:false.',
    ...catalogSemanticGuide(),
    'Una presentación, marca, sabor o atributo escrito explícitamente es una restricción de búsqueda; lo inferido es evidencia, no filtro absoluto.',
    'Para un pedido por valor usa budgetAmount y no conviertas el valor en cantidad, gramos ni otra cantidad física. El monto representa el total solicitado para esa línea. No exijas presentación salvo que el cliente la haya expresado o sea necesaria para diferenciar variedades reales del catálogo.',
    'Conserva todas las líneas solicitadas, incluso si la conversación contiene varios mensajes o una modificación de la canasta.',
    'Para actualizar cantidad de una línea ya presente en orderDraft, emite lineUpdates con el lineId existente. quantity solo representa unidades positivas. Si el cliente expresó una medida de peso como “media libra”, “250 gramos”, “un kilo” o “una arroba”, conserva el texto en requestedMeasure y emite requestedWeight:{amount:number,unit:"g"|"kg"|"lb"|"arroba"} solamente cuando la unidad sea clara. No la conviertas en unidades ni en una presentación comercial. No conviertas compras por presupuesto a gramos.',
    ...tenantVocabularyPrompt(tenantCatalogVocabulary),
    JSON.stringify({
      message: text,
      contextAnalysis,
      customerProfile,
      conversationContext: conversationContextForStage(conversation),
      orderDraft: conversation?.orderDraft ?? null,
      existingCommercePolicy: conversation?.commercePolicy ?? null,
    }),
  ].join('\n');
}

function conversationContextForStage(conversation) {
  const messages = (conversation?.messages ?? []).filter((message) => ['user', 'agent'].includes(message.role));
  return {
    stage: conversation?.stage ?? null,
    hasAgentReply: messages.some((message) => message.role === 'agent'),
    recentMessages: messages.slice(-8).map((message) => ({ role: message.role, text: String(message.text ?? '').slice(0, 700) })),
    pendingSelection: conversation?.orderDraft?.pendingSelection ?? null,
  };
}
