import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from '../index.js';
import { catalogRowToProduct, validateCatalogCsv } from '../services/catalogImportService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const catalogSnapshotPath = path.resolve(here, '../../artifacts/catalogo-colombia-2000-demo-activo.csv');
const catalogSnapshot = validateCatalogCsv(fs.readFileSync(catalogSnapshotPath, 'utf8'));
if (!catalogSnapshot.valid || catalogSnapshot.activeRows !== 2000) {
  throw new Error(`El catálogo aislado de 2.000 productos no es utilizable: ${catalogSnapshot.errors.map((error) => error.message).join('; ')}`);
}
const andinaCatalogSnapshot = catalogSnapshot.rows.map(catalogRowToProduct);

const dataFile = process.env.VIA_SIM_DATA_FILE;
const text = process.env.VIA_SIM_TEXT;
const optionId = process.env.VIA_SIM_OPTION_ID?.trim() || null;
const turn = Number(process.env.VIA_SIM_TURN || 1);
if (!dataFile || (!text && !optionId)) throw new Error('VIA_SIM_DATA_FILE and VIA_SIM_TEXT or VIA_SIM_OPTION_ID are required');

const startedAt = Date.now();
const { store, runtime, integrationOutbox } = await createAppAsync({
  storageDriver: 'json',
  dataFile,
  whatsappMode: 'mock',
  authRequired: false,
  csrfRequired: false,
  allowLocalCatalogFallback: true,
  backgroundWorkersEnabled: false,
  integrationOutboxEnabled: false,
  contextualProductSelectionV2: true,
  contextualProductSelectionTenants: ['andina'],
  llmResponseComposerEnabled: true,
  llmRequestTimeoutMs: 30000,
  llmMaxTokens: 1200,
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
    maxTokens: 1200,
    timeoutMs: 30000,
    responseLanguage: 'es-CO',
  };
  const tenant = state.tenants.find((item) => item.id === 'andina');
  if (tenant) tenant.config.agentPolicy = { tone: 'tendero_colombiano' };
  state.productsByTenant ??= {};
  // El simulador debe ser fiel al catálogo colombiano más reciente, no al
  // catálogo mínimo que createAppAsync instala para pruebas rápidas.
  // Forzamos el snapshot aislado en cada turno: nunca toca Drive, PostgreSQL
  // ni el catálogo de un tenant real.
  state.productsByTenant.andina = structuredClone(andinaCatalogSnapshot);
});

const sent = [];
const originalCall = runtime.tools.call.bind(runtime.tools);
runtime.tools.call = async (name, ...args) => {
  if (name === 'whatsapp_business_messaging') {
    const payload = args.at(-1) ?? {};
    // Keep the mock delivery path faithful to production: ToolRegistry stores
    // the outbound agent message in conversation history before we capture it.
    const result = await originalCall(name, ...args);
    sent.push(payload);
    return result;
  }
  return originalCall(name, ...args);
};

try {
  const existingConversation = store.getState().conversations?.find((conversation) => (
    conversation.tenantId === 'andina' && conversation.waId === '573990000001'
  ));
  const offer = optionId
    ? Object.values(store.getState().interactionOffersById ?? {}).find((candidate) => (
      candidate.conversationId === existingConversation?.id
      && candidate.status === 'active'
      && candidate.options?.some((option) => option.id === optionId)
    ))
    : null;
  const selectedOption = offer?.options?.find((option) => option.id === optionId) ?? null;
  if (optionId && !selectedOption) throw new Error(`No existe una opción activa para VIA_SIM_OPTION_ID=${optionId}`);
  const result = await runtime.processInbound({
    tenantId: 'andina',
    waId: '573990000001',
    text: selectedOption?.title ?? text,
    messageId: `sim-${turn}-${Date.now()}`,
    messageType: selectedOption ? 'interactive' : 'text',
    interactive: selectedOption ? {
      type: 'list_reply',
      optionId: selectedOption.id,
      title: selectedOption.title,
      description: selectedOption.description ?? '',
    } : undefined,
    provider: 'whatsapp',
  });
  const conversation = result.conversation ?? {};
  const events = (store.getState().events ?? []).filter((event) => (
    event.conversationId === conversation.id && Date.parse(event.at) >= startedAt
  ));
  const providerCalls = events
    .filter((event) => event.metadata?.providerMetadata?.usage)
    .map((event) => ({
      type: event.type,
      usage: event.metadata.providerMetadata.usage,
      provider: event.metadata.providerMetadata.provider,
      model: event.metadata.providerMetadata.model,
      durationMs: event.metadata.providerMetadata.durationMs,
    }));
  const value = (key) => providerCalls.reduce((sum, call) => sum + (Number(call.usage?.[key] ?? 0) || 0), 0);
  const agentMessage = conversation.messages?.filter((message) => message.role === 'agent').at(-1)?.text ?? null;
  const reply = sent.at(-1) ?? { text: agentMessage };
  const output = {
    ok: true,
    replyText: reply.text ?? reply.body ?? agentMessage,
    interactive: reply.interactive ?? reply.buttons ?? reply.list ?? null,
    conversation: {
      id: conversation.id,
      status: conversation.status,
      stage: conversation.stage,
      zone: conversation.zone,
      nextStep: conversation.nextStep,
      missingFields: conversation.orderDraft?.missingFields ?? [],
      items: (conversation.orderDraft?.items ?? []).map((item) => ({
        name: item.product?.name ?? item.catalogQuery ?? item.rawName,
        quantity: item.quantity,
        selectionStatus: item.selectionStatus ?? null,
      })),
    },
    plan: {
      intent: result.result?.plan?.intent ?? null,
      executionMode: result.result?.plan?.executionMode ?? null,
    },
    deepseek: {
      calls: providerCalls,
      promptTokens: value('prompt_tokens') || value('input_tokens') || null,
      completionTokens: value('completion_tokens') || value('output_tokens') || null,
      totalTokens: value('total_tokens') || value('totalTokens') || null,
      durationMs: Date.now() - startedAt,
    },
  };
  console.log(`SIM_RESULT::${JSON.stringify(output)}`);
} catch (error) {
  console.log(`SIM_RESULT::${JSON.stringify({ ok: false, error: { message: error.message, code: error.code, stack: error.stack } })}`);
} finally {
  runtime.stop();
  integrationOutbox.stop();
  await store.close?.();
}
