import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../index.js';
import { colombiaProducts20 } from '../data/colombiaProducts.js';
import { colombiaAgentScenarioSet } from './fixtures/colombiaAgentScenarios.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventas-ia-colombia-'));
const { app, store } = createApp({ dataFile: path.join(tempDir, 'store.json') });
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  assert.equal(colombiaProducts20.length, 20, 'El catalogo de prueba debe cubrir exactamente 20 productos de tienda.');
  assert.equal(colombiaAgentScenarioSet.length, 40, 'El set debe cubrir exactamente 40 escenarios conversacionales bogotanos.');

  const results = [];
  for (const [index, scenario] of colombiaAgentScenarioSet.entries()) {
    const waId = `57310${String(index).padStart(6, '0')}`;
    if (scenario.customer === 'known') seedKnownCustomer(waId, `Cliente ${index + 1}`);
    if (scenario.extraProducts?.length) seedExtraProducts(scenario.extraProducts);

    const steps = scenario.steps ?? [{ text: scenario.text, expect: scenario.expect }];
    for (const [stepIndex, step] of steps.entries()) {
      const run = await postJson(`${base}/api/agent/run`, {
        tenantId: 'andina',
        waId,
        profileName: scenario.customer === 'known' ? `Cliente ${index + 1}` : '',
        text: step.text,
        messageId: `msg-${scenario.id}-${stepIndex}`,
      });

      assertStep({ scenario, step, run, waId });
      results.push(`${scenario.id}#${stepIndex + 1}:${run.result.plan.intent}`);
    }
  }

  console.log(`Colombia agent scenario tests passed (${results.length} steps, ${colombiaAgentScenarioSet.length} scenarios)`);
} finally {
  server.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function assertStep({ scenario, step, run, waId }) {
  const expectation = step.expect;
  const { plan, summary } = run.result;
  const conversation = run.conversation;
  const reply = conversation.messages.at(-1)?.role === 'agent' ? conversation.messages.at(-1).text : '';

  assert.equal(run.duplicate, false, `${scenario.id}: el mensaje no debe tratarse como duplicado`);
  assert.equal(plan.schemaVersion, 'ventas-ia-llm-plan.v2', `${scenario.id}: debe usar el contrato de planner v2`);
  assert.equal(plan.executionMode, 'codex_simulated_deepseek', `${scenario.id}: debe simular DeepSeek con Codex`);
  assert.equal(plan.simulatedBy, 'codex', `${scenario.id}: debe dejar trazabilidad de simulacion`);
  assert.equal(plan.reasoningMode, 'shopkeeper_guided_sale', `${scenario.id}: debe razonar como tendero`);
  assert.ok(plan.customerUnderstanding?.rawNeed !== undefined, `${scenario.id}: debe conservar entendimiento del cliente`);
  assert.ok(plan.responseStrategy, `${scenario.id}: debe declarar estrategia de respuesta`);
  assert.ok(Array.isArray(plan.toolPlan), `${scenario.id}: debe declarar plan de herramientas`);
  assert.equal(plan.intent, expectation.intent, `${scenario.id}: intent incorrecto`);
  assert.ok(plan.reasoningNotes?.length, `${scenario.id}: debe exponer notas de razonamiento para auditoria`);
  if (['catalog_query', 'delivery_order'].includes(plan.intent)) {
    assert.ok(Array.isArray(plan.candidateItems), `${scenario.id}: debe exponer candidatos de producto`);
    assert.ok(plan.toolPlan.some((step) => step.tool === 'google_sheets_read_table'), `${scenario.id}: debe planear consulta a catalogo`);
  }

  if (expectation.summary) {
    assert.equal(summary, expectation.summary, `${scenario.id}: summary incorrecto`);
  }
  if (expectation.missingFields) {
    const resolvedMissing = plan.intent === 'order_clarification'
      ? conversation.orderDraft?.missingFields ?? []
      : plan.missingFields ?? [];
    assert.deepEqual(new Set(resolvedMissing), new Set(expectation.missingFields), `${scenario.id}: faltantes incorrectos`);
  }
  if (expectation.replyIncludes) {
    for (const fragment of expectation.replyIncludes) {
      assert.ok(reply.includes(fragment), `${scenario.id}: la respuesta no incluye "${fragment}". Respuesta: ${reply}`);
    }
  }
  if (expectation.orderItems) {
    const itemNames = (conversation.orderDraft?.items ?? []).map((item) => item.product?.name ?? item.catalogQuery);
    for (const name of expectation.orderItems) {
      assert.ok(itemNames.includes(name), `${scenario.id}: la canasta no incluye ${name}. Canasta: ${itemNames.join(', ')}`);
    }
  }
  if (expectation.savedProfile) {
    const profile = store.getState().customerProfilesByTenant?.andina?.[waId];
    assert.equal(profile?.name, expectation.savedProfile.name, `${scenario.id}: no guardo nombre en Sheets`);
    assert.equal(profile?.defaultAddress, expectation.savedProfile.defaultAddress, `${scenario.id}: no guardo direccion en Sheets`);
  }
  if (expectation.orderId) {
    assert.ok(conversation.orderId, `${scenario.id}: no escribio pedido confirmado`);
    const orders = store.getState().ordersByTenant?.andina ?? [];
    assert.ok(orders.some((order) => order.id === conversation.orderId), `${scenario.id}: pedido no quedo en Google Sheets mock`);
  }
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
      driveFileId: `drv-customer-andina-${waId}`,
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
  if (!text) return {};
  return JSON.parse(text);
}
