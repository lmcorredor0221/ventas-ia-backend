import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { platformLlmConfig } from './platformService.js';
import { semanticFrameFromPlan, semanticFrameToLegacyPlan } from '../domain/semanticContracts.js';

const NUMBER_WORDS = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
};

const STOPWORDS = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'domicilio',
  'el',
  'en',
  'envio',
  'envío',
  'estoy',
  'comprar',
  'comer',
  'hay',
  'que',
  'la',
  'las',
  'lo',
  'los',
  'algo',
  'manejan',
  'maneja',
  'manejas',
  'me',
  'colabora',
  'colabore',
  'favor',
  'para',
  'pa',
  'pal',
  'parce',
  'por',
  'quiero',
  'recomienda',
  'regalas',
  'regala',
  'veci',
  'vecino',
  'vecina',
  'tiene',
  'tienes',
  'un',
  'una',
  'ven',
  'venden',
  'y',
]);

export class LLMPlanner {
  constructor({ store, events, usage, config }) {
    this.store = store;
    this.events = events;
    this.usage = usage;
    this.config = config;
  }

  async plan({ tenantId, conversationId, normalized, customerProfile, conversation }) {
    const startedAt = Date.now();
    const tenant = await this.getTenant(tenantId);
    const platformConfig = platformLlmConfig(this.store.getState());
    const config = {
      timeoutMs: this.config?.llmRequestTimeoutMs,
      maxTokens: this.config?.llmMaxTokens,
      ...platformConfig,
      responseLanguage: tenant?.config?.agentPolicy?.responseLanguage ?? platformConfig.responseLanguage,
      tone: tenant?.config?.agentPolicy?.tone,
    };
    if (process.env.LLM_SIMULATOR) config.simulator = process.env.LLM_SIMULATOR;
    const products = await this.listProducts(tenantId);
    const text = normalized.text ?? '';
    const provider = config.provider ?? 'deepseek';
    let executionMode = 'mock_structured_fallback';
    let parsed;
    let providerMetadata = null;
    try {
      if (provider === 'deepseek' && config.simulator === 'codex_cli') {
        const cliResult = await callCodexCli({ config, prompt: buildCodexCliPlannerPrompt({ text, customerProfile, conversation, products }) });
        parsed = {
          ...cliResult.plan,
          simulatedBy: 'codex_cli',
          simulationScope: 'desktop_test_only',
          reasoningNotes: buildCodexReasoningNotes({ text, plan: cliResult.plan, customerProfile }),
        };
        providerMetadata = cliResult.providerMetadata;
        executionMode = 'codex_cli_simulated_deepseek';
      } else if (provider === 'deepseek' && config.simulator === 'codex') {
        parsed = this.codexSimulatedDeepSeekParse({ tenantId, text, customerProfile, conversation, products });
        providerMetadata = { simulated: true, simulator: 'codex' };
        executionMode = 'codex_simulated_deepseek';
      } else {
        const apiResult = await this.apiStructuredParse({ tenantId, text, customerProfile, conversation, config, products });
        parsed = apiResult.plan;
        providerMetadata = apiResult.providerMetadata;
        executionMode = 'provider_api';
      }
    } catch (error) {
      parsed = this.mockStructuredParse({ tenantId, text, customerProfile, conversation, products });
      executionMode = provider === 'mock' ? 'mock_structured' : 'mock_structured_fallback';
      this.events.emit({
        type: 'llm.plan.fallback',
        tenantId,
        conversationId,
        detail: `${provider} unavailable: ${error.message}`,
        metadata: { provider, model: config.model, simulator: config.simulator },
      });
    }
    // El modelo interpreta lenguaje y conserva la incertidumbre. La ruta que
    // decide catalogo, precio, stock y herramientas recibe un adaptador sin
    // SKU ni filtros sugeridos por el modelo.
    const semanticFrame = semanticFrameFromPlan(parsed, {
      text,
      messageId: normalized.messageId,
      conversation,
    });
    const compatiblePlan = semanticFrameToLegacyPlan(semanticFrame, { sourcePlan: parsed });
    const coerced = coercePlanWithConversation(compatiblePlan, { text, conversation });
    const enriched = enrichPlannerOutput(coerced, text);
    const plan = {
      schemaVersion: 'ventas-ia-llm-plan.v2',
      provider,
      model: config.model ?? defaultModel(provider),
      mode: config.mode ?? 'json_schema',
      executionMode,
      confidence: enriched.confidence,
      ...enriched,
      semanticFrame: {
        ...semanticFrame,
        intent: enriched.intent,
        delivery: Boolean(enriched.order?.delivery),
      },
    };
    this.events.emit({
      type: 'llm.plan.created',
      tenantId,
      conversationId,
      detail: `${plan.intent} via ${plan.provider}/${plan.model}`,
      metadata: {
        mode: plan.mode,
        recommendedTools: plan.recommendedTools,
        missingFields: plan.missingFields,
        semanticFrameVersion: plan.semanticFrame?.schemaVersion,
        providerMetadata,
        durationMs: Date.now() - startedAt,
      },
    });
    this.usage?.recordLlmPlan(tenantId, {
      providerMetadata,
      inputText: text,
      outputPlan: plan,
      executionMode,
      conversationId,
      stage: 'planner',
      durationMs: Date.now() - startedAt,
    });
    return plan;
  }

  async apiStructuredParse({ text, customerProfile, conversation, config, products }) {
    if ((config.provider ?? 'deepseek') === 'mock') throw new Error('mock provider selected');
    const apiKey = resolveSecret(config.apiKeyRef, defaultKeyNames(config.provider));
    if (!apiKey) throw new Error(`missing API key env ${config.apiKeyRef ?? defaultKeyNames(config.provider).join('/')}`);
    const prompt = buildPlannerPrompt({ text, customerProfile, conversation, products, config });

    if (config.provider === 'google') return retryTransientProviderCall(() => callGemini({ config, apiKey, prompt }));
    return retryTransientProviderCall(() => callChatCompletions({ config, apiKey, prompt }));
  }

  async composeReply({ tenantId, conversationId, facts, fallbackText }) {
    const startedAt = Date.now();
    const tenant = await this.getTenant(tenantId);
    const platformConfig = platformLlmConfig(this.store.getState());
    const config = {
      timeoutMs: this.config?.llmRequestTimeoutMs,
      maxTokens: Math.min(Number(this.config?.llmMaxTokens ?? 350), 500),
      ...platformConfig,
      responseLanguage: tenant?.config?.agentPolicy?.responseLanguage ?? platformConfig.responseLanguage,
      tone: tenant?.config?.agentPolicy?.tone ?? 'tendero_colombiano',
    };
    if (process.env.LLM_SIMULATOR) config.simulator = process.env.LLM_SIMULATOR;
    const provider = config.provider ?? 'deepseek';
    const canCompose = this.config?.llmResponseComposerEnabled
      && !config.simulator
      && provider !== 'mock';
    if (!canCompose) {
      return { text: fallbackText, executionMode: 'deterministic_fallback', providerMetadata: null };
    }
    try {
      const apiKey = resolveSecret(config.apiKeyRef, defaultKeyNames(provider));
      if (!apiKey) throw new Error(`missing API key env ${config.apiKeyRef ?? defaultKeyNames(provider).join('/')}`);
      const prompt = buildReplyPrompt({ facts, fallbackText, config });
      const result = provider === 'google'
        ? await retryTransientProviderCall(() => callGeminiReply({ config, apiKey, prompt }))
        : await retryTransientProviderCall(() => callChatReply({ config, apiKey, prompt }));
      const text = validateComposedReply(result.text, { facts, fallbackText });
      this.events.emit({
        type: 'llm.reply.composed',
        tenantId,
        conversationId,
        detail: `Customer reply composed via ${result.providerMetadata.provider}/${result.providerMetadata.model}`,
        metadata: { providerMetadata: result.providerMetadata, voice: normalizeVoiceProfile(config.tone), durationMs: Date.now() - startedAt },
      });
      this.usage?.recordLlmPlan(tenantId, {
        providerMetadata: result.providerMetadata,
        inputText: prompt,
        outputPlan: { reply: text },
        executionMode: 'provider_api',
        conversationId,
        stage: 'composer',
        durationMs: Date.now() - startedAt,
      });
      return { text, executionMode: 'provider_api', providerMetadata: result.providerMetadata };
    } catch (error) {
      this.events.emit({
        type: 'llm.reply.fallback',
        tenantId,
        conversationId,
        detail: `${provider} reply composer unavailable: ${error.message}`,
        metadata: { provider, model: config.model, voice: normalizeVoiceProfile(config.tone) },
      });
      return { text: fallbackText, executionMode: 'deterministic_fallback', providerMetadata: null };
    }
  }

  codexSimulatedDeepSeekParse({ tenantId, text, customerProfile, conversation, products }) {
    const plan = this.mockStructuredParse({ tenantId, text, customerProfile, conversation, products });
    return {
      ...plan,
      simulatedBy: 'codex',
      simulationScope: 'desktop_test_only',
      reasoningNotes: buildCodexReasoningNotes({ text, plan, customerProfile }),
    };
  }

  mockStructuredParse({ tenantId, text, customerProfile, conversation, products: providedProducts }) {
    const normalized = normalize(text);

    if (conversation?.orderDraft && isRemovalRequest(normalized)) {
      return {
        intent: 'order_clarification',
        order: conversation.orderDraft,
        recommendedTools: ['google_sheets_read_table', 'whatsapp_business_messaging'],
        missingFields: conversation.orderDraft.missingFields ?? [],
        confidence: 0.84,
      };
    }

    if (conversation?.orderDraft && isPaymentMethodPreference(normalized)) {
      return {
        intent: 'order_clarification',
        order: {
          ...conversation.orderDraft,
          paymentMethod: inferPaymentMethod(normalized),
        },
        recommendedTools: ['whatsapp_business_messaging'],
        missingFields: conversation.orderDraft.missingFields ?? [],
        confidence: 0.86,
      };
    }

    if (conversation?.orderDraft && isConfirmation(normalized) && !(conversation.orderDraft.missingFields ?? []).length) {
      return {
        intent: 'order_confirmation',
        order: conversation.orderDraft,
        recommendedTools: ['google_sheets_order_write', 'human_handoff', 'whatsapp_business_messaging'],
        missingFields: [],
        confidence: 0.93,
      };
    }

    if (conversation?.orderDraft?.missingFields?.length && !looksLikeNewOrder(normalized)) {
      return {
        intent: 'order_clarification',
        order: conversation.orderDraft,
        recommendedTools: ['google_sheets_customer_profile_upsert', 'google_sheets_read_table', 'whatsapp_business_messaging'],
        missingFields: conversation.orderDraft.missingFields,
        confidence: 0.82,
      };
    }

    if (containsAny(normalized, ['humano', 'asesor', 'persona', 'ayuda'])) {
      return {
        intent: 'human_handoff',
        recommendedTools: ['human_handoff', 'whatsapp_business_messaging'],
        missingFields: [],
        confidence: 0.96,
      };
    }

    if (isComplaintOrDeliveryIssue(normalized)) {
      return {
        intent: 'human_handoff',
        recommendedTools: ['human_handoff', 'whatsapp_business_messaging'],
        missingFields: [],
        confidence: 0.94,
      };
    }

    if (containsAny(normalized, ['descuento', 'rebaja', 'rebajita', 'excepcion'])) {
      return {
        intent: 'discount_request',
        recommendedTools: ['approval_gate', 'whatsapp_business_messaging'],
        missingFields: [],
        confidence: 0.94,
      };
    }

    if (containsAny(normalized, ['pagado', 'transferencia', 'comprobante', 'confirmo'])) {
      return {
        intent: 'payment_confirmation',
        recommendedTools: ['approval_gate'],
        missingFields: [],
        confidence: 0.92,
      };
    }

    const delivery = containsAny(normalized, ['domicilio', 'domicilios', 'envio', 'envío', 'llevar', 'traer', 'manda', 'mandar', 'lleve']);
    const availabilityQuestion = containsAny(normalized, ['tienes', 'tiene', 'hay', 'disponible', 'manejan', 'maneja', 'manejas', 'venden', 'consigo', 'colabora', 'colabore', 'recomienda', 'ofrece']);
    const products = providedProducts ?? (
      this.config?.allowLocalCatalogFallback === false
        ? []
        : this.store.getState().productsByTenant[tenantId] ?? []
    );
    const matchedItems = extractItems(normalized, products);
    const inferredItems = extractUnknownOrderItems(normalized, matchedItems);
    const items = mergePlannerItems(matchedItems, inferredItems);

    if (availabilityQuestion) {
      const candidates = extractCatalogCandidates(normalized, products);
      const catalogItems = candidates.length
        ? candidates
        : [{ rawName: extractCatalogQuery(text), quantity: null, catalogQuery: extractCatalogQuery(text) }];
      return {
        intent: 'catalog_query',
        order: { delivery, items: catalogItems },
        recommendedTools: ['google_sheets_read_table', 'google_drive_file_picker', 'whatsapp_business_messaging'],
        missingFields: [],
        confidence: 0.78,
      };
    }

    if (delivery || items.length) {
      const missingFields = [];
      if (!customerProfile?.name) missingFields.push('customer_name');
      if (delivery && !customerProfile?.defaultAddress) missingFields.push('delivery_address');
      for (const item of items) {
        if (!item.quantity && !item.budgetAmount) missingFields.push(`quantity:${item.catalogQuery}`);
        const variants = findPresentationVariants(item, products);
        if (variants.length > 1) {
          item.catalogQuery = item.rawName;
          item.skuHint = null;
          item.presentationOptions = variants.map(({ sku, name }) => ({ sku, name }));
          missingFields.push(`presentation:${item.rawName}`);
        }
      }
      if (!items.length) missingFields.push('order_items');
      return {
        intent: 'delivery_order',
        order: { delivery, items },
        recommendedTools: ['google_sheets_customer_profile_lookup', 'google_sheets_read_table', 'google_drive_file_picker', 'whatsapp_business_messaging'],
        missingFields: [...new Set(missingFields)],
        confidence: items.length ? 0.9 : 0.72,
      };
    }

    return {
      intent: 'catalog_query',
      order: { delivery: false, items: [{ rawName: extractCatalogQuery(text), quantity: null, catalogQuery: extractCatalogQuery(text) }] },
      recommendedTools: ['google_sheets_read_table', 'google_drive_file_picker', 'whatsapp_business_messaging'],
      missingFields: [],
      confidence: 0.7,
    };
  }

  async getTenant(tenantId) {
    if (this.store.getTenant) {
      const tenant = await this.store.getTenant(tenantId);
      if (tenant) return tenant;
    }
    return this.store.getState().tenants.find((item) => item.id === tenantId);
  }

  async listProducts(tenantId) {
    // En produccion Google Sheets/Drive es la fuente de verdad; no filtramos
    // el prompt con una copia persistida del catalogo.
    if (this.config?.allowLocalCatalogFallback === false) return [];
    if (this.store.listProducts) return this.store.listProducts(tenantId);
    return this.store.getState().productsByTenant[tenantId] ?? [];
  }
}

function extractItems(text, products) {
  const normalizedText = normalize(text);
  const matches = products
    .map((product) => {
      const aliases = [product.name, product.sku, ...(product.aliases ?? [])].filter(Boolean);
      const match = aliases
        .map((alias) => ({ alias, index: findAliasIndex(normalizedText, normalize(alias)) }))
        .filter((item) => item.index >= 0)
        .sort((a, b) => a.index - b.index)[0];
      if (!match) return null;
      const before = normalizedText.slice(Math.max(0, match.index - 28), match.index).trim();
      const budgetAmount = inferBudgetAmount(before);
      return {
        rawName: match.alias,
        // "5000 de salchichon" expresa un valor objetivo, no cinco mil
        // unidades. El resolutor tratara el presupuesto como tal y validara
        // disponibilidad sin convertirlo en una cantidad de inventario.
        quantity: budgetAmount ? null : inferQuantityForMatch(normalizedText, match.index) ?? inferQuantity(before),
        budgetAmount,
        catalogQuery: product.name,
        skuHint: product.sku,
        confidence: 0.92,
        matchIndex: match.index,
        matchLength: match.alias.length,
        ...presentationFromNearbyText(normalizedText, match.index, match.alias),
      };
    })
    .filter(Boolean);
  // Distintas filas del catalogo pueden compartir aliases. Una sola frase del
  // cliente debe generar un unico item semantico; la competencia entre SKU se
  // resuelve despues, con CandidateSet/ResolutionSet, no en el interprete.
  const nonOverlappingMatches = [...matches]
    .sort((left, right) => left.matchIndex - right.matchIndex || right.matchLength - left.matchLength)
    .filter((match, index, all) => !all.slice(0, index).some((selected) => (
      match.matchIndex < selected.matchIndex + selected.matchLength
      && selected.matchIndex < match.matchIndex + match.matchLength
    )));
  const byGenericRequest = new Map();
  for (const match of nonOverlappingMatches) {
    const key = mentionsPresentation(normalize(match.rawName))
      ? `${normalize(match.rawName)}:${match.skuHint}`
      : normalize(match.rawName);
    if (!byGenericRequest.has(key)) byGenericRequest.set(key, match);
  }
  return [...byGenericRequest.values()].map(({ matchIndex, matchLength, ...item }) => item);
}

function inferQuantityForMatch(text, matchIndex) {
  const prefix = String(text ?? '').slice(0, Math.max(0, matchIndex));
  const fragment = prefix.split(/\s+(?:y|tambien|también|ademas|además)\s+|,/).at(-1) ?? '';
  const quantities = [...fragment.matchAll(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/g)]
    .map((match) => NUMBER_WORDS[match[1]] ?? Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return quantities.at(-1) ?? null;
}

function mergePlannerItems(...groups) {
  const byQuery = new Map();
  for (const item of groups.flat()) {
    const query = normalize(item.catalogQuery ?? item.rawName);
    if (!query || byQuery.has(query)) continue;
    byQuery.set(query, item);
  }
  return [...byQuery.values()];
}

function extractUnknownOrderItems(text, matchedItems = []) {
  const cleaned = cleanOrderRequest(text);
  if (!cleaned) return [];
  const candidates = [];
  for (const fragment of splitOrderFragments(cleaned)) {
    let remainder = fragment.replace(/\b(\d{4,7})\s+de\s+(.+)$/g, (_match, amount, product) => {
      candidates.push(buildUnknownItem(product, { quantity: null, budgetAmount: Number(amount) }));
      return ' ';
    }).replace(/\b(six\s*pack|sixpack)\s+de\s+(.+)$/g, (_match, _pack, product) => {
      candidates.push(buildUnknownItem(product, { prefix: 'six pack de', presentation: 'six pack' }));
      return ' ';
    }).replace(/\b(un|una|uno|1)?\s*(paquete|bolsa|botella|caja|unidad)\s+de\s+(.+)$/g, (_match, quantityWord, container, product) => {
      candidates.push(buildUnknownItem(product, { quantity: inferQuantity(quantityWord ?? '') ?? 1, container }));
      return ' ';
    });
    remainder = remainder.trim();
    if (remainder) {
      const item = buildUnknownItem(remainder, {});
      if (item) candidates.push(item);
    }
  }
  return mergePlannerItems(candidates).filter((candidate) => !isCoveredByMatchedItem(candidate, matchedItems));
}

function cleanOrderRequest(text) {
  return normalize(text)
    .replace(/\b(buenos dias|buen dia|buenas tardes|buenas noches|buenas|hola|holi|vecino|vecina|veci|parce|ven)\b/g, ' ')
    .replace(/\b(para|pa|pal)\s+un\s+domicilio\b/g, ' ')
    .replace(/\b(me\s+)?(regalas|regala|das|dame|envias|envia|mandas|manda|traes|trae)(\s+por\s+favor)?\b/g, ' ')
    .replace(/\b(por\s+favor|porfa|porfis|porfita|gracias)\b/g, ' ')
    .replace(/[.;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitOrderFragments(text) {
  return String(text ?? '')
    .replace(/\blitro\s+y\s+medio\b/g, '1 5 l')
    .split(/\s+(?:y|tambien|también|ademas|además)\s+|,/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function buildUnknownItem(fragment, options = {}) {
  const normalized = normalize(fragment)
    .replace(/^\s*\d+\s+/, ' ')
    .replace(/\b(un|una|uno|el|la|los|las)\b/g, ' ')
    .replace(/\b(paquete|bolsa|botella|caja|unidad)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const product = normalized
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(token))
    .join(' ')
    .trim();
  if (!product || product.length < 3) return null;
  const quantity = options.quantity ?? inferFragmentQuantity(fragment) ?? 1;
  const catalogQuery = [options.presentation, product].filter(Boolean).join(' ');
  return {
    rawName: [options.prefix, product].filter(Boolean).join(' '),
    quantity,
    catalogQuery,
    skuHint: null,
    inferred: true,
    confidence: options.budgetAmount ? 0.68 : 0.58,
    ambiguityReason: options.budgetAmount
      ? 'pedido_por_valor_o_producto_no_confirmado'
      : 'producto_inferido_desde_texto_no_validado',
    ...(options.budgetAmount ? { budgetAmount: options.budgetAmount } : {}),
    ...(options.presentation ? { presentationHint: options.presentation } : {}),
    ...(options.container ? { containerHint: options.container } : {}),
  };
}

function inferFragmentQuantity(fragment) {
  const value = normalize(fragment);
  const leading = value.match(/^\s*(\d+)\b/)?.[1];
  if (leading) return Number(leading);
  const firstWord = value.split(/\s+/).filter(Boolean)[0];
  if (NUMBER_WORDS[firstWord]) return NUMBER_WORDS[firstWord];
  return inferQuantity(fragment);
}

function isCoveredByMatchedItem(candidate, matchedItems) {
  const query = normalizePresentationText(candidate.catalogQuery ?? candidate.rawName);
  const queryTokens = splitCatalogWords(query);
  return matchedItems.some((item) => {
    const raw = normalizePresentationText(item.rawName);
    const catalog = normalizePresentationText(item.catalogQuery);
    if (!raw && !catalog) return false;
    if (query === raw || query === catalog) return true;
    if (query.includes(raw) && item.requestedPresentation) return true;
    const rawTokens = splitCatalogWords(raw);
    if (rawTokens.length > 1 && rawTokens.every((token) => queryTokens.some((queryToken) => sameSimpleWord(queryToken, token)))) return true;
    return raw.length >= 4 && queryTokens.some((token) => sameSimpleWord(token, raw));
  });
}

function normalizePresentationText(value) {
  return normalize(value)
    .replace(/\b(?:(?:un|una)\s+)?litro\s+y\s+medio\b/g, '1 5 l')
    .replace(/\bmedio\s+litro\b/g, '500 ml');
}

function splitCatalogWords(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function sameSimpleWord(a, b) {
  if (a === b) return true;
  if (a.length >= 5 && `${a}s` === b) return true;
  if (b.length >= 5 && `${b}s` === a) return true;
  return false;
}

function presentationFromNearbyText(text, matchIndex, alias) {
  // Una presentacion debe pertenecer a la misma clausula del producto. Sin
  // este limite, en "arroz, aceite y huevos AA x12" el x12 se atribuía a
  // aceite. Conservamos "litro y medio" como una sola expresion valida.
  const suffix = String(text ?? '').slice(matchIndex + alias.length);
  const clause = suffix
    .split(/[,.!?;]/, 1)[0]
    .split(/\s+(?:y|tambien|también|ademas|además)\s+(?!medio\b)/, 1)[0];
  const window = normalize(`${alias} ${clause.slice(0, 18)}`);
  const requestedPresentation = nearbyPresentation(window);
  if (!requestedPresentation) return {};
  const aliasTerms = normalize(alias).split(/\s+/).filter(Boolean);
  const presentationTerms = normalize(requestedPresentation).split(/\s+/).filter(Boolean);
  const aliasAlreadyIncludesPresentation = presentationTerms.length && presentationTerms.every((term) => (
    aliasTerms.some((aliasTerm) => sameSimpleWord(aliasTerm, term))
  ));
  const requestedName = aliasAlreadyIncludesPresentation
    ? alias
    : `${alias} ${requestedPresentation}`.trim();
  return {
    rawName: requestedName,
    catalogQuery: requestedName,
    skuHint: null,
    requestedPresentation,
    confidence: 0.7,
    ambiguityReason: 'presentacion_solicitada_no_coincide_con_sku_alias',
  };
}

function nearbyPresentation(value) {
  if (/\b(?:(?:un|una)\s+)?litro\s+y\s+medio\b/.test(value)) return '1.5 L';
  if (/\bmedio\s+litro\b/.test(value)) return '500 ml';
  const count = value.match(/\bx\s*(\d{1,3})\b/);
  if (count) return `x${count[1]}`;
  return value.match(/\b(\d{2,4})\s*(ml|mililitros?|cc)?\b/)?.[0] ?? null;
}

function findAliasIndex(text, alias) {
  if (!alias) return -1;
  let index = text.indexOf(alias);
  while (index >= 0) {
    const before = index === 0 ? '' : text[index - 1];
    const after = text[index + alias.length] ?? '';
    if (!isCatalogWordChar(before) && !isCatalogWordChar(after)) return index;
    const pluralAfter = text[index + alias.length + 1] ?? '';
    if (alias.length >= 5 && after === 's' && !isCatalogWordChar(before) && !isCatalogWordChar(pluralAfter)) return index;
    index = text.indexOf(alias, index + 1);
  }
  return -1;
}

function isCatalogWordChar(char) {
  return /[a-z0-9]/.test(char);
}

function extractCatalogCandidates(text, products) {
  if (containsAny(text, ['lacteos', 'lácteos', 'lacteo', 'lácteo'])) {
    return [{ rawName: 'lacteos', quantity: null, catalogQuery: 'lacteos' }];
  }
  const items = extractItems(text, products).map((item) => ({ ...item, quantity: null }));
  const byQuery = new Map(items.map((item) => [normalize(item.catalogQuery), item]));
  const concepts = [
    { terms: ['jamon', 'jamón'], catalogQuery: 'jamon' },
    { terms: ['queso'], catalogQuery: 'queso' },
    { terms: ['pan'], catalogQuery: 'pan' },
    { terms: ['jugo', 'jugos'], catalogQuery: 'jugo' },
  ];
  for (const concept of concepts) {
    if (!containsAny(text, concept.terms)) continue;
    if (items.some((item) => normalize(item.catalogQuery).includes(normalize(concept.catalogQuery)))) continue;
    if (byQuery.has(normalize(concept.catalogQuery))) continue;
    byQuery.set(normalize(concept.catalogQuery), {
      rawName: concept.catalogQuery,
      quantity: null,
      catalogQuery: concept.catalogQuery,
    });
  }
  return [...byQuery.values()];
}

function inferQuantity(fragment) {
  const number = fragment.match(/(\d+)\s*$/)?.[1];
  if (number) return Number(number);
  const word = fragment.split(/\s+/).filter(Boolean).at(-1);
  return NUMBER_WORDS[word] ?? null;
}

function inferBudgetAmount(fragment) {
  const match = normalize(fragment).match(/\b(\d{4,7})\s+de\s*$/);
  return match ? Number(match[1]) : null;
}

function findPresentationVariants(item, products) {
  const raw = normalize(item.rawName);
  if (!raw || mentionsPresentation(raw)) return [];
  const rawTokens = raw.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (!rawTokens.length) return [];
  return products.filter((product) => {
    const fields = [product.name, ...(product.aliases ?? [])].map(normalize);
    const hasPresentation = fields.some((field) => mentionsPresentation(field));
    if (!hasPresentation) return false;
    return fields.some((field) => {
      if (field === raw) return true;
      if (raw.length >= 5 && field.includes(raw)) return true;
      return rawTokens.length >= 2 && rawTokens.every((token) => field.includes(token));
    });
  });
}

function mentionsPresentation(text) {
  return /\b\d+\s*(ml|litro|litros|l|g|gr|kg)\b/.test(text) ||
    /\bx\s*\d+\b/.test(text) ||
    containsAny(text, ['litro y medio', 'medio litro', 'personal', 'familiar', 'grande', 'pequena', 'pequeno', 'pequenita', 'pequenito', 'sin gas', 'entera', 'sachet', 'barra']);
}

function extractCatalogQuery(text) {
  return String(text ?? '')
    .replace(/[¿?¡!.,]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOPWORDS.has(normalize(token)))
    .join(' ')
    .trim();
}

function containsAny(text, words) {
  return words.some((word) => text.includes(normalize(word)));
}

function isConfirmation(text) {
  return /\b(si|sí)\b/.test(text) || containsAny(text, ['confirmo', 'confirmado', 'listo', 'dale', 'de acuerdo']);
}

function isRemovalRequest(text) {
  return containsAny(text, ['sin ese', 'sin esa', 'sin el', 'sin la', 'sin los', 'sin las', 'quitale', 'quítale', 'quita', 'no lo mandes', 'no la mandes']);
}

function isPaymentMethodPreference(text) {
  return containsAny(text, ['pago con tarjeta', 'tarjeta debito', 'tarjeta débito', 'datafono', 'datáfono', 'efectivo', 'bre-b', 'breb', 'bre b', 'nequi', 'daviplata']);
}

function isComplaintOrDeliveryIssue(text) {
  return containsAny(text, [
    'por que me enviaron',
    'por que llego',
    'por que no llego',
    'me enviaron solo',
    'me llego solo',
    'me falto',
    'faltante',
    'no llego',
    'llego mal',
    'producto equivocado',
    'pedido incompleto',
    'reclamo',
  ]);
}

function inferPaymentMethod(text) {
  if (containsAny(text, ['datafono', 'datáfono', 'tarjeta debito', 'tarjeta débito', 'tarjeta'])) return 'card_terminal';
  if (containsAny(text, ['bre-b', 'breb', 'bre b'])) return 'bre_b';
  if (containsAny(text, ['nequi'])) return 'nequi';
  if (containsAny(text, ['daviplata'])) return 'daviplata';
  if (containsAny(text, ['efectivo'])) return 'cash';
  return 'unspecified';
}

function looksLikeNewOrder(text) {
  // A fresh availability question is not an answer to a pending checkout.
  // Let the shopper explore the catalog without being trapped in the old draft.
  if (isAvailabilityOrOptionsQuestion(text) || /\b(?:tiene|tienes|hay|maneja|manejan)\b/.test(normalize(text))) return true;
  return containsAny(text, [
    'regalas',
    'regala',
    'quiero',
    'paquete',
    'bolsa',
    'botella',
    'brownie',
    'ponque',
    'ramitos',
    'taco',
    'tacos',
    'ducales',
    'chocorramo',
    'chocorramo',
    'malboro',
    'marlboro',
    'coca',
    'gaseosa',
    'pan',
    'queso',
  ]);
}

function buildPlannerPrompt({ text, customerProfile, conversation, config = {} }) {
  return [
    'Eres el interprete semantico de un agente comercial por WhatsApp.',
    'Devuelve solo JSON valido con el contrato semantic-frame.v1: intent, conversationAct, delivery, customerDelta, items, missingCustomerFields, confidence.',
    'No incluyas markdown, explicaciones ni texto fuera del JSON.',
    'Intents permitidos: delivery_order, order_clarification, order_confirmation, catalog_query, discount_request, payment_confirmation, human_handoff.',
    `Contexto cultural de interpretacion: ${normalizeVoiceProfile(config.tone)}. Interpreta modismos colombianos, errores de escritura probables, marcas incompletas, cantidades, sabores, ocasiones y senales como personal, familiar, grande o para compartir.`,
    'Cada items[] debe contener rawText literal, productHypothesis, brandHint, categoryHint, quantity, budgetAmount, presentationSignal, occasion, attributes, confidence y ambiguity. No elimines ningun producto mencionado.',
    'rawText conserva exactamente lo solicitado. productHypothesis es una hipotesis, nunca un SKU. presentationSignal puede ser una medida explicita o una senal contextual, nunca una referencia comercial definitiva.',
    'customerDelta solo puede incluir name, address y paymentPreference expresamente comunicados por el cliente. No inventes datos.',
    'No incluyas SKU, precio, stock, subtotal, candidatos de catalogo, aliases, toolPlan, filtros, herramientas, recommendedTools ni una eleccion final de producto.',
    'No asumas disponibilidad. Si el termino es incierto, conserva rawText, plantea la mejor hipotesis y baja confidence o explica ambiguity.',
    'Si el cliente pregunta "tiene", "hay" o "maneja", usa catalog_query aunque mencione productos concretos. Si reclama un faltante, entrega equivocada, demora o dano, usa human_handoff.',
    'Sin domicilio, cantidad, presupuesto ni una accion directa de compra (por ejemplo "me manda" o "me regala"), una consulta abierta como "me colabora con mecato" o "jabon para lavar ropa" usa catalog_query; no pidas pago para una consulta.',
    'Si el cliente pide "5000 de X", usa budgetAmount 5000; no lo conviertas en 5000 unidades.',
    JSON.stringify({
      text,
      customerProfile: customerProfile ? {
        name: customerProfile.name ?? null,
        defaultAddress: customerProfile.defaultAddress ?? null,
        preferredPaymentMethod: customerProfile.preferences?.preferredPaymentMethod ?? null,
      } : null,
      existingOrder: semanticOrderContext(conversation?.orderDraft),
    }),
  ].join('\n');
}

function semanticOrderContext(draft) {
  if (!draft) return null;
  return {
    version: Number(draft.version ?? 0),
    delivery: Boolean(draft.delivery),
    paymentMethod: draft.paymentMethod ?? null,
    missingFields: Array.isArray(draft.missingFields) ? draft.missingFields : [],
    items: (draft.items ?? []).map((item) => ({
      rawItemId: item.rawItemId ?? null,
      rawText: item.rawName ?? item.catalogQuery ?? null,
      productName: item.product?.name ?? null,
      quantity: item.quantity ?? null,
      presentation: item.product?.presentation ?? item.requestedPresentation ?? null,
    })),
  };
}

function buildReplyPrompt({ facts, fallbackText, config }) {
  const requiredTerms = replyRequiredTerms(facts, fallbackText);
  return [
    'Redacta la respuesta final para un comprador de una tienda colombiana por WhatsApp.',
    'Devuelve solo JSON valido con la propiedad reply.',
    `Perfil de voz: ${normalizeVoiceProfile(config.tone)}. Usa cercania colombiana solo si encaja; nunca caricaturices ni repitas muletillas.`,
    'Los hechos comerciales son cerrados: no inventes, elimines ni cambies productos, precios, subtotal, stock, descuentos, direcciones, pago, estado ni promesas de entrega.',
    'Mantén la respuesta breve, amable y accionable. No hables del sistema, del LLM ni de herramientas.',
    'Debes conservar literalmente los términos obligatorios que vienen en requiredTerms.',
    JSON.stringify({ facts: facts ?? {}, requiredTerms, fallbackText }),
  ].join('\n');
}

function validateComposedReply(text, { facts, fallbackText }) {
  const reply = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (reply.length < 3 || reply.length > 1_200) return fallbackText;
  const normalizedReply = normalize(reply);
  const requiredTerms = replyRequiredTerms(facts, fallbackText);
  if (requiredTerms.some((term) => !normalizedReply.includes(normalize(term)))) return fallbackText;
  const allowedMoney = extractMoneyTokens(JSON.stringify(facts ?? {}).concat(` ${fallbackText}`));
  const replyMoney = extractMoneyTokens(reply);
  if ([...replyMoney].some((value) => !allowedMoney.has(value))) return fallbackText;
  return reply;
}

function replyRequiredTerms(facts, fallbackText) {
  const products = facts?.products ?? facts?.items ?? [];
  const names = products
    .map((item) => item?.name ?? item?.product?.name)
    .filter(Boolean)
    .slice(0, 6);
  const required = [...names, ...(facts?.requiredTerms ?? [])]
    .map((value) => String(value).trim())
    .filter(Boolean);
  if (facts?.subtotal !== undefined && facts?.subtotal !== null) required.push(formatMoneyForReply(facts.subtotal));
  return [...new Set(required)];
}

function extractMoneyTokens(value) {
  return new Set((String(value ?? '').match(/\$\s?[\d.]+/g) ?? [])
    .map((item) => item.replace(/\s+/g, '')));
}

function formatMoneyForReply(value) {
  return `$ ${Number(value ?? 0).toLocaleString('es-CO')}`;
}

function normalizeVoiceProfile(value) {
  const tone = String(value ?? 'tendero_colombiano').trim().toLowerCase();
  if (tone === 'tendero_bogotano' || tone === 'tendero_colombiano') {
    return 'tendero_colombiano: cercano, respetuoso, claro, breve y natural; puede usar modismos locales con moderación';
  }
  return tone || 'tendero_colombiano: cercano, respetuoso, claro y breve';
}

function buildCodexCliPlannerPrompt({ text, customerProfile, conversation, products }) {
  return [
    'Responde solo JSON valido, sin markdown.',
    'Eres un planner de pedidos por WhatsApp para una tienda de barrio en Colombia.',
    'Tu tarea es inferir heurísticamente la canasta: corrige errores ortográficos probables, modismos, marcas incompletas, presentaciones, cantidades y pedidos por valor.',
    'No confirmes disponibilidad ni propongas herramientas: solo interpreta lenguaje.',
    'Contrato JSON semantic-frame.v1: intent, conversationAct, delivery, customerDelta, items, missingCustomerFields, confidence.',
    'Para cada item usa rawText original, productHypothesis, brandHint, categoryHint, quantity, budgetAmount, presentationSignal, occasion, attributes, confidence y ambiguity. Trata familiar, personal y grande como hipotesis contextuales, no como medidas fijas.',
    'Reglas clave: "5000 de X" es budgetAmount 5000, no 5000 unidades. "calchichon" probablemente es salchichon/salchicha/carnes frias. "coca-cola 350" pide presentacion 350 ml.',
    'Si cliente nuevo pide domicilio agrega customer_name y delivery_address. Conserva todos los productos candidatos.',
    'Si el cliente reclama entrega incompleta, producto equivocado, demora o faltante, escala a humano con human_handoff.',
    'No incluyas SKU, precio, stock, subtotal, candidatos de catalogo, aliases, toolPlan ni una respuesta dirigida al cliente.',
    JSON.stringify({
      text,
      customerProfile,
      existingOrder: semanticOrderContext(conversation?.orderDraft),
    }),
  ].join('\n');
}

function compactCatalogHints(products = [], text = '') {
  const normalizedText = normalize(text);
  const tokens = splitCatalogWords(normalizedText).filter((token) => token.length >= 4);
  const selected = [];
  for (const product of products) {
    const fields = [
      product.name,
      product.brand,
      product.category,
      product.presentation,
      product.normalizedPresentation,
      product.description,
      product.productFamily,
      ...(product.tags ?? []),
      ...(product.aliases ?? []),
    ].join(' ');
    const normalizedFields = normalize(fields);
    const productTokens = splitCatalogWords(fields);
    const direct = tokens.some((token) => normalizedFields.includes(token) || productTokens.some((candidate) => maybeRelatedToken(token, candidate)));
    const domainHint = (
      containsAny(normalizedText, ['calchichon', 'salchichon', 'salchicha', 'salchichas']) &&
      containsAny(normalizedFields, ['salchicha', 'jamon', 'mortadela', 'carnes frias'])
    ) || (
      containsAny(normalizedText, ['coca', 'gaseosa']) &&
      containsAny(normalizedFields, ['coca', 'gaseosa'])
    );
    if (direct || domainHint) selected.push(product);
  }
  return selected.slice(0, 12).map(({ sku, name, aliases, category, brand, presentation, normalizedPresentation, description, tags, productFamily, stock }) => ({
    sku,
    name,
    aliases,
    category,
    brand,
    presentation,
    normalizedPresentation,
    description,
    tags,
    productFamily,
    stock,
  }));
}

function maybeRelatedToken(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))) return true;
  if (a[0] !== b[0]) return false;
  return a.length >= 6 && b.length >= 6 && levenshtein(a, b) <= 2;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length][b.length];
}

async function callCodexCli({ config, prompt }) {
  const startedAt = Date.now();
  const outputPath = path.join(os.tmpdir(), `ventas-ia-codex-cli-${crypto.randomUUID()}.json`);
  const command = config.codexCliCommand ?? process.env.CODEX_CLI_COMMAND ?? 'codex';
  const args = ['exec', '--sandbox', 'read-only', '--ephemeral'];
  const model = config.codexCliModel ?? process.env.CODEX_CLI_MODEL ?? 'gpt-6-luna';
  if (model) args.push('--model', model);
  args.push('-c', `model_reasoning_effort="${config.codexCliReasoningEffort ?? process.env.CODEX_CLI_REASONING_EFFORT ?? 'low'}"`);
  args.push('--output-last-message', outputPath);
  args.push(prompt);
  try {
    await execFileClosedStdin(command, args, {
      cwd: process.cwd(),
      timeout: Number(config.codexCliTimeoutMs ?? process.env.CODEX_CLI_TIMEOUT_MS ?? 120000),
      maxBuffer: 1024 * 1024 * 5,
      windowsHide: true,
    });
    const content = await fs.readFile(outputPath, 'utf8');
    return {
      plan: normalizeProviderPlan(JSON.parse(stripJson(content))),
      providerMetadata: {
        provider: 'codex_cli',
        model: model ?? 'codex-default',
        endpoint: command,
        durationMs: Date.now() - startedAt,
        usage: null,
      },
    };
  } finally {
    await fs.unlink(outputPath).catch(() => {});
  }
}

function execFileClosedStdin(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
}

async function callChatCompletions({ config, apiKey, prompt }) {
  const provider = config.provider ?? 'deepseek';
  const url = resolveBaseUrl(config, provider) ?? (provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions');
  const startedAt = Date.now();
  const model = config.model ?? defaultModel(provider);
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: Number(config.temperature ?? 0),
      max_tokens: Number(config.maxTokens ?? 1200),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Responde exclusivamente JSON valido para el contrato solicitado.' },
        { role: 'user', content: prompt },
      ],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  return {
    plan: normalizeProviderPlan(JSON.parse(stripJson(payload.choices?.[0]?.message?.content ?? '{}'))),
    providerMetadata: {
      provider,
      model,
      endpoint: redactedEndpoint(url),
      durationMs: Date.now() - startedAt,
      usage: payload.usage ?? null,
    },
  };
}

async function callChatReply({ config, apiKey, prompt }) {
  const provider = config.provider ?? 'deepseek';
  const url = resolveBaseUrl(config, provider) ?? (provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/chat/completions');
  const startedAt = Date.now();
  const model = config.model ?? defaultModel(provider);
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: Number(config.temperature ?? 0.2),
      max_tokens: Number(config.maxTokens ?? 350),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Responde exclusivamente JSON valido para el contrato solicitado.' },
        { role: 'user', content: prompt },
      ],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  const parsed = JSON.parse(stripJson(payload.choices?.[0]?.message?.content ?? '{}'));
  return {
    text: String(parsed.reply ?? '').trim(),
    providerMetadata: {
      provider,
      model,
      endpoint: redactedEndpoint(url),
      durationMs: Date.now() - startedAt,
      usage: payload.usage ?? null,
    },
  };
}

async function callGemini({ config, apiKey, prompt }) {
  const model = config.model ?? defaultModel('google');
  const baseUrl = resolveBaseUrl(config, 'google') ?? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const startedAt = Date.now();
  const endpoint = `${baseUrl}${joiner}key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: Number(config.temperature ?? 0),
        maxOutputTokens: Number(config.maxTokens ?? 1200),
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`google API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  return {
    plan: normalizeProviderPlan(JSON.parse(stripJson(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'))),
    providerMetadata: {
      provider: 'google',
      model,
      endpoint: redactedEndpoint(endpoint),
      durationMs: Date.now() - startedAt,
      usage: payload.usageMetadata ?? null,
    },
  };
}

async function callGeminiReply({ config, apiKey, prompt }) {
  const model = config.model ?? defaultModel('google');
  const baseUrl = resolveBaseUrl(config, 'google') ?? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const joiner = baseUrl.includes('?') ? '&' : '?';
  const endpoint = `${baseUrl}${joiner}key=${encodeURIComponent(apiKey)}`;
  const startedAt = Date.now();
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationConfig: {
        temperature: Number(config.temperature ?? 0.2),
        maxOutputTokens: Number(config.maxTokens ?? 350),
        responseMimeType: 'application/json',
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  }, Number(config.timeoutMs ?? 15000));
  const text = await response.text();
  if (!response.ok) throw new Error(`google API ${response.status}: ${shorten(text)}`);
  const payload = JSON.parse(text || '{}');
  const parsed = JSON.parse(stripJson(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}'));
  return {
    text: String(parsed.reply ?? '').trim(),
    providerMetadata: {
      provider: 'google',
      model,
      endpoint: redactedEndpoint(endpoint),
      durationMs: Date.now() - startedAt,
      usage: payload.usageMetadata ?? null,
    },
  };
}

function normalizeProviderPlan(plan) {
  if (plan?.schemaVersion === 'semantic-frame.v1' || Array.isArray(plan?.items)) return plan;
  const customerUnderstanding = normalizeCustomerUnderstanding(plan.customerUnderstanding);
  const intent = normalizeProviderIntent(plan.intent);
  return enrichPlannerOutput({
    intent,
    order: plan.order ?? { delivery: false, items: [] },
    recommendedTools: Array.isArray(plan.recommendedTools) ? plan.recommendedTools : ['whatsapp_business_messaging'],
    missingFields: Array.isArray(plan.missingFields) ? plan.missingFields : [],
    missingInfo: Array.isArray(plan.missingInfo) ? plan.missingInfo : plan.missingFields,
    reasoningMode: plan.reasoningMode,
    customerUnderstanding,
    candidateItems: plan.candidateItems,
    toolPlan: plan.toolPlan,
    responseStrategy: normalizeResponseStrategy(plan.responseStrategy),
    confidence: Number(plan.confidence ?? 0.7),
  }, customerUnderstanding.rawNeed ?? '');
}

function coercePlanWithConversation(plan, { text, conversation }) {
  const normalized = normalize(text);
  if (isComplaintOrDeliveryIssue(normalized)) {
    return {
      ...plan,
      intent: 'human_handoff',
      recommendedTools: ['human_handoff', 'whatsapp_business_messaging'],
      responseStrategy: 'handoff',
      missingFields: [],
      confidence: Math.max(Number(plan.confidence ?? 0.8), 0.9),
    };
  }
  if (
    conversation?.orderDraft &&
    isPaymentMethodPreference(normalized) &&
    !isPaymentProofOrConfirmation(normalized)
  ) {
    return {
      ...plan,
      intent: 'order_clarification',
      order: {
        ...conversation.orderDraft,
        paymentMethod: inferPaymentMethod(normalized),
      },
      recommendedTools: ['whatsapp_business_messaging'],
      missingFields: conversation.orderDraft.missingFields ?? [],
      responseStrategy: 'quote',
      confidence: Math.min(Number(plan.confidence ?? 0.8), 0.86),
    };
  }
  const intent = normalizeProviderIntent(plan.intent);
  if (isAvailabilityOrOptionsQuestion(normalized) && intent === 'delivery_order') {
    return {
      ...plan,
      intent: 'catalog_query',
      responseStrategy: plan.responseStrategy ?? 'guide',
      missingFields: [],
    };
  }
  if (intent === 'delivery_order' && !conversation?.orderDraft && !plan.order?.delivery && !planHasConcreteQuantity(plan) && !looksLikePurchaseRequest(normalized)) {
    return {
      ...plan,
      intent: 'catalog_query',
      responseStrategy: 'guide',
      missingFields: [],
    };
  }
  if (intent === 'catalog_query' && looksLikePurchaseRequest(normalized) && planHasConcreteQuantity(plan)) {
    return {
      ...plan,
      intent: 'delivery_order',
      responseStrategy: plan.responseStrategy === 'guide' ? 'quote' : plan.responseStrategy,
    };
  }
  return plan;
}

function isPaymentProofOrConfirmation(text) {
  return containsAny(text, [
    'comprobante',
    'transferencia realizada',
    'ya transferi',
    'ya transferí',
    'ya pague',
    'ya pagué',
    'pagado',
    'recibo',
    'soporte',
  ]);
}

function isAvailabilityOrOptionsQuestion(text) {
  return containsAny(text, [
    'que tiene',
    'que tienes',
    'tiene ',
    'tienes ',
    'hay ',
    'maneja',
    'manejan',
    'venden',
    'consigo',
  ]);
}

function looksLikePurchaseRequest(text) {
  return containsAny(text, [
    'me regalas',
    'me regala',
    'me manda',
    'mandame',
    'mándame',
    'dame',
    'quiero',
    'necesito',
    'para domicilio',
  ]);
}

function planHasConcreteQuantity(plan) {
  const items = plan.order?.items?.length ? plan.order.items : plan.candidateItems;
  return (items ?? []).some((item) => Number(item.quantity ?? 0) > 0 || Number(item.budgetAmount ?? 0) > 0);
}

function enrichPlannerOutput(plan, text) {
  const rawOrder = plan.order ?? { delivery: false, items: [] };
  const candidateItems = normalizeCandidateItems(plan.candidateItems);
  const items = Array.isArray(rawOrder.items) && rawOrder.items.length ? rawOrder.items : candidateItems;
  const order = {
    ...rawOrder,
    delivery: Boolean(rawOrder.delivery || plan.customerUnderstanding?.delivery || containsAny(normalize(text), ['domicilio', 'domicilios', 'envio', 'envío', 'llevar', 'traer'])),
    items,
  };
  const missingFields = Array.isArray(plan.missingFields) ? plan.missingFields : [];
  const responseStrategy = plan.responseStrategy ?? inferResponseStrategy({ intent: plan.intent, items, missingFields });
  const enrichedCandidateItems = candidateItems.length
    ? candidateItems
    : items.map((item) => ({
      rawName: item.rawName ?? item.catalogQuery,
      catalogQuery: item.catalogQuery ?? item.rawName,
      quantity: item.quantity ?? null,
      skuHint: item.skuHint ?? null,
    }));
  const customerUnderstanding = {
    rawNeed: text,
    certainty: inferCertainty({ intent: plan.intent, items, missingFields, responseStrategy }),
    occasion: inferOccasion(text),
    delivery: Boolean(order.delivery),
    ...(plan.customerUnderstanding && typeof plan.customerUnderstanding === 'object' ? plan.customerUnderstanding : {}),
  };
  return {
    ...plan,
    reasoningMode: normalizeReasoningMode(plan.reasoningMode),
    customerUnderstanding,
    candidateItems: enrichedCandidateItems,
    // La seleccion y los filtros de herramientas son responsabilidad del
    // runtime/resolutor. El interprete no conserva ni reconstruye un plan de
    // herramientas que pueda contaminar la evidencia comercial.
    toolPlan: [],
    missingInfo: Array.isArray(plan.missingInfo) ? plan.missingInfo : missingFields,
    responseStrategy,
    order,
    recommendedTools: Array.isArray(plan.recommendedTools) ? plan.recommendedTools : ['whatsapp_business_messaging'],
    missingFields,
    confidence: Number(plan.confidence ?? 0.7),
  };
}

function normalizeCustomerUnderstanding(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') return { rawNeed: value };
  return {};
}

function normalizeCandidateItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    ...item,
    rawName: item.rawName ?? item.name ?? item.catalogQuery,
    catalogQuery: item.catalogQuery ?? item.rawName ?? item.name,
    quantity: item.quantity ?? null,
    budgetAmount: item.budgetAmount ?? null,
    requestedPresentation: item.requestedPresentation ?? item.presentation ?? null,
    confidence: item.confidence ?? null,
    ambiguityReason: item.ambiguityReason ?? item.reason ?? null,
    skuHint: item.skuHint ?? null,
  })).filter((item) => item.rawName || item.catalogQuery);
}

function normalizeProviderIntent(intent) {
  const normalized = normalize(intent);
  if (containsAny(normalized, ['delivery_order', 'pedido', 'domicilio', 'orden'])) return 'delivery_order';
  if (containsAny(normalized, ['order_clarification', 'clarificacion', 'aclaracion'])) return 'order_clarification';
  if (containsAny(normalized, ['order_confirmation', 'confirmacion'])) return 'order_confirmation';
  if (containsAny(normalized, ['discount_request', 'descuento', 'rebaja'])) return 'discount_request';
  if (containsAny(normalized, ['payment_confirmation', 'pago', 'comprobante'])) return 'payment_confirmation';
  if (containsAny(normalized, ['human_handoff', 'humano', 'asesor'])) return 'human_handoff';
  return 'catalog_query';
}

function normalizeReasoningMode(value) {
  const normalized = normalize(value);
  if (!normalized || normalized === 'shopkeeper_guided_sale') return 'shopkeeper_guided_sale';
  if (containsAny(normalized, ['shopkeeper', 'tendero', 'tienda', 'heuristic', 'catalog', 'sale', 'venta'])) return 'shopkeeper_guided_sale';
  return 'shopkeeper_guided_sale';
}

function normalizeResponseStrategy(strategy) {
  const allowed = ['guide', 'quote', 'ask_clarification', 'partial_availability', 'approval', 'handoff', 'transactional_write'];
  if (allowed.includes(strategy)) return strategy;
  const normalized = normalize(strategy);
  if (containsAny(normalized, ['handoff', 'humano'])) return 'handoff';
  if (containsAny(normalized, ['approval', 'aprobar'])) return 'approval';
  if (containsAny(normalized, ['clarification', 'preguntar', 'aclarar'])) return 'ask_clarification';
  if (containsAny(normalized, ['quote', 'cotizar'])) return 'quote';
  return null;
}

function inferResponseStrategy({ intent, items, missingFields }) {
  if (intent === 'catalog_query') return items.length > 1 ? 'partial_availability' : 'guide';
  if (intent === 'delivery_order') return missingFields.length ? 'ask_clarification' : 'quote';
  if (intent === 'order_clarification') return missingFields.length ? 'ask_clarification' : 'quote';
  if (intent === 'order_confirmation') return 'transactional_write';
  if (intent === 'discount_request' || intent === 'payment_confirmation') return 'approval';
  if (intent === 'human_handoff') return 'handoff';
  return 'guide';
}

function inferCertainty({ intent, items, missingFields, responseStrategy }) {
  if (missingFields.length) return 'medium';
  if (intent === 'delivery_order' && items.every((item) => item.quantity)) return 'high';
  if (responseStrategy === 'partial_availability' || responseStrategy === 'guide') return 'medium';
  return 'low';
}

function inferOccasion(text) {
  const normalized = normalize(text);
  if (hasTokenAny(normalized, ['onces', 'lonchera', 'refrigerio'])) return 'onces_lonchera';
  if (hasTokenAny(normalized, ['desayuno'])) return 'desayuno';
  if (hasTokenAny(normalized, ['sed', 'tomar', 'frio', 'fria', 'gaseosa', 'bebida'])) return 'sed_bebida';
  if (hasTokenAny(normalized, ['mercado', 'mercadito', 'despensa'])) return 'mercado';
  if (hasTokenAny(normalized, ['aseo', 'limpieza', 'bano'])) return 'aseo';
  if (hasTokenAny(normalized, ['antojo', 'dulce', 'mecato', 'picar'])) return 'antojo_mecato';
  if (hasTokenAny(normalized, ['comer', 'jamon', 'queso', 'pan'])) return 'algo_para_comer';
  return null;
}

function hasTokenAny(text, words) {
  const tokens = new Set(String(text ?? '').split(/[^a-z0-9]+/).filter(Boolean));
  return words.some((word) => tokens.has(normalize(word)));
}

function buildCodexReasoningNotes({ text, plan, customerProfile }) {
  const notes = [`Mensaje interpretado: "${String(text ?? '').trim()}"`];
  if (plan.intent === 'catalog_query') {
    notes.push('La solicitud pregunta disponibilidad o categoria; conviene consultar catalogo antes de pedir datos.');
  }
  if (plan.intent === 'delivery_order') {
    notes.push('La solicitud contiene intencion de domicilio o productos concretos; se arma canasta antes de cotizar.');
  }
  if (plan.order?.delivery) {
    notes.push(customerProfile?.defaultAddress ? 'Cliente tiene direccion guardada.' : 'Domicilio requiere direccion antes de confirmar pedido.');
  }
  if (plan.missingFields?.length) {
    notes.push(`Faltantes detectados: ${plan.missingFields.join(', ')}.`);
  }
  return notes;
}

function resolveBaseUrl(config, provider) {
  const value = config.baseUrl ?? resolveSecret(config.baseUrlRef, defaultBaseUrlNames(provider));
  if (!value) return null;
  if (provider === 'deepseek' && !value.endsWith('/chat/completions')) return `${value.replace(/\/$/, '')}/chat/completions`;
  if (provider === 'openai' && !value.endsWith('/chat/completions')) return `${value.replace(/\/$/, '')}/chat/completions`;
  return value;
}

function resolveSecret(ref, fallbackNames) {
  const names = [ref, ...(fallbackNames ?? [])].filter(Boolean);
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return null;
}

function defaultKeyNames(provider) {
  if (provider === 'openai') return ['OPENAI_API_KEY'];
  if (provider === 'google') return ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
  return ['DEEPSEEK_API_KEY'];
}

function defaultBaseUrlNames(provider) {
  if (provider === 'openai') return ['OPENAI_BASE_URL'];
  if (provider === 'google') return ['GEMINI_BASE_URL', 'GOOGLE_GENERATIVE_LANGUAGE_BASE_URL'];
  return ['DEEPSEEK_BASE_URL'];
}

function defaultModel(provider) {
  if (provider === 'openai') return 'gpt-4o-mini';
  if (provider === 'google') return 'gemini-1.5-flash';
  if (provider === 'mock') return 'mock-structured-parser';
  return 'deepseek-chat';
}

function stripJson(value) {
  return String(value)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`LLM API timeout after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Tres intentos acotados absorben cortes breves de red o respuestas temporales
// del proveedor sin convertir una degradacion real en una espera indefinida.
async function retryTransientProviderCall(action, { attempts = 3, delayMs = 250 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientProviderError(error)) throw error;
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

function isTransientProviderError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return message.includes('fetch failed')
    || message.includes('timeout')
    || /api\s+(429|5\d\d)\b/.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shorten(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function redactedEndpoint(value) {
  try {
    const url = new URL(value);
    if (url.searchParams.has('key')) url.searchParams.set('key', '***');
    return url.toString();
  } catch {
    return String(value ?? '').replace(/key=[^&]+/i, 'key=***');
  }
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
