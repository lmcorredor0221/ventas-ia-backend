import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../store/jsonStore.js';
import { LLMPlanner } from '../services/llmPlanner.js';
import { bogotaCatalogSeed } from '../data/bogotaCatalogSeed.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-llm-'));
const store = new JsonStore(path.join(tempDir, 'store.json'));
const events = [];
const previousFetch = globalThis.fetch;
const previousApiKey = process.env.TEST_DEEPSEEK_API_KEY;

try {
  store.load();
  store.mutate((state) => {
    state.platformSettings.llm = {
      ...state.platformSettings.llm,
      provider: 'deepseek',
      model: 'deepseek-chat',
      mode: 'json_schema',
      simulator: null,
      apiKeyRef: 'TEST_DEEPSEEK_API_KEY',
      baseUrl: 'https://api.deepseek.com',
      temperature: 0,
      maxTokens: 900,
    };
  });

  process.env.TEST_DEEPSEEK_API_KEY = 'sk-test-deepseek';

  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({
      id: 'chatcmpl-test',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              intent: 'catalog_query',
              reasoningMode: 'shopkeeper_guided_sale',
              customerUnderstanding: {
                rawNeed: 'tienes cafe tostado premium?',
                certainty: 'medium',
                occasion: 'desayuno',
                delivery: true,
              },
              customerDetails: {
                name: 'Laura Gomez',
                deliveryAddress: 'Calle 10 # 20-30, Bogotá',
              },
              candidateItems: [
                { rawName: 'cafe tostado premium', catalogQuery: 'cafe tostado premium', quantity: null, skuHint: null },
              ],
              toolPlan: [
                { tool: 'google_sheets_read_table', purpose: 'catalog_search', filters: { query: 'cafe tostado premium' } },
              ],
              missingInfo: [],
              responseStrategy: 'guide',
              order: {
                delivery: true,
                items: [{ rawName: 'cafe tostado premium', catalogQuery: 'cafe tostado premium', quantity: null }],
              },
              recommendedTools: ['google_sheets_read_table', 'whatsapp_business_messaging'],
              missingFields: [],
              confidence: 0.86,
            }),
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const planner = new LLMPlanner({
    store,
    events: { emit: (event) => events.push(event) },
    config: { llmRequestTimeoutMs: 5000, llmMaxTokens: 900 },
  });

  const plan = await planner.plan({
    tenantId: 'andina',
    conversationId: 'conv-llm-test',
    normalized: {
      text: 'Para un domicilio, tienes cafe tostado premium?',
      waId: '573001112233',
      provider: 'whatsapp',
    },
    customerProfile: null,
    conversation: null,
  });

  assert.equal(capturedUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers.authorization, 'Bearer sk-test-deepseek');
  assert.equal(capturedOptions.headers['content-type'], 'application/json');

  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 900);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.ok(body.messages[1].content.includes('ventas-ia-llm-plan.v2') || body.messages[1].content.includes('toolPlan'));

  assert.equal(plan.executionMode, 'provider_api');
  assert.equal(plan.provider, 'deepseek');
  assert.equal(plan.intent, 'catalog_query');
  assert.equal(plan.reasoningMode, 'shopkeeper_guided_sale');
  assert.deepEqual(plan.customerDetails, {
    name: 'Laura Gomez',
    deliveryAddress: 'Calle 10 # 20-30, Bogotá',
  });

  const createdEvent = events.find((event) => event.type === 'llm.plan.created');
  assert.ok(createdEvent);
  assert.equal(createdEvent.metadata.providerMetadata.usage.total_tokens, 200);
  assert.equal(createdEvent.metadata.providerMetadata.endpoint, 'https://api.deepseek.com/chat/completions');

  delete process.env.TEST_DEEPSEEK_API_KEY;
  store.mutate((state) => {
    state.platformSettings.llm = {
      ...state.platformSettings.llm,
      provider: 'deepseek',
      model: 'deepseek-chat',
      simulator: 'codex',
    };
    state.productsByTenant.andina = bogotaCatalogSeed.map((product) => ({
      sku: product.sku,
      name: product.name,
      category: product.category,
      price: product.price,
      stock: product.stock,
      driveFileId: product.driveFileId,
      aliases: product.aliases,
    }));
  });

  const simulatedPlan = await planner.plan({
    tenantId: 'andina',
    conversationId: 'conv-llm-alias-boundary',
    normalized: {
      text: 'Hola, para un domicilio, me regalas por favor 3 chocorramos y cifrut de granadilla',
      waId: '573001112234',
      provider: 'whatsapp',
    },
    customerProfile: null,
    conversation: null,
  });

  const itemNames = simulatedPlan.order.items.map((item) => item.catalogQuery);
  assert.ok(itemNames.includes('Ponque Chocoramo'));
  assert.ok(itemNames.includes('Cifrut granadilla'));
  assert.equal(itemNames.some((name) => name.includes('Gala')), false);

  const unknownProductPlan = await planner.plan({
    tenantId: 'andina',
    conversationId: 'conv-llm-unknown-products',
    normalized: {
      text: 'Buenas tardes, para un domicilio, me regalas por favor un six pack de club colombia y un paquete de malboro sandia.',
      waId: '573001112235',
      provider: 'whatsapp',
    },
    customerProfile: null,
    conversation: null,
  });

  assert.equal(unknownProductPlan.intent, 'delivery_order');
  assert.equal(unknownProductPlan.order.items.length, 2);
  assert.ok(unknownProductPlan.order.items.some((item) => item.catalogQuery === 'six pack club colombia'));
  assert.ok(unknownProductPlan.order.items.some((item) => item.catalogQuery === 'malboro sandia'));
  assert.equal(unknownProductPlan.missingFields.includes('order_items'), false);
  assert.equal(
    unknownProductPlan.toolPlan.filter((step) => step.tool === 'google_sheets_read_table').length,
    2,
  );
  assert.ok(unknownProductPlan.toolPlan.some((step) => step.tool === 'google_drive_file_picker'));

  const mixedKnownUnknownPlan = await planner.plan({
    tenantId: 'andina',
    conversationId: 'conv-llm-known-and-unknown-products',
    normalized: {
      text: 'Buenas tardes, para un domicilio, me regalas favor 5000 de calchichon y una coca-cola 350',
      waId: '573001112236',
      provider: 'whatsapp',
    },
    customerProfile: null,
    conversation: null,
  });

  assert.equal(mixedKnownUnknownPlan.intent, 'delivery_order');
  assert.ok(mixedKnownUnknownPlan.order.items.some((item) => item.catalogQuery === 'calchichon' && item.budgetAmount === 5000));
  assert.ok(mixedKnownUnknownPlan.order.items.some((item) => item.catalogQuery.includes('coca') && item.requestedPresentation));
  assert.ok(mixedKnownUnknownPlan.toolPlan.some((step) => step.filters?.query === 'calchichon'));

  store.mutate((state) => {
    state.platformSettings.llm = {
      ...state.platformSettings.llm,
      provider: 'mock',
      simulator: null,
      apiKeyRef: 'MISSING_PRODUCTION_LLM_KEY',
    };
  });
  const strictPlanner = new LLMPlanner({
    store,
    events: { emit: (event) => events.push(event) },
    config: {
      allowLocalCatalogFallback: false,
      whatsappMode: 'live',
      llmRequestTimeoutMs: 5000,
      llmMaxTokens: 600,
    },
  });
  const unavailablePlan = await strictPlanner.plan({
    tenantId: 'andina',
    conversationId: 'conv-llm-live-unavailable',
    normalized: {
      text: 'Para un domicilio me regalas dos chocorramos',
      waId: '573001112237',
      provider: 'whatsapp',
    },
    customerProfile: null,
    conversation: null,
  });
  assert.equal(unavailablePlan.executionMode, 'provider_unavailable_handoff');
  assert.equal(unavailablePlan.intent, 'human_handoff');
  assert.deepEqual(unavailablePlan.order.items, []);

  console.log('LLM provider contract tests passed');
} finally {
  globalThis.fetch = previousFetch;
  if (previousApiKey === undefined) {
    delete process.env.TEST_DEEPSEEK_API_KEY;
  } else {
    process.env.TEST_DEEPSEEK_API_KEY = previousApiKey;
  }
  store.close?.();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
