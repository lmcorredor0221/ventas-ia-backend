import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.log('DeepSeek catalog ambiguity test skipped: DEEPSEEK_API_KEY is not configured');
  process.exit(0);
}

process.env.STORAGE_DRIVER = 'json';
process.env.AUTH_REQUIRED = 'false';
process.env.CSRF_REQUIRED = 'false';

const { createApp } = await import('../index.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-deepseek-catalog-'));
const { app, store } = createApp({
  dataFile: path.join(tempDir, 'store.json'),
  authRequired: false,
  csrfRequired: false,
  allowLocalCatalogFallback: true,
  whatsappMode: 'mock',
  backgroundWorkersEnabled: false,
  contextualProductSelectionV2: true,
  llmResponseComposerEnabled: true,
  llmRequestTimeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 30000),
  llmMaxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1200),
});

store.mutate((state) => {
  state.platformSettings.llm = {
    ...(state.platformSettings.llm ?? {}),
    provider: 'deepseek',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    mode: 'json_schema',
    simulator: null,
    apiKeyRef: 'DEEPSEEK_API_KEY',
    baseUrlRef: 'DEEPSEEK_BASE_URL',
    temperature: 0,
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1200),
    timeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 30000),
    responseLanguage: 'es-CO',
  };
  state.productsByTenant ??= {};
  state.productsByTenant.andina = colombiaCatalogTestSeed300;
  state.customerProfilesByTenant ??= {};
  state.customerProfilesByTenant.andina ??= {};
  state.customerProfilesByTenant.andina['573219450893'] = {
    sheetRowId: 'deepseek-catalog-customer',
    phone: '573219450893',
    name: 'Luis Corredor',
    defaultAddress: 'Dimonti 1',
    addresses: [{ label: 'casa', address: 'Dimonti 1' }],
    preferences: { channel: 'whatsapp', deliveryDefault: true },
  };
});

const server = app.listen(0, '127.0.0.1');
const turns = [];
const usage = [];

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const messages = [
    'Buenos días para un domicilio',
    'Una Coca-Cola litro y medio y un chocorramo',
  ];
  for (const [index, text] of messages.entries()) {
    const startedWallMs = Date.now();
    const startedAt = performance.now();
    const run = await postJson(`${base}/api/agent/run`, {
      tenantId: 'andina',
      waId: '573219450893',
      profileName: 'Luis Corredor',
      text,
      messageType: 'text',
      messageId: `deepseek-catalog-ambiguity-${index + 1}`,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const plan = run.result?.plan ?? {};
    const conversation = run.conversation ?? {};
    const conversationEvents = (store.getState().events ?? []).filter((event) => (
      event.conversationId === conversation.id && Date.parse(event.at) >= startedWallMs
    ));
    const planEvent = conversationEvents.find((event) => event.type === 'llm.plan.created');
    const planUsage = planEvent?.metadata?.providerMetadata?.usage ?? null;
    usage.push({
      turn: index + 1,
      phase: 'planner',
      provider: planEvent?.metadata?.providerMetadata?.provider ?? plan.provider ?? null,
      model: planEvent?.metadata?.providerMetadata?.model ?? plan.model ?? null,
      promptTokens: numberOrNull(planUsage?.prompt_tokens ?? planUsage?.input_tokens),
      completionTokens: numberOrNull(planUsage?.completion_tokens ?? planUsage?.output_tokens),
      totalTokens: numberOrNull(planUsage?.total_tokens ?? planUsage?.totalTokens),
    });
    const catalogEvents = conversationEvents.filter((event) => event.type === 'llm.catalog_adjudication.completed');
    for (const event of catalogEvents) {
      const adjudicationUsage = event.metadata?.providerMetadata?.usage ?? null;
      usage.push({
        turn: index + 1,
        phase: 'catalog_adjudication',
        provider: event.metadata?.providerMetadata?.provider ?? null,
        model: event.metadata?.providerMetadata?.model ?? null,
        promptTokens: numberOrNull(adjudicationUsage?.prompt_tokens ?? adjudicationUsage?.input_tokens),
        completionTokens: numberOrNull(adjudicationUsage?.completion_tokens ?? adjudicationUsage?.output_tokens),
        totalTokens: numberOrNull(adjudicationUsage?.total_tokens ?? adjudicationUsage?.totalTokens),
      });
    }
    const replyEvents = conversationEvents.filter((event) => event.type === 'llm.reply.composed');
    for (const event of replyEvents) {
      const replyUsage = event.metadata?.providerMetadata?.usage ?? null;
      usage.push({
        turn: index + 1,
        phase: 'reply_composer',
        provider: event.metadata?.providerMetadata?.provider ?? null,
        model: event.metadata?.providerMetadata?.model ?? null,
        promptTokens: numberOrNull(replyUsage?.prompt_tokens ?? replyUsage?.input_tokens),
        completionTokens: numberOrNull(replyUsage?.completion_tokens ?? replyUsage?.output_tokens),
        totalTokens: numberOrNull(replyUsage?.total_tokens ?? replyUsage?.totalTokens),
      });
    }
    turns.push({
      turn: index + 1,
      input: text,
      durationMs,
      provider: plan.provider ?? null,
      model: plan.model ?? null,
      executionMode: plan.executionMode,
      intent: plan.intent,
      candidateItems: plan.candidateItems ?? [],
      draft: compactDraft(conversation.orderDraft),
      reply: conversation.messages?.at(-1)?.text ?? '',
    });
  }

  const finalTurn = turns.at(-1);
  const allItems = finalTurn?.draft?.items ?? [];
  const coca = allItems.find((item) => /coca/i.test(`${item.rawName} ${item.catalogQuery} ${item.product?.name ?? ''}`));
  const chocoramo = allItems.find((item) => /chocoramo|chocorramo/i.test(`${item.rawName} ${item.catalogQuery} ${item.product?.name ?? ''}`));
  const cocaCandidates = coca?.catalogCandidates ?? [];
  const cocaPresentations = new Set(cocaCandidates.map((item) => item.presentation));
  const cocaHasOnlyOnePointFive = cocaPresentations.size > 0 && [...cocaPresentations].every((value) => /1\.5\s*l/i.test(String(value)));
  const responseHasOptions = /1\.5\s*l|1,5\s*l|chocoramo|chocorramo/i.test(finalTurn?.reply ?? '');
  const noIncompatibleCoca = !coca?.product || /1\.5\s*l/i.test(String(coca.product.presentation ?? coca.product.name ?? ''));
  // Product interpretation now uses two real provider calls (context plus
  // product inference), therefore provider_api_two_stage is the expected
  // execution mode. Keep the assertion about the provider boundary, not the
  // legacy single-call label.
  const plannerApiTurns = turns.filter((turn) => (
    turn.provider === 'deepseek'
    && ['provider_api', 'provider_api_two_stage', 'provider_api_context_only'].includes(turn.executionMode)
  )).length;
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'pending_assertions',
    provider: 'deepseek',
    model: store.getState().platformSettings.llm.model,
    catalogSize: colombiaCatalogTestSeed300.length,
    turns,
    usage,
    validation: {
      plannerApiTurns,
      cocaCandidates: cocaCandidates.map((item) => ({ sku: item.sku, name: item.name, presentation: item.presentation, price: item.price })),
      chocoramoCandidates: (chocoramo?.catalogCandidates ?? []).map((item) => ({ sku: item.sku, name: item.name, presentation: item.presentation, price: item.price })),
      cocaHasOnlyOnePointFive,
      noIncompatibleCoca,
      responseHasOptions,
      pendingSelection: allItems.some((item) => item.selectionStatus === 'pending'),
    },
  };
  report.status = plannerApiTurns === turns.length
    && report.validation.cocaHasOnlyOnePointFive
    && report.validation.noIncompatibleCoca
    && report.validation.responseHasOptions
    ? 'passed'
    : 'failed';
  fs.writeFileSync(path.join(process.cwd(), 'test-results-deepseek-catalog-ambiguity.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  assert.ok(report.validation.plannerApiTurns === turns.length, 'Todos los turnos deben pasar por DeepSeek real');
  assert.ok(report.validation.cocaHasOnlyOnePointFive, 'La búsqueda de Coca debe conservar 1.5 L y excluir otras presentaciones');
  assert.ok(report.validation.noIncompatibleCoca, 'No debe llegar una Coca incompatible a la canasta');
  assert.ok(report.validation.responseHasOptions, 'La respuesta debe presentar las alternativas encontradas');
} finally {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function compactDraft(draft) {
  const safeDraft = draft ?? {};
  return {
    subtotal: safeDraft.subtotal ?? null,
    missingFields: safeDraft.missingFields ?? [],
    paymentMethod: safeDraft.paymentMethod ?? null,
    items: (safeDraft.items ?? []).map((item) => ({
      lineId: item.lineId,
      rawName: item.rawName,
      catalogQuery: item.catalogQuery,
      requestedPresentation: item.requestedPresentation ?? null,
      quantity: item.quantity,
      product: item.product ? { sku: item.product.sku, name: item.product.name, presentation: item.product.presentation, price: item.product.price } : null,
      selectionStatus: item.selectionStatus,
      catalogCandidates: (item.catalogCandidates ?? []).map((candidate) => ({ sku: candidate.sku, name: candidate.name, presentation: candidate.presentation, price: candidate.price })),
    })),
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
