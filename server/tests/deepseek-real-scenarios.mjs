import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { colombiaAgentScenarioSet } from './fixtures/colombiaAgentScenarios.js';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.log('DeepSeek real scenario tests skipped: DEEPSEEK_API_KEY is not configured');
  process.exit(0);
}
const selectedScenarioIds = [
  'categoria_jugos',
  'real_supermarket_saludo_solo_domicilio',
  'real_supermarket_valor_calchichon_coca',
  'real_supermarket_reclamo_faltante_handoff',
  'real_supermarket_pago_tarjeta_es_preferencia',
];

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-deepseek-real-'));
process.env.STORAGE_DRIVER = 'json';
process.env.AUTH_REQUIRED = 'false';
process.env.CSRF_REQUIRED = 'false';
const { createApp } = await import('../index.js');
const { app, store } = createApp({ dataFile: path.join(tempDir, 'store.json') });
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
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1600),
    timeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 30000),
    responseLanguage: 'es-CO',
  };
});

const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const traces = [];
  let intentMatches = 0;
  let checkedSteps = 0;
  let providerApiSteps = 0;

  for (const [scenarioIndex, scenarioId] of selectedScenarioIds.entries()) {
    const scenario = colombiaAgentScenarioSet.find((item) => item.id === scenarioId);
    assert.ok(scenario, `Scenario ${scenarioId} does not exist`);
    const waId = `57399${String(scenarioIndex).padStart(6, '0')}`;
    if (scenario.customer === 'known') seedKnownCustomer(waId, `DeepSeek Cliente ${scenarioIndex + 1}`);
    if (scenario.extraProducts?.length) seedExtraProducts(scenario.extraProducts);

    const steps = scenario.steps ?? [{ text: scenario.text, expect: scenario.expect }];
    for (const [stepIndex, step] of steps.entries()) {
      const run = await postJson(`${base}/api/agent/run`, {
        tenantId: 'andina',
        waId,
        profileName: scenario.customer === 'known' ? `DeepSeek Cliente ${scenarioIndex + 1}` : '',
        text: step.text,
        messageType: step.messageType ?? scenario.messageType,
        mediaRef: step.mediaRef ?? scenario.mediaRef,
        messageId: `deepseek-real-${scenario.id}-${stepIndex}`,
      });
      const plan = run.result.plan;
      checkedSteps += 1;
      if (plan.intent === step.expect.intent) intentMatches += 1;
      assert.equal(plan.provider, 'deepseek', `${scenario.id}: proveedor incorrecto`);
      assert.ok(plan.reasoningMode, `${scenario.id}: falta reasoningMode`);
      assert.ok(plan.responseStrategy, `${scenario.id}: falta responseStrategy`);
      if (plan.executionMode === 'provider_api') {
        providerApiSteps += 1;
      }
      if (['catalog_query', 'delivery_order'].includes(plan.intent) && (plan.candidateItems?.length ?? 0) > 0) {
        assert.ok(plan.toolPlan.some((toolStep) => toolStep.tool === 'google_sheets_read_table'), `${scenario.id}: debe consultar catalogo`);
      }
      traces.push({
        scenarioId: scenario.id,
        step: stepIndex + 1,
        message: step.text ?? scenario.text ?? '',
        expectedIntent: step.expect.intent,
        actualIntent: plan.intent,
        matchedIntent: plan.intent === step.expect.intent,
        executionMode: plan.executionMode,
        responseStrategy: plan.responseStrategy,
        confidence: plan.confidence,
        missingFields: run.conversation.orderDraft?.missingFields ?? plan.missingFields ?? [],
        candidateItems: plan.candidateItems ?? [],
        reply: run.conversation.messages.at(-1)?.text ?? '',
      });
    }
  }

  const matchRate = checkedSteps ? intentMatches / checkedSteps : 0;
  const status = providerApiSteps > 0 ? 'passed' : 'blocked_provider_unreachable_or_rejected';
  fs.writeFileSync(
    path.join(process.cwd(), 'test-results-deepseek-real-scenarios.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      status,
      provider: 'deepseek',
      model: store.getState().platformSettings.llm.model,
      selectedScenarioIds,
      checkedSteps,
      providerApiSteps,
      intentMatches,
      matchRate,
      traces,
    }, null, 2)}\n`,
  );
  if (providerApiSteps === 0) {
    if (process.env.DEEPSEEK_REAL_STRICT === 'true') {
      throw new Error('DeepSeek provider API was not reached by any scenario');
    }
    console.log('DeepSeek real scenario tests blocked: provider API was not reached; diagnostic report written');
    process.exit(0);
  }
  assert.ok(matchRate >= 0.6, `DeepSeek real intent match rate too low: ${matchRate}`);
  console.log(`DeepSeek real scenario tests passed (${intentMatches}/${checkedSteps} intent matches)`);
} finally {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function seedExtraProducts(products) {
  store.mutate((state) => {
    state.productsByTenant ??= {};
    state.productsByTenant.andina ??= [];
    const bySku = new Map(state.productsByTenant.andina.map((product) => [product.sku, product]));
    for (const product of products) bySku.set(product.sku, product);
    state.productsByTenant.andina = [...bySku.values()];
  });
}

function seedKnownCustomer(waId, name) {
  store.mutate((state) => {
    state.customerProfilesByTenant ??= {};
    state.customerProfilesByTenant.andina ??= {};
    state.customerProfilesByTenant.andina[waId] = {
      sheetRowId: `sheet-customer-andina-${waId}`,
      phone: waId,
      name,
      defaultAddress: 'Carrera 15 # 88-20, Bogota',
      addresses: [{ label: 'casa', address: 'Carrera 15 # 88-20, Bogota' }],
      preferences: { channel: 'whatsapp', deliveryDefault: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
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
