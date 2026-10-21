const FRAME_VERSION = 'semantic-frame.v1';
const CANDIDATE_VERSION = 'candidate-set.v1';
const RESOLUTION_VERSION = 'resolution-set.v1';
const GENERIC_PRESENTATION_TOKENS = new Set([
  'mini', 'personal', 'individual', 'familiar', 'grande', 'pequeno', 'pequena',
  'paquete', 'paq', 'presentacion', 'producto', 'ponque',
]);
const QUANTITY_WORD_TOKENS = new Set([
  'un', 'una', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
]);

const INTENTS = new Set([
  'catalog_query',
  'delivery_order',
  'order_clarification',
  'order_confirmation',
  'discount_request',
  'payment_confirmation',
  'human_handoff',
]);

export function semanticFrameFromPlan(plan = {}, { text = '', messageId = null, conversation = null } = {}) {
  const semantic = plan.semanticFrame && typeof plan.semanticFrame === 'object'
    ? plan.semanticFrame
    : plan;
  const rawItems = semantic.items
    ?? semantic.order?.items
    ?? semantic.candidateItems
    ?? [];
  const existingItems = conversation?.orderDraft?.items ?? [];
  const normalizedItems = Array.isArray(rawItems)
    ? rawItems.map((item, index) => normalizeSemanticItem(item, {
      index,
      messageId,
      existingItems,
      text,
    })).filter((item) => item.rawText || item.productHypothesis)
    : [];
  const items = removeSubsumedSemanticItems(normalizedItems, text);
  const customerDelta = normalizeCustomerDelta(semantic.customerDelta ?? semantic.order ?? {});
  const intent = normalizeIntent(semantic.intent);
  const missingCustomerFields = normalizeMissingCustomerFields(
    semantic.missingCustomerFields ?? semantic.missingFields ?? [],
  );

  return {
    schemaVersion: FRAME_VERSION,
    intent,
    conversationAct: normalizeConversationAct(semantic.conversationAct, intent, conversation),
    delivery: Boolean(semantic.delivery ?? semantic.order?.delivery ?? semantic.customerUnderstanding?.delivery ?? containsDeliveryText(text)),
    customerDelta,
    items,
    missingCustomerFields,
    confidence: normalizeConfidence(semantic.confidence, items),
  };
}

export function semanticFrameToLegacyPlan(frame, { sourcePlan = {} } = {}) {
  const normalized = semanticFrameFromPlan(frame, { text: frame?.customerDelta?.rawNeed ?? '' });
  const items = normalized.items.map((item) => ({
    rawItemId: item.rawItemId,
    // El adaptador no decide comercio; conserva las señales que extrajo el
    // interprete para que el resolutor las contraste con el catalogo del tenant.
    rawText: item.rawText,
    rawName: item.rawText,
    retrievalText: item.retrievalText,
    productHypothesis: item.productHypothesis,
    catalogQuery: item.productHypothesis || item.rawText,
    brandHint: item.brandHint,
    quantity: item.quantity,
    budgetAmount: item.budgetAmount,
    requestedPresentation: item.presentationSignal,
    presentationSignal: item.presentationSignal,
    categoryHint: item.categoryHint,
    occasion: item.occasion,
    attributes: item.attributes,
    confidence: item.confidence,
    ambiguityReason: item.ambiguity,
  }));
  const missingFields = unique([
    ...normalized.missingCustomerFields,
    ...(normalized.intent === 'delivery_order'
      ? items.filter((item) => !hasQuantityOrBudget(item)).map((item) => `quantity:${item.catalogQuery}`)
      : []),
  ]);

  return {
    ...sourcePlan,
    intent: normalized.intent,
    reasoningMode: 'shopkeeper_guided_sale',
    customerUnderstanding: {
      rawNeed: normalized.customerDelta.rawNeed ?? sourcePlan.customerUnderstanding?.rawNeed ?? '',
      delivery: normalized.delivery,
      certainty: normalized.confidence >= 0.8 ? 'high' : normalized.confidence >= 0.55 ? 'medium' : 'low',
    },
    candidateItems: items,
    order: {
      delivery: normalized.delivery,
      items,
      paymentMethod: normalized.customerDelta.paymentPreference,
    },
    // La compatibilidad conserva el campo durante la migracion, pero nunca
    // acepta un plan de herramientas o una referencia comercial del LLM.
    toolPlan: [],
    recommendedTools: recommendedToolsForIntent(normalized.intent),
    missingFields,
    missingInfo: missingFields,
    responseStrategy: responseStrategyForIntent(normalized.intent, missingFields),
    confidence: normalized.confidence,
    semanticFrame: normalized,
  };
}

// El catalogo parte de las palabras del cliente, que son las que pueden
// coincidir con aliases, abreviaturas o errores ortograficos de cada tenant.
// Un retrievalText solo puede complementar esa consulta cuando cada termino
// significativo de la hipotesis tambien esta escrito por el cliente. No decide
// una referencia: conserva calificativos que el interprete separo del item.
export function catalogSearchTextForItem(item = {}) {
  return nullableString(item.retrievalText)
    ?? nullableString(item.rawText ?? item.rawName)
    ?? nullableString(item.productHypothesis ?? item.catalogQuery ?? item.name)
    ?? '';
}

// La IA puede extraer datos del lenguaje natural, pero la obligatoriedad del
// pedido pertenece a la politica del tenant. Asi un modelo que omite un campo
// nunca permite confirmar un domicilio incompleto.
export function requiredCustomerFields({ requiredFields = [], delivery = false, customerProfile = null, customerDelta = {} } = {}) {
  const required = new Set((Array.isArray(requiredFields) ? requiredFields : [])
    .map((field) => normalize(field).replace(/\s+/g, '')));
  const name = nullableString(customerDelta?.name ?? customerProfile?.name);
  const address = nullableString(customerDelta?.address ?? customerProfile?.defaultAddress);
  const missing = [];
  if (required.has('name') && !name) missing.push('customer_name');
  if (delivery && (required.has('defaultaddress') || required.has('address')) && !address) {
    missing.push('delivery_address');
  }
  return missing;
}

// La conversacion avanza de a una necesidad comercial. El borrador conserva
// todos los campos pendientes, pero la respuesta no debe pedir pago mientras
// aun falta una cantidad, una variante o un dato de entrega.
export function nextInteractionMissingFields(fields = []) {
  const missing = unique(Array.isArray(fields) ? fields : []);
  const product = missing.filter((field) => field.startsWith('product:') || field.startsWith('stock:'));
  if (product.length) return product;
  if (missing.includes('order_items')) return ['order_items'];
  const presentation = missing.filter((field) => field.startsWith('presentation:'));
  if (presentation.length) return presentation;
  const quantity = missing.filter((field) => field.startsWith('quantity:'));
  if (quantity.length) return quantity;
  const customer = missing.filter((field) => field === 'customer_name' || field === 'delivery_address');
  if (customer.length) return customer;
  return missing.includes('payment_method') ? ['payment_method'] : [];
}

export function buildCandidateSet({ item, rows = [] } = {}) {
  const candidates = (rows ?? []).map((row) => {
    const presentation = row.presentation ?? row.normalizedPresentation ?? inferPresentationFromName(row.name);
    const product = presentation && !row.presentation ? { ...row, presentation } : row;
    return {
      sku: row.sku ?? null,
      name: row.name ?? null,
      family: productFamilyForCandidate(row),
      presentation,
      price: numberOrNull(row.price),
      stock: Number(row.stock ?? 0),
      active: row.active !== false,
      score: Number(row.matchScore ?? 0),
      matchType: row.matchType ?? 'unknown',
      evidence: candidateEvidence(product),
      product,
    };
  });
  return {
    schemaVersion: CANDIDATE_VERSION,
    rawItemId: item?.rawItemId ?? null,
    query: {
      rawText: item?.rawText ?? item?.rawName ?? '',
      productHypothesis: item?.productHypothesis ?? item?.catalogQuery ?? '',
      presentationSignal: item?.presentationSignal ?? item?.requestedPresentation ?? null,
      categoryHint: item?.categoryHint ?? null,
    },
    candidates,
  };
}

export function resolveCatalogItem({ item = {}, rows = [] } = {}) {
  const candidateSet = buildCandidateSet({ item, rows });
  const quantity = Number(item.quantity ?? 1) || 1;
  const active = candidateSet.candidates.filter((candidate) => candidate.active);
  const withStock = active.filter((candidate) => candidate.stock >= quantity);
  const presentationSignal = item.presentationSignal ?? item.requestedPresentation ?? null;
  const explicitMeasure = presentationMeasure(presentationSignal);
  const presentationCompatible = explicitMeasure
    ? withStock.filter((candidate) => presentationMatches(candidate.product, explicitMeasure))
    : withStock;
  const compatible = filterCandidatesByExplicitSignals(presentationCompatible, item);
  const base = {
    schemaVersion: RESOLUTION_VERSION,
    rawItemId: item.rawItemId ?? null,
    candidateSet,
  };

  if (!active.length) {
    return { ...base, status: 'unavailable', reason: 'no_active_candidate', options: [] };
  }
  if (!withStock.length) {
    return { ...base, status: 'unavailable', reason: 'insufficient_stock', options: active.slice(0, 10) };
  }
  if (!compatible.length) {
    return { ...base, status: 'unavailable', reason: 'presentation_not_available', options: withStock.slice(0, 10) };
  }

  const ranked = [...compatible].sort((left, right) => right.score - left.score || right.stock - left.stock);
  const best = ranked[0];
  const sameVariant = ranked.filter((candidate) => candidatesShareVariantIdentity(best, candidate));
  if (best.score > 0 && best.score < 6) {
    return { ...base, status: 'human_review', reason: 'low_retrieval_evidence', options: ranked.slice(0, 10) };
  }
  // Una coincidencia parcial no autoriza una sustitucion. Si el cliente pidio
  // un atributo que ninguna evidencia del producto respalda ("ponque Ramo
  // mora" frente a Chocoramo), el tendero debe decidir la alternativa.
  if (unmatchedCustomerTerms(best, item).length) {
    return { ...base, status: 'human_review', reason: 'unmatched_customer_qualifier', options: ranked.slice(0, 10) };
  }

  if (explicitMeasure && ranked.length === 1) {
    return resolved(base, best, 'explicit_presentation_match');
  }
  if (ranked.length === 1) {
    return resolved(base, best, 'single_compatible_candidate');
  }

  const exactEvidence = ranked.filter((candidate) => candidate.matchType === 'exact_or_alias');
  if (best.matchType === 'exact_or_alias' && exactEvidence.length === 1) {
    return resolved(base, best, 'exact_catalog_evidence');
  }

  // Un calificativo escrito por el comprador (por ejemplo, "blanco" frente a
  // "integral") puede identificar una sola referencia aun cuando el resto de
  // la familia tenga coincidencias amplias de nombre o marca. Es evidencia del
  // catalogo, no una eleccion de SKU hecha por el LLM.
  if (best.matchType === 'exact_or_alias' && hasDistinctiveCustomerEvidence(best, ranked, item)) {
    return resolved(base, best, 'distinctive_customer_evidence');
  }

  const canonical = resolveUnqualifiedCanonicalVariant(sameVariant, item);
  if (canonical) return resolved(base, canonical, 'unqualified_canonical_variant');

  const contextual = resolveContextualPresentation(sameVariant, presentationSignal);
  if (contextual) return resolved(base, contextual, 'contextual_presentation_evidence');

  if (candidatesAreSelectableVariants(sameVariant)) {
    return {
      ...base,
      status: 'needs_selection',
      reason: 'multiple_customer_selectable_variants',
      options: sameVariant.slice(0, 10),
    };
  }

  const second = ranked[1];
  if (best.score >= 7 && best.score - second.score >= 3) {
    return resolved(base, best, 'clear_retrieval_margin');
  }

  return {
    ...base,
    status: 'human_review',
    reason: 'ambiguous_or_cross_family_candidates',
    options: ranked.slice(0, 10),
  };
}

export function advanceOrderDraft(draft = {}, patch = {}) {
  const previous = structuredClone(draft ?? {});
  const next = {
    ...previous,
    ...structuredClone(patch ?? {}),
    items: patch.items ?? previous.items ?? [],
  };
  next.subtotal = next.items.reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0);
  next.version = Number(previous.version ?? 0) + 1;
  return next;
}

export function isCurrentDraftVersion(draft, version) {
  return Number(draft?.version ?? 0) === Number(version ?? 0);
}

function normalizeSemanticItem(item = {}, { index, messageId, existingItems, text }) {
  const plannerRawText = String(item.rawText ?? item.rawName ?? item.name ?? item.catalogQuery ?? '').trim();
  // Una aclaracion puede transportar el borrador completo. Cuando conserva el
  // rawItemId, ese item ya pertenece a la conversacion y su texto original no
  // puede sustituirse por el ultimo mensaje (p. ej. "sin el agua").
  const existingById = item.rawItemId
    ? existingItems.find((candidate) => candidate.rawItemId === item.rawItemId)
    : null;
  const rawText = existingById?.rawText ?? preserveCustomerRawText(plannerRawText, text);
  const productHypothesis = nullableString(item.productHypothesis ?? item.catalogQuery ?? item.name ?? rawText);
  const retrievalText = evidenceBackedRetrievalText(productHypothesis, text)
    // semanticFrameToLegacyPlan vuelve a normalizar un frame ya validado. Si
    // no recibe el mensaje original, conserva solamente la pista que el frame
    // anterior ya sometio a la comprobacion de evidencia.
    ?? (!String(text ?? '').trim() ? nullableString(item.retrievalText) : null);
  const matchingExisting = existingById ?? existingItems.find((candidate) => sameRequestedNeed(candidate, { rawText, productHypothesis }));
  const presentationSignal = nullableString(
    item.presentationSignal
    ?? item.requestedPresentation
    ?? item.presentation
    ?? explicitPresentationSignal(rawText)
    ?? explicitPresentationSignal(productHypothesis),
  );
  const requestedQuantity = positiveNumberOrNull(item.quantity);
  return {
    rawItemId: item.rawItemId ?? matchingExisting?.rawItemId ?? generatedRawItemId(messageId, index),
    rawText,
    retrievalText,
    productHypothesis,
    brandHint: nullableString(item.brandHint ?? item.brand),
    categoryHint: nullableString(item.categoryHint ?? item.category),
    quantity: isBundlePresentationWithoutQuantity(rawText, presentationSignal, requestedQuantity) ? null : requestedQuantity,
    budgetAmount: positiveNumberOrNull(item.budgetAmount),
    // El texto del cliente se conserva intacto. Cuando el interprete ya
    // expreso una medida normalizada en su hipotesis (por ejemplo, "coca 350"
    // -> "Coca-Cola 350ml"), esa medida sigue siendo una restriccion del
    // cliente, no una seleccion de SKU.
    presentationSignal,
    occasion: nullableString(item.occasion),
    attributes: item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes) ? item.attributes : {},
    confidence: normalizeConfidence(item.confidence),
    ambiguity: nullableString(item.ambiguity ?? item.ambiguityReason ?? item.reason),
  };
}

function preserveCustomerRawText(value, sourceText) {
  const supplied = String(value ?? '').trim();
  const source = String(sourceText ?? '').trim();
  if (!source || !supplied) return supplied || source;
  if (normalize(source).includes(normalize(supplied))) return supplied;
  const sourceTerms = normalize(source).split(/\s+/).filter(Boolean);
  const suppliedTerms = normalize(supplied).split(/\s+/).filter(Boolean);
  return suppliedTerms.length && suppliedTerms.every((term) => sourceTerms.some((sourceTerm) => sameEvidenceTerm(sourceTerm, term)))
    ? supplied
    : source;
}

function evidenceBackedRetrievalText(hypothesis, sourceText) {
  const candidate = nullableString(hypothesis);
  const sourceTokens = normalize(sourceText).split(/\s+/).filter(Boolean);
  if (!candidate || !sourceTokens.length) return null;

  const meaningfulTerms = normalize(candidate)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !GENERIC_PRESENTATION_TOKENS.has(term) && !/^\d/.test(term));
  if (!meaningfulTerms.length || !meaningfulTerms.every((term) => sourceTokens.some((sourceTerm) => sameEvidenceTerm(sourceTerm, term)))) return null;
  return candidate;
}

function sameEvidenceTerm(left, right) {
  const leftForms = evidenceTermForms(left);
  const rightForms = evidenceTermForms(right);
  return leftForms.some((form) => rightForms.includes(form));
}

function evidenceTermForms(value) {
  const term = String(value ?? '');
  const forms = [term];
  if (term.length > 3 && term.endsWith('s')) forms.push(term.slice(0, -1));
  if (term.length > 4 && term.endsWith('es')) forms.push(term.slice(0, -2));
  return forms;
}

function removeSubsumedSemanticItems(items = [], sourceText = '') {
  return items.filter((item, index, all) => !all.some((candidate, candidateIndex) => (
    candidateIndex !== index
    && isSubsumedSemanticItem(item, candidate, sourceText)
  )));
}

function isSubsumedSemanticItem(item, candidate, sourceText) {
  const itemTerms = meaningfulItemTerms(item.rawText);
  const candidateTerms = meaningfulItemTerms(candidate.rawText);
  if (!itemTerms.length || candidateTerms.length <= itemTerms.length) return false;
  const containedBySpecificRequest = itemTerms.every((term) => candidateTerms.some((candidateTerm) => sameEvidenceTerm(term, candidateTerm)));
  if (!containedBySpecificRequest) return false;

  if (!item.quantity && !item.budgetAmount && !item.presentationSignal) return true;

  // Si el modelo produjo una alternativa generica sin respaldo literal junto
  // a una solicitud mas especifica respaldada por el mensaje, se descarta la
  // primera. Dos menciones independientes ("Coca-Cola y Coca-Cola Zero") se
  // conservan para que el resolutor no pierda una linea real del pedido.
  return Boolean(candidate.retrievalText)
    && !item.retrievalText
    && sourceMentionsOnlyOnce(sourceText, item.rawText);
}

function meaningfulItemTerms(value) {
  return normalize(value)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !GENERIC_PRESENTATION_TOKENS.has(term) && !/^\d/.test(term));
}

function sourceMentionsOnlyOnce(sourceText, phrase) {
  const source = ` ${normalize(sourceText)} `;
  const needle = ` ${normalize(phrase)} `;
  if (needle.trim().length < 3) return false;
  const first = source.indexOf(needle);
  return first >= 0 && source.indexOf(needle, first + needle.length) < 0;
}

function isBundlePresentationWithoutQuantity(rawText, presentationSignal, quantity) {
  const bundle = String(presentationSignal ?? '').match(/\bx\s*(\d{1,3})\b/i);
  if (!bundle || Number(quantity) !== Number(bundle[1])) return false;
  return !/^\s*(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(String(rawText ?? ''));
}

function normalizeCustomerDelta(value = {}) {
  return {
    name: nullableString(value.name ?? value.customerName),
    address: nullableString(value.address ?? value.deliveryAddress ?? value.defaultAddress),
    paymentPreference: nullableString(value.paymentPreference ?? value.paymentMethod),
    rawNeed: nullableString(value.rawNeed),
  };
}

function normalizeMissingCustomerFields(fields) {
  return unique((Array.isArray(fields) ? fields : [])
    .map((field) => String(field ?? '').trim())
    .filter((field) => ['customer_name', 'delivery_address', 'payment_method'].includes(field)));
}

function normalizeIntent(value) {
  const normalized = normalize(value).replace(/\s+/g, '_');
  if (INTENTS.has(normalized)) return normalized;
  if (/(pedido|domicilio|orden)/.test(normalized)) return 'delivery_order';
  if (/(aclar|clarif)/.test(normalized)) return 'order_clarification';
  if (/(confirm)/.test(normalized)) return 'order_confirmation';
  if (/(humano|asesor)/.test(normalized)) return 'human_handoff';
  return 'catalog_query';
}

function normalizeConversationAct(value, intent, conversation) {
  const normalized = normalize(value).replace(/\s+/g, '_');
  if (['new_request', 'add_item', 'clarify', 'confirm', 'support'].includes(normalized)) return normalized;
  if (intent === 'order_confirmation') return 'confirm';
  if (intent === 'order_clarification' || conversation?.orderDraft) return 'clarify';
  if (intent === 'human_handoff') return 'support';
  return 'new_request';
}

function normalizeConfidence(value, items = []) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0 && number <= 1) return Number(number.toFixed(2));
  const fromItems = items.length
    ? items.reduce((sum, item) => sum + Number(item.confidence ?? 0.7), 0) / items.length
    : 0.7;
  return Number(Math.min(1, Math.max(0, fromItems)).toFixed(2));
}

function recommendedToolsForIntent(intent) {
  if (intent === 'human_handoff') return ['human_handoff', 'whatsapp_business_messaging'];
  if (intent === 'order_confirmation') return ['google_sheets_order_write', 'human_handoff', 'whatsapp_business_messaging'];
  if (intent === 'delivery_order' || intent === 'catalog_query') return ['google_sheets_read_table', 'whatsapp_business_messaging'];
  return ['whatsapp_business_messaging'];
}

function responseStrategyForIntent(intent, missingFields) {
  if (intent === 'human_handoff') return 'handoff';
  if (intent === 'order_confirmation') return 'transactional_write';
  if (intent === 'delivery_order') return missingFields.length ? 'ask_clarification' : 'quote';
  return 'guide';
}

function candidateEvidence(row) {
  const evidence = [];
  if (row.matchType === 'exact_or_alias') evidence.push('name_or_alias');
  if (row.description) evidence.push('description');
  if (row.productFamily) evidence.push('family');
  if (row.presentation || row.normalizedPresentation) evidence.push('presentation');
  return evidence;
}

function productFamilyForCandidate(row) {
  if (row.productFamily || row.family) return row.productFamily ?? row.family;
  const normalized = normalize(`${row.brand ?? ''} ${row.name ?? ''}`)
    .replace(/\b\d+(?:\s+\d+)?(?:[.,]\d+)?\s*(?:ml|l|g|kg|und|unidad|unidades)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || row.name || row.brand || null;
}

function inferPresentationFromName(name) {
  const match = String(name ?? '').match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg|und|unidad(?:es)?|rollo(?:s)?)(?:\b|$)/i);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  return `${match[1]} ${unit === 'l' ? 'L' : unit}`;
}

function explicitPresentationSignal(value) {
  const count = String(value ?? '').match(/\bx\s*(\d{1,3})\b/i);
  if (count) return `x${count[1]}`;
  const match = String(value ?? '').match(/(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|l|litros?|g|gr|gramos?|kg|kilogramos?|und|unidades?|rollo(?:s)?)(?:\b|$)/i);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

function resolved(base, candidate, reason) {
  return {
    ...base,
    status: 'resolved',
    reason,
    product: candidate.product,
    options: [],
  };
}

function candidatesAreSelectableVariants(candidates) {
  if (candidates.length < 2) return false;
  const presentations = new Set(candidates.map((candidate) => normalize(candidate.presentation)).filter(Boolean));
  return presentations.size > 1 && candidates.every((candidate, index) => (
    index === 0 || candidatesShareVariantIdentity(candidates[0], candidate)
  ));
}

// Si el cliente dice el nombre base y en el catalogo existe una referencia base
// junto con presentaciones modificadas (mini, familiar, personal), la referencia
// sin modificador es la mejor evidencia. No aplica cuando el cliente si escribio
// uno de esos modificadores o cuando hay dos referencias base igual de plausibles.
function resolveUnqualifiedCanonicalVariant(candidates, item) {
  if (!candidatesAreSelectableVariants(candidates)) return null;
  const requested = normalize(item?.rawText ?? item?.rawName);
  if (hasRequestedVariantModifier(requested)) return null;
  const canonical = candidates.filter((candidate) => !hasCandidateVariantModifier(candidate));
  return canonical.length === 1 ? canonical[0] : null;
}

function hasDistinctiveCustomerEvidence(best, ranked, item) {
  const tokens = normalize(item?.rawText ?? item?.rawName)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GENERIC_PRESENTATION_TOKENS.has(token));
  if (!tokens.length) return false;
  const bestText = candidateText(best);
  const alternatives = ranked.filter((candidate) => candidate !== best);
  return tokens.some((token) => (
    bestText.includes(token) &&
    !alternatives.some((candidate) => candidateText(candidate).includes(token))
  ));
}

function unmatchedCustomerTerms(candidate, item) {
  const requested = normalize(item?.retrievalText ?? item?.rawText ?? item?.rawName)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !GENERIC_PRESENTATION_TOKENS.has(token) && !QUANTITY_WORD_TOKENS.has(token) && !/^x\d/.test(token) && !/^\d/.test(token));
  if (!requested.length) return [];
  const available = candidateText(candidate).split(/\s+/).filter(Boolean);
  return requested.filter((term) => !available.some((token) => evidenceTermsMatch(token, term)));
}

function evidenceTermsMatch(left, right) {
  if (sameEvidenceTerm(left, right)) return true;
  if (left.length < 5 || right.length < 5) return false;
  return levenshteinDistance(left, right) <= (Math.max(left.length, right.length) >= 8 ? 2 : 1);
}

function levenshteinDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + Number(left[row - 1] !== right[column - 1]),
      );
    }
  }
  return rows[left.length][right.length];
}

function hasRequestedVariantModifier(value) {
  return ['mini', 'personal', 'individual', 'familiar', 'grande', 'pequeno', 'pequena']
    .some((token) => new RegExp(`\\b${token}\\b`).test(value));
}

function hasCandidateVariantModifier(candidate) {
  const name = normalize(candidate?.product?.name ?? candidate?.name);
  return hasRequestedVariantModifier(name);
}

function filterCandidatesByExplicitSignals(candidates, item) {
  let filtered = candidates;
  const brand = normalize(item?.brandHint);
  if (brand) {
    const brandMatches = filtered.filter((candidate) => candidateText(candidate).includes(brand));
    if (brandMatches.length) filtered = brandMatches;
  }
  const qualifierPhrases = explicitQualifierPhrases(item);
  if (qualifierPhrases.length) {
    const qualifierMatches = filtered.filter((candidate) => {
      const text = candidateText(candidate);
      return qualifierPhrases.every((phrase) => text.includes(phrase));
    });
    if (qualifierMatches.length) filtered = qualifierMatches;
  }
  return filtered;
}

function explicitQualifierPhrases(item) {
  const raw = normalize(item?.rawText ?? item?.rawName);
  if (!raw) return [];
  return [
    'sin gas', 'con gas', 'sin azucar', 'con azucar', 'deslactosada', 'entera',
    'light', 'zero', 'original',
  ].filter((phrase) => raw.includes(phrase));
}

function candidateText(candidate) {
  const product = candidate?.product ?? candidate ?? {};
  return normalize([
    product.brand,
    product.name,
    product.presentation,
    product.normalizedPresentation,
    product.description,
    ...(product.aliases ?? []),
    ...(product.tags ?? []),
  ].filter(Boolean).join(' '));
}

function candidatesShareVariantIdentity(left, right) {
  const leftExplicit = nullableString(left?.product?.variantGroup ?? left?.variantGroup);
  const rightExplicit = nullableString(right?.product?.variantGroup ?? right?.variantGroup);
  if (leftExplicit || rightExplicit) {
    return Boolean(leftExplicit && rightExplicit && normalize(leftExplicit) === normalize(rightExplicit));
  }
  const leftTokens = productIdentityTokens(left?.product ?? left);
  const rightTokens = productIdentityTokens(right?.product ?? right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const shared = leftTokens.filter((token) => rightTokens.includes(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return shared.length / union.size >= 0.5;
}

function productIdentityTokens(product = {}) {
  return normalize(product.name)
    .replace(/\b\d+(?:\s+\d+)?(?:[.,]\d+)?\s*(?:ml|l|g|kg|und|unidad|unidades)\b/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !GENERIC_PRESENTATION_TOKENS.has(token));
}

function resolveContextualPresentation(candidates, signal) {
  const preference = contextualPreference(signal);
  if (!preference || candidates.length < 2) return null;
  if (!candidatesAreSelectableVariants(candidates)) return null;
  const measured = candidates
    .map((candidate) => ({ candidate, measure: presentationMeasure(candidate.presentation) }))
    .filter((entry) => entry.measure);
  if (measured.length !== candidates.length) return null;
  const dimensions = new Set(measured.map((entry) => entry.measure.dimension));
  if (dimensions.size !== 1) return null;
  const sorted = [...measured].sort((left, right) => preference === 'larger'
    ? right.measure.value - left.measure.value
    : left.measure.value - right.measure.value);
  if (sorted[0].measure.value === sorted[1].measure.value) return null;
  return sorted[0].candidate;
}

function contextualPreference(signal) {
  const normalized = normalize(signal).replace(/\s+/g, '_');
  if (['familiar', 'para_compartir', 'compartir', 'grande'].includes(normalized)) return 'larger';
  if (['personal', 'individual', 'para_mi', 'lonchera', 'pequeno'].includes(normalized)) return 'smaller';
  return null;
}

function presentationMatches(product, requested) {
  const actual = presentationMeasure(product.normalizedPresentation ?? product.presentation ?? product.name);
  return Boolean(actual && actual.dimension === requested.dimension && actual.value === requested.value);
}

function presentationMeasure(value) {
  const normalized = normalize(value)
    .replace(/un litro y medio/g, '1 5 l')
    .replace(/medio kilo/g, '500 g')
    .replace(/medio litro/g, '0 5 l');
  const count = normalized.match(/\bx\s*(\d{1,3})\b/);
  if (count) return { dimension: 'count', value: Number(count[1]) };
  const match = normalized.match(/(\d+(?:\s+\d+)?(?:[.,]\d+)?)\s*(ml|l|g|kg|und|unidad|unidades|rollo|rollos)\b/);
  if (!match) return null;
  const numeric = Number(match[1].replace(/\s+/, '.').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  const unit = match[2];
  if (unit === 'l') return { dimension: 'volume', value: numeric * 1000 };
  if (unit === 'ml') return { dimension: 'volume', value: numeric };
  if (unit === 'kg') return { dimension: 'weight', value: numeric * 1000 };
  if (unit === 'g') return { dimension: 'weight', value: numeric };
  return { dimension: 'count', value: numeric };
}

function sameRequestedNeed(existing, incoming) {
  const left = normalize(existing.rawName ?? existing.catalogQuery ?? existing.product?.name);
  const right = normalize(incoming.productHypothesis ?? incoming.rawText);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function generatedRawItemId(messageId, index) {
  const stableMessageId = normalize(messageId || 'message').replace(/\s+/g, '-').slice(0, 80) || 'message';
  return `turn-${stableMessageId}:item-${index + 1}`;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasQuantityOrBudget(item) {
  return Number(item.quantity ?? 0) > 0 || Number(item.budgetAmount ?? 0) > 0;
}

function nullableString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function containsDeliveryText(value) {
  return /\b(domicilio|envio|llevar|traer)\b/.test(normalize(value));
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
