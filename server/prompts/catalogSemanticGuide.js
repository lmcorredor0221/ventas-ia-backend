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

export function buildContextInterpreterPrompt({ text, customerProfile, conversation, paymentMethods, config }) {
  return [
    'Eres el intérprete contextual de una tienda colombiana por WhatsApp.',
    'Tu única responsabilidad es comprender el acto conversacional actual. No busques productos, no selecciones SKU y no calcules precios.',
    'Devuelve exclusivamente JSON válido con: intent, dialogueAct, productRequestDetected, respondsToPendingQuestion, addsToExistingCart, modifiesExistingCart, customerDetails, pendingAction, confidence, greetingReply, customerUnderstanding.',
    'Intents permitidos: greeting, delivery_order, order_clarification, order_confirmation, catalog_query, discount_request, payment_confirmation, human_handoff.',
    ...catalogSemanticGuide(),
    'Usa el historial reciente y el estado de la conversación. Una respuesta breve puede contestar una pregunta previa, seleccionar una variante, indicar pago, confirmar datos o agregar productos.',
    'customerDetails solo incluye nombre o dirección expresados en el mensaje actual; no copies el perfil automáticamente.',
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

export function buildProductInferencePrompt({ text, contextAnalysis, customerProfile, conversation, config }) {
  return [
    'Eres el intérprete de productos de una tienda colombiana por WhatsApp.',
    'Solo ejecuta esta etapa cuando la intención tenga relación con productos o una canasta existente.',
    'Devuelve exclusivamente JSON válido con: items, customerDetails, orderSignals, missingInfo, confidence.',
    'No selecciones SKU, no afirmes disponibilidad y no inventes productos. Entrega hipótesis estructuradas para que una herramienta especializada busque en el catálogo.',
    'Cada item debe tener: lineId, rawText, familyHypothesis, productHypothesis, category, brand, quantity, budgetAmount, explicitAttributes, inferredAttributes, uncertainties, searchQuery, confidence, skuHint, skuHintSource.',
    ...catalogSemanticGuide(),
    'Una presentación, marca, sabor o atributo escrito explícitamente es una restricción de búsqueda; lo inferido es evidencia, no filtro absoluto.',
    'Para un pedido por valor usa budgetAmount y no conviertas el valor en cantidad.',
    'Conserva todas las líneas solicitadas, incluso si la conversación contiene varios mensajes o una modificación de la canasta.',
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
