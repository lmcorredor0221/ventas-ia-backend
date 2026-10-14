import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { colombiaAgentScenarioSet } from './fixtures/colombiaAgentScenarios.js';

process.env.STORAGE_DRIVER = 'json';
process.env.AUTH_REQUIRED = 'false';
process.env.CSRF_REQUIRED = 'false';
process.env.LLM_SIMULATOR = 'codex_cli';
delete process.env.DEEPSEEK_API_KEY;

const selectedScenarioIds = [
  'categoria_jugos',
  'real_supermarket_saludo_solo_domicilio',
  'real_supermarket_valor_calchichon_coca',
  'real_supermarket_reclamo_faltante_handoff',
  'real_supermarket_pago_tarjeta_es_preferencia',
];

const { createApp } = await import('../index.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-codex-cli-'));
const { app, store } = createApp({ dataFile: path.join(tempDir, 'store.json') });
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;
  const traces = [];
  let intentMatches = 0;
  let checkedSteps = 0;

  for (const [scenarioIndex, scenarioId] of selectedScenarioIds.entries()) {
    const scenario = colombiaAgentScenarioSet.find((item) => item.id === scenarioId);
    assert.ok(scenario, `Scenario ${scenarioId} does not exist`);
    const waId = `57398${String(scenarioIndex).padStart(6, '0')}`;
    if (scenario.customer === 'known') seedKnownCustomer(waId, `Codex CLI Cliente ${scenarioIndex + 1}`);
    if (scenario.extraProducts?.length) seedExtraProducts(scenario.extraProducts);

    const steps = scenario.steps ?? [{ text: scenario.text, expect: scenario.expect }];
    for (const [stepIndex, step] of steps.entries()) {
      const run = await postJson(`${base}/api/agent/run`, {
        tenantId: 'andina',
        waId,
        profileName: scenario.customer === 'known' ? `Codex CLI Cliente ${scenarioIndex + 1}` : '',
        text: step.text,
        messageType: step.messageType ?? scenario.messageType,
        mediaRef: step.mediaRef ?? scenario.mediaRef,
        messageId: `codex-cli-${scenario.id}-${stepIndex}`,
      });
      const plan = run.result.plan;
      checkedSteps += 1;
      if (plan.intent === step.expect.intent) intentMatches += 1;

      assert.equal(plan.executionMode, 'codex_cli_simulated_deepseek', `${scenario.id}: debe usar Codex CLI`);
      assert.equal(plan.simulatedBy, 'codex_cli', `${scenario.id}: debe dejar trazabilidad de Codex CLI`);
      assert.equal(plan.reasoningMode, 'shopkeeper_guided_sale', `${scenario.id}: debe razonar como tendero`);
      assert.ok(Array.isArray(plan.reasoningNotes) && plan.reasoningNotes.length, `${scenario.id}: debe exponer notas de razonamiento`);

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
  fs.writeFileSync(
    path.join(process.cwd(), 'test-results-codex-cli-scenarios.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      status: 'passed',
      simulator: 'codex_cli',
      selectedScenarioIds,
      checkedSteps,
      intentMatches,
      matchRate,
      traces,
    }, null, 2)}\n`,
  );
  assert.ok(matchRate >= 0.6, `Codex CLI simulated intent match rate too low: ${matchRate}`);
  console.log(`Codex CLI scenario tests passed (${intentMatches}/${checkedSteps} intent matches)`);
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

