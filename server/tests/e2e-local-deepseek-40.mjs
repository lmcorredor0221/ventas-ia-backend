import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { colombiaAgentScenarioSet } from './fixtures/colombiaAgentScenarios.js';
import { colombiaCatalogTestSeed300 } from '../data/colombiaCatalogExpansion.js';

const { Pool } = pg;
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const officialScenarios = colombiaAgentScenarioSet.slice(0, 40);
const runId = createRunId();
const resultRoot = path.resolve(rootDir, process.env.E2E_RESULT_DIR ?? 'test-results/e2e-local', runId);
const maxCaseDurationMs = positiveInt(process.env.E2E_MAX_CASE_DURATION_MS, 90_000);
const maxDeepSeekCalls = positiveInt(process.env.E2E_MAX_DEEPSEEK_CALLS, 160);
const sourceDatabaseUrl = process.env.E2E_SOURCE_DATABASE_URL ?? process.env.POSTGRES_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const baselineTenantId = process.env.E2E_BASELINE_TENANT_ID ?? 'andina';
const catalogReferenceFixture = process.env.E2E_CATALOG_REFERENCE_FIXTURE ?? 'none';

let runtime = null;
let server = null;
let originalFetch = global.fetch;
let sourceFingerprintBefore = null;
let sourceFingerprintAfter = null;
let cloneInfo = null;
let graphOutbound = [];
let blockedNetwork = [];
let deepSeekCalls = 0;

try {
  validateEnvironment();
  await fs.mkdir(resultRoot, { recursive: true });
  sourceFingerprintBefore = await fingerprintDatabase(sourceDatabaseUrl);
  cloneInfo = await cloneDatabase();
  const cloneDatabaseUrl = databaseUrlForClone(sourceDatabaseUrl, cloneInfo.targetDatabase);

  configureRuntimeEnvironment(cloneDatabaseUrl);
  installNetworkCapture();
  const { createAppAsync } = await import('../index.js');
  runtime = await createAppAsync({
    storageDriver: 'postgres',
    databaseUrl: cloneDatabaseUrl,
    databaseSsl: process.env.DATABASE_SSL ?? 'disable',
    whatsappMode: 'live',
    asyncInboundEnabled: true,
    integrationOutboxEnabled: true,
    backgroundWorkersEnabled: false,
  });

  const shadow = await createShadowTenant(runtime.store, {
    baselineTenantId,
    runId,
    catalogFixture: catalogReferenceFixture === 'colombia300' ? colombiaCatalogTestSeed300 : null,
  });
  const port = await startServer(runtime.app);
  const baseUrl = `http://127.0.0.1:${port}`;
  const meta = createMetaSimulator({ baseUrl, phoneNumberId: shadow.phoneNumberId, tenantId: shadow.tenantId });

  const metaContracts = await runMetaContracts({ meta, runtime, shadow });
  const caseReports = [];
  for (const [index, scenario] of officialScenarios.entries()) {
    if (deepSeekCalls >= maxDeepSeekCalls) {
      const blocked = blockedCaseReport({ index, scenario, reason: `Se alcanzo el limite E2E_MAX_DEEPSEEK_CALLS=${maxDeepSeekCalls}.` });
      caseReports.push(blocked);
      await writeCaseReport(blocked);
      continue;
    }
    const report = await runScenario({ index, scenario, meta, runtime, shadow });
    caseReports.push(report);
    await writeCaseReport(report);
  }

  const confirmedCase = caseReports.find((item) => item.orderId && item.status !== 'infra_error');
  const shopkeeperReport = confirmedCase
    ? await runShopkeeperWorkflow({ baseUrl, meta, runtime, shadow, orderId: confirmedCase.orderId, caseId: confirmedCase.caseId })
    : { status: 'blocked', assertions: [{ name: 'pedido_confirmado', passed: false, detail: 'Ningun escenario genero pedido confirmado.' }] };

  await runtime.store.flush();
  sourceFingerprintAfter = await fingerprintDatabase(sourceDatabaseUrl);
  const summary = buildSummary({ shadow, metaContracts, caseReports, shopkeeperReport });
  await writeEvidence({ shadow, metaContracts, caseReports, shopkeeperReport, summary });

  const passedCases = caseReports.filter((item) => item.status === 'passed').length;
  console.log(`E2E local terminado: ${passedCases}/${officialScenarios.length} casos aprobados. Evidencia: ${path.relative(rootDir, resultRoot)}`);
  if (!sameFingerprint(sourceFingerprintBefore, sourceFingerprintAfter)) {
    throw new Error('La huella de ventas_ia_dev cambio durante la corrida. Revise la evidencia antes de reutilizar la fuente.');
  }
  if (!summary.acceptance.readyForPilot) process.exitCode = 1;
} catch (error) {
  await fs.mkdir(resultRoot, { recursive: true }).catch(() => {});
  await writeJson(path.join(resultRoot, 'fatal-error.json'), sanitize({
    generatedAt: new Date().toISOString(),
    message: error.message,
    stack: error.stack,
    clone: cloneInfo,
  })).catch(() => {});
  console.error(`E2E local no pudo completarse: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  runtime?.runtime.stop();
  await runtime?.integrationOutbox.stop();
  await runtime?.store.close?.();
  global.fetch = originalFetch;
}

function validateEnvironment() {
  if (!sourceDatabaseUrl) throw new Error('Defina E2E_SOURCE_DATABASE_URL o DATABASE_URL. La base fuente nunca se usa como DATABASE_URL de la prueba.');
  const source = new URL(sourceDatabaseUrl);
  if (!isLoopback(source.hostname)) throw new Error('E2E_SOURCE_DATABASE_URL debe apuntar a PostgreSQL local.');
  if (!source.pathname || source.pathname === '/') throw new Error('E2E_SOURCE_DATABASE_URL debe incluir el nombre de la base.');
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY es obligatoria: el E2E rechaza respuestas simuladas.');
  if (process.env.LLM_SIMULATOR) throw new Error('LLM_SIMULATOR debe estar ausente: este E2E requiere DeepSeek provider_api.');
  if (process.env.WHATSAPP_PROVIDER_MODE && process.env.WHATSAPP_PROVIDER_MODE !== 'live') {
    throw new Error('WHATSAPP_PROVIDER_MODE debe ser live para validar el contrato Graph capturado.');
  }
  if (officialScenarios.length !== 40) throw new Error(`La matriz oficial debe contener 40 casos y contiene ${officialScenarios.length}.`);
  if (!['none', 'colombia300'].includes(catalogReferenceFixture)) {
    throw new Error('E2E_CATALOG_REFERENCE_FIXTURE solo permite none o colombia300.');
  }
}

function configureRuntimeEnvironment(databaseUrl) {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DRIVER = 'postgres';
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_SSL ??= 'disable';
  process.env.AUTH_REQUIRED = 'false';
  process.env.CSRF_REQUIRED = 'false';
  process.env.ALLOW_LOCAL_CATALOG_FALLBACK = 'true';
  process.env.INTEGRATION_OUTBOX_ENABLED = 'true';
  process.env.WHATSAPP_ASYNC_INBOUND_ENABLED = 'true';
  process.env.BACKGROUND_WORKERS_ENABLED = 'false';
  process.env.WHATSAPP_PROVIDER_MODE = 'live';
  process.env.WHATSAPP_APP_SECRET ??= 'e2e-webhook-secret-only';
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ??= 'e2e-verify-token-only';
  process.env.E2E_WHATSAPP_ACCESS_TOKEN = 'e2e-graph-capture-token';
}

async function cloneDatabase() {
  const cloneScript = path.join(rootDir, 'scripts', 'e2e', 'clone-postgres-baseline.ps1');
  const output = await execFileText('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', cloneScript,
    '-SourceDatabaseUrl', sourceDatabaseUrl,
    '-RunId', runId,
  ], { cwd: rootDir, env: { ...process.env, E2E_SOURCE_DATABASE_URL: sourceDatabaseUrl, E2E_RUN_ID: runId } });
  const jsonLine = output.stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error(`No se pudo leer el manifiesto del clon PostgreSQL: ${output.stderr || output.stdout}`);
  const cloned = JSON.parse(jsonLine);
  if (!/^ventas_ia_e2e_[a-z0-9_]+$/.test(cloned.targetDatabase ?? '')) throw new Error('El clon no paso la guarda de nombre ventas_ia_e2e_<runId>.');
  return cloned;
}

function databaseUrlForClone(sourceUrl, targetDatabase) {
  const target = new URL(sourceUrl);
  target.pathname = `/${targetDatabase}`;
  return target.toString();
}

function installNetworkCapture() {
  const deepSeekOrigin = new URL(process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').origin;
  global.fetch = async (input, options = {}) => {
    const url = String(input);
    const parsed = new URL(url);
    if (parsed.hostname === 'graph.facebook.com') {
      const body = JSON.parse(String(options.body ?? '{}'));
      const captured = {
        at: new Date().toISOString(),
        url: `${parsed.origin}${parsed.pathname}`,
        to: maskPhone(body.to),
        type: body.type ?? 'text',
        text: body.text?.body ?? body.interactive?.body?.text ?? '',
        interactive: body.interactive ? sanitize(body.interactive) : null,
      };
      graphOutbound.push(captured);
      return jsonResponse({ messaging_product: 'whatsapp', messages: [{ id: `wamid.e2e.${graphOutbound.length}` }] });
    }
    if (parsed.origin === deepSeekOrigin) {
      deepSeekCalls += 1;
      if (deepSeekCalls > maxDeepSeekCalls) throw new Error(`Se alcanzo E2E_MAX_DEEPSEEK_CALLS=${maxDeepSeekCalls}.`);
      return originalFetch(input, options);
    }
    if (isLoopback(parsed.hostname)) return originalFetch(input, options);
    blockedNetwork.push({ url: `${parsed.origin}${parsed.pathname}`, method: options.method ?? 'GET' });
    throw new Error(`Salida de red no permitida durante E2E: ${parsed.origin}`);
  };
}

async function createShadowTenant(store, { baselineTenantId, runId: testRunId, catalogFixture = null }) {
  const source = store.getState();
  const baseline = source.tenants.find((tenant) => tenant.id === baselineTenantId);
  if (!baseline) throw new Error(`No existe el tenant base ${baselineTenantId} en el clon local.`);
  const sourceProducts = source.productsByTenant?.[baselineTenantId] ?? [];
  if (!sourceProducts.length) throw new Error(`El tenant base ${baselineTenantId} no tiene catalogo para validar.`);
  const baseCatalog = mergeCatalogProducts(catalogFixture?.length ? catalogFixture : sourceProducts);
  const tenantId = `e2e_${testRunId}`;
  const phoneNumberId = `e2e-phone-${testRunId}`;
  const shadow = structuredClone(baseline);
  shadow.id = tenantId;
  shadow.name = `E2E ${baseline.name ?? baselineTenantId}`;
  shadow.status = 'active';
  shadow.lifecycle = { ...(shadow.lifecycle ?? {}), access: 'active', activationStatus: 'active', subscriptionStatus: 'active' };
  shadow.config ??= {};
  shadow.config.whatsapp = {
    ...(shadow.config.whatsapp ?? {}),
    phoneNumberId,
    phoneNumberIdRef: 'E2E_WHATSAPP_PHONE_NUMBER_ID',
    accessTokenRef: 'E2E_WHATSAPP_ACCESS_TOKEN',
    verifyTokenRef: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    appSecretRef: 'WHATSAPP_APP_SECRET',
  };
  shadow.config.googleSheets = {
    ...(shadow.config.googleSheets ?? {}),
    range: 'Catalogo!A1:P1000',
    catalogRange: 'Catalogo!A1:P1000',
  };
  shadow.config.agentPolicy = { ...(shadow.config.agentPolicy ?? {}), tone: 'tendero_colombiano', responseLanguage: 'es-CO' };
  shadow.config.saas = {
    ...(shadow.config.saas ?? {}),
    enforceEntitlement: false,
    includedDeliveries: Math.max(Number(shadow.config.saas?.includedDeliveries ?? 400), 400),
    includedInteractions: Math.max(Number(shadow.config.saas?.includedInteractions ?? 2700), 2700),
  };

  store.mutate((state) => {
    state.tenants = [...state.tenants.filter((tenant) => tenant.id !== tenantId), shadow];
    state.productsByTenant ??= {};
    state.productsByTenant[tenantId] = structuredClone(baseCatalog);
    state.driveFilesByTenant ??= {};
    state.driveFilesByTenant[tenantId] = structuredClone(source.driveFilesByTenant?.[baselineTenantId] ?? []);
    state.customerProfilesByTenant ??= {};
    state.customerProfilesByTenant[tenantId] = {};
    state.ordersByTenant ??= {};
    state.ordersByTenant[tenantId] = [];
    state.googleConnectionsByTenant ??= {};
    state.googleConnectionsByTenant[tenantId] = { tenantId, status: 'disconnected', mode: 'local', accountEmail: null, refreshTokenRef: null, updatedAt: new Date().toISOString() };
    state.googleWorkspacesByTenant ??= {};
    state.googleWorkspacesByTenant[tenantId] = { tenantId, status: 'not_provisioned', spreadsheet: null, rootFolder: null, updatedAt: new Date().toISOString() };
    state.subscriptionsByTenant ??= {};
    const subscription = structuredClone(state.subscriptionsByTenant[baselineTenantId] ?? {});
    state.subscriptionsByTenant[tenantId] = {
      ...subscription,
      id: `sub-${tenantId}`,
      tenantId,
      status: 'active',
      currentPeriodStart: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString(),
    };
    state.platformSettings ??= {};
    state.platformSettings.llm = {
      ...(state.platformSettings.llm ?? {}),
      provider: 'deepseek',
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      simulator: null,
      apiKeyRef: 'DEEPSEEK_API_KEY',
      baseUrlRef: 'DEEPSEEK_BASE_URL',
      temperature: 0,
      maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 1200),
      timeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 30_000),
      responseLanguage: 'es-CO',
    };
  });
  await store.flush();
  return {
    tenantId,
    phoneNumberId,
    baselineTenantId,
    productCount: baseCatalog.length,
    catalogSource: catalogFixture?.length ? 'colombia300_reference' : 'baseline_tenant',
    baseCatalog,
    tenantName: shadow.name,
  };
}

function mergeCatalogProducts(products = []) {
  const bySku = new Map();
  for (const product of products) {
    if (!product?.sku) continue;
    bySku.set(product.sku, structuredClone(product));
  }
  return [...bySku.values()];
}

async function resetScenarioCatalog(store, shadow, extraProducts = []) {
  const catalog = mergeCatalogProducts([...shadow.baseCatalog, ...extraProducts]);
  // The tenant and the database already belong to this run's disposable clone.
  // Replacing its catalog before each scenario prevents products introduced for
  // one case from changing another case's candidate set.
  store.mutate((state) => {
    state.productsByTenant ??= {};
    state.productsByTenant[shadow.tenantId] = structuredClone(catalog);
  });
  await store.pool.query('DELETE FROM products WHERE tenant_id = $1', [shadow.tenantId]);
  await store.flush();
  const persisted = await store.listProducts(shadow.tenantId);
  if (persisted.length !== catalog.length) {
    throw new Error(`El catalogo aislado E2E no se pudo restaurar: esperado=${catalog.length}, persistido=${persisted.length}.`);
  }
}

async function runMetaContracts({ meta, runtime, shadow }) {
  const contracts = [];
  const valid = await fetch(`${meta.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=e2e-challenge`);
  contracts.push(assertion('webhook_get_valid', valid.status === 200 && await valid.text() === 'e2e-challenge', `HTTP ${valid.status}`));
  const invalid = await fetch(`${meta.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=incorrect&hub.challenge=e2e-challenge`);
  contracts.push(assertion('webhook_get_invalid', invalid.status === 403, `HTTP ${invalid.status}`));
  const invalidSignature = await meta.postRaw(meta.textPayload({ messageId: `wamid.${runId}.invalid`, waId: '573000000001', text: 'firma invalida' }), 'sha256=invalid');
  contracts.push(assertion('webhook_hmac_invalid', invalidSignature.response.status === 403, `HTTP ${invalidSignature.response.status}`));
  const delivery = await meta.sendDeliveryStatus({ messageId: `wamid.${runId}.delivery`, waId: '573000000001' });
  contracts.push(assertion('delivery_status_ignored', delivery.body.ignored === true, JSON.stringify(delivery.body)));
  contracts.push(assertion('tenant_phone_binding', runtime.store.getState().tenants.some((tenant) => tenant.id === shadow.tenantId && tenant.config?.whatsapp?.phoneNumberId === shadow.phoneNumberId), shadow.phoneNumberId));
  return contracts;
}

async function runScenario({ index, scenario, meta, runtime, shadow }) {
  const startedAt = Date.now();
  const caseId = `${String(index + 1).padStart(2, '0')}-${scenario.id}`;
  const waId = `57380${String(index + 1).padStart(6, '0')}`;
  const profileName = scenario.customer === 'known' ? `Cliente E2E ${String(index + 1).padStart(2, '0')}` : '';
  const report = {
    caseId,
    scenarioId: scenario.id,
    title: scenario.level,
    status: 'passed',
    startedAt: new Date(startedAt).toISOString(),
    durationMs: null,
    actorTrace: { customer: maskPhone(waId), shopkeeper: false, meta: true },
    assertions: [],
    steps: [],
    graphOutbound: [],
    orderId: null,
    errors: [],
  };
  try {
    await resetScenarioCatalog(runtime.store, shadow, scenario.extraProducts ?? []);
    if (scenario.customer === 'known') await seedKnownCustomer(runtime.store, shadow.tenantId, waId, profileName);
    const steps = scenario.steps ?? [{ text: scenario.text, expect: scenario.expect, messageType: scenario.messageType, mediaRef: scenario.mediaRef }];
    let firstMessageId = null;
    for (const [stepIndex, sourceStep] of steps.entries()) {
      const useInteractivePayment = shouldUseInteractivePayment(scenario, stepIndex, report);
      const step = useInteractivePayment ? interactionStepFromOffer(report) : sourceStep;
      const messageId = `wamid.${runId}.${String(index + 1).padStart(2, '0')}.${stepIndex + 1}`;
      firstMessageId ??= messageId;
      const outboundBefore = graphOutbound.length;
      const result = step.interactive
        ? await meta.sendInteractive({ messageId, waId, profileName, option: step.interactive })
        : await meta.sendText({ messageId, waId, profileName, text: step.text ?? '', messageType: step.messageType ?? 'text', mediaRef: step.mediaRef });
      report.assertions.push(assertion(`step_${stepIndex + 1}_ack`, result.elapsedMs < 1_000 && result.body.queued === true, `ack ${result.elapsedMs}ms ${JSON.stringify(result.body)}`));
      const inbound = await drainUntilInbound(runtime, messageId, maxCaseDurationMs);
      const conversation = inbound.result?.conversationId ? await runtime.store.getConversation(inbound.result.conversationId) : null;
      const plan = conversation?.reasoningPlan ?? null;
      const events = (await runtime.store.listEvents({ tenantId: shadow.tenantId, limit: 2000 }))
        .filter((event) => event.conversationId === conversation?.id);
      const responseMessages = graphOutbound.slice(outboundBefore).filter((outbound) => outbound.to === maskPhone(waId));
      const reply = responseMessages.at(-1)?.text ?? conversation?.messages?.at(-1)?.text ?? '';
      const stepReport = {
        step: stepIndex + 1,
        kind: step.interactive ? 'interactive_button_reply' : step.messageType ?? 'text',
        customerMessage: step.interactive ? step.interactive.title : step.text ?? '',
        inbound: { status: inbound.status, attempts: inbound.attempts, queuedAt: inbound.createdAt, completedAt: inbound.completedAt },
        timing: {
          webhookAckMs: result.elapsedMs,
          workerProcessingMs: elapsedMs(
            events.find((event) => event.type === 'agent.started')?.at,
            events.find((event) => ['agent.completed', 'agent.failed'].includes(event.type))?.at,
          ),
          llm: summarizeLlmEvents(events),
        },
        conversationId: conversation?.id ?? null,
        plan: plan ? sanitizePlan(plan) : null,
        events: events.map((event) => ({
          type: event.type,
          at: event.at,
          detail: event.detail,
          metadata: event.metadata,
        })),
        reply,
        outbound: responseMessages,
        orderDraft: sanitizeOrderDraft(conversation?.orderDraft),
        semanticEvidence: buildSemanticEvidence({ plan, conversation, events, responseMessages }),
      };
      report.steps.push(stepReport);
      evaluateStep({ report, stepIndex, scenario, sourceStep, step, plan, conversation, reply, events, responseMessages });
      if (inbound.status !== 'completed') throw new Error(`Inbound ${messageId} termino en ${inbound.status}: ${inbound.lastError ?? ''}`);
      if (Date.now() - startedAt > maxCaseDurationMs) throw new Error(`El caso excedio ${maxCaseDurationMs}ms.`);
    }
    const finalConversation = await runtime.store.findConversationByWa(shadow.tenantId, waId);
    report.orderId = finalConversation?.orderId ?? null;
    report.databaseSnapshot = sanitize({
      conversation: finalConversation ? {
        id: finalConversation.id,
        status: finalConversation.status,
        caseStatus: finalConversation.caseStatus,
        orderId: finalConversation.orderId ?? null,
        orderDraft: sanitizeOrderDraft(finalConversation.orderDraft),
      } : null,
      order: report.orderId ? runtime.orders.findOrder(report.orderId, shadow.tenantId) : null,
    });
    report.outbox = sanitize((await runtime.store.listOutbox({ limit: 250 }))
      .filter((entry) => entry.tenantId === shadow.tenantId)
      .map((entry) => ({ id: entry.id, kind: entry.kind, aggregateId: entry.aggregateId, status: entry.status, attempts: entry.attempts, lastError: entry.lastError })));
    if (scenario.expect?.orderId || scenario.steps?.at(-1)?.expect?.orderId) {
      report.assertions.push(assertion('pedido_confirmado_persistido', Boolean(report.orderId), `orderId=${report.orderId ?? 'null'}`));
      const order = runtime.orders.findOrder(report.orderId, shadow.tenantId);
      report.order = sanitize(order);
      report.assertions.push(assertion('subtotal_persistido', Number(order?.subtotal ?? -1) >= 0, `subtotal=${order?.subtotal}`));
    }
    if (firstMessageId) {
      const duplicate = await meta.sendText({ messageId: firstMessageId, waId, profileName, text: scenario.text ?? scenario.steps?.[0]?.text ?? '' });
      report.assertions.push(assertion('deduplicacion_meta', duplicate.body.duplicate === true && duplicate.body.queued === false, JSON.stringify(duplicate.body)));
    }
  } catch (error) {
    report.errors.push({ message: error.message, stack: shortStack(error.stack) });
  }
  if (report.errors.length) report.status = report.errors.some((error) => /DeepSeek|provider_api|E2E_MAX|Salida de red|Inbound/.test(error.message)) ? 'infra_error' : 'failed_contract';
  else if (report.assertions.some((item) => !item.passed)) report.status = classifyFailedCase(report);
  report.failureCauses = [...new Set([
    ...report.errors.map(() => 'infrastructure'),
    ...report.assertions.filter((item) => !item.passed).map(classifyFailureCause),
  ])];
  report.durationMs = Date.now() - startedAt;
  report.finishedAt = new Date().toISOString();
  report.graphOutbound = graphOutbound.filter((outbound) => report.steps.some((step) => step.outbound.includes(outbound)));
  return report;
}

function shouldUseInteractivePayment(scenario, stepIndex, report) {
  if (!['pedido_confirmado_dale_hagale', 'pedido_confirmado_handoff_operaciones'].includes(scenario.id)) return false;
  if (stepIndex !== 1) return false;
  return report.steps.at(-1)?.outbound.some((outbound) => outbound.interactive?.type === 'button' || outbound.interactive?.type === 'list') ?? false;
}

function interactionStepFromOffer(report) {
  const interactive = report.steps.at(-1).outbound.find((outbound) => outbound.interactive)?.interactive;
  const option = interactive.type === 'button'
    ? interactive.action.buttons.find((button) => /efectivo|bre-b/i.test(button.reply.title))?.reply
    : interactive.action.sections.flatMap((section) => section.rows).find((row) => /efectivo|bre-b/i.test(row.title));
  if (!option) throw new Error('Meta no recibio un boton de pago elegible para simular la seleccion del cliente.');
  return { interactive: { id: option.id, title: option.title } };
}

function evaluateStep({ report, stepIndex, scenario, sourceStep, step, plan, conversation, reply, events, responseMessages }) {
  const expectation = sourceStep.expect ?? scenario.expect ?? {};
  const prefix = `step_${stepIndex + 1}`;
  if (step.interactive) {
    report.assertions.push(assertion(`${prefix}_oferta_consumida`, Number(conversation?.orderDraft?.version ?? 0) > 0, JSON.stringify(sanitizeOrderDraft(conversation?.orderDraft))));
    report.assertions.push(assertion(`${prefix}_sin_fallback_llm`, !events.some((event) => event.type === 'llm.reply.fallback'), 'Seleccion interactiva no debe provocar fallback.'));
    return;
  }
  report.assertions.push(assertion(`${prefix}_deepseek_provider`, plan?.provider === 'deepseek', plan?.provider ?? 'sin plan'));
  report.assertions.push(assertion(`${prefix}_deepseek_real`, plan?.executionMode === 'provider_api', plan?.executionMode ?? 'sin plan'));
  report.assertions.push(assertion(`${prefix}_sin_fallback_llm`, !events.some((event) => event.type === 'llm.plan.fallback' || event.type === 'llm.reply.fallback'), 'Se detecto fallback del LLM.'));
  const semanticFrame = plan?.semanticFrame;
  report.assertions.push(assertion(
    `${prefix}_semantic_frame`,
    semanticFrame?.schemaVersion === 'semantic-frame.v1'
      && (semanticFrame.items ?? []).every((item) => item.rawItemId && item.rawText),
    JSON.stringify(semanticFrame ?? null),
  ));
  if ((semanticFrame?.items ?? []).length) {
    const resolutions = events.filter((event) => event.type === 'catalog.candidates.evaluated');
    report.assertions.push(assertion(
      `${prefix}_resolution_trace`,
      resolutions.length >= semanticFrame.items.length,
      JSON.stringify(resolutions.map((event) => event.metadata?.decision ?? null)),
    ));
  }
  if (conversation?.orderDraft) {
    report.assertions.push(assertion(
      `${prefix}_draft_versioned`,
      Number.isInteger(Number(conversation.orderDraft.version)) && Number(conversation.orderDraft.version) > 0,
      JSON.stringify(sanitizeOrderDraft(conversation.orderDraft)),
    ));
  }
  if (expectation.intent) report.assertions.push(assertion(`${prefix}_intent`, plan?.intent === expectation.intent, `esperado=${expectation.intent}; actual=${plan?.intent}`));
  for (const expected of expectation.missingFields ?? []) {
    const missing = conversation?.orderDraft?.missingFields ?? plan?.missingFields ?? [];
    report.assertions.push(assertion(`${prefix}_missing_${slug(expected)}`, missing.some((actual) => missingFieldMatches(expected, actual, conversation)), JSON.stringify(missing)));
  }
  for (const expected of expectation.replyIncludes ?? []) {
    report.assertions.push(assertion(`${prefix}_reply_${slug(expected)}`, normalized(reply).includes(normalized(expected)), reply));
  }
  for (const forbidden of expectation.notReplyIncludes ?? []) {
    report.assertions.push(assertion(`${prefix}_reply_not_${slug(forbidden)}`, !normalized(reply).includes(normalized(forbidden)), reply));
  }
  const items = (conversation?.orderDraft?.items ?? []).map((item) => item.product?.name ?? item.catalogQuery ?? item.skuHint ?? '');
  for (const expected of expectation.orderItems ?? []) {
    report.assertions.push(assertion(`${prefix}_item_${slug(expected)}`, items.some((item) => normalized(item).includes(normalized(expected))), JSON.stringify(items)));
  }
  for (const forbidden of expectation.notOrderItems ?? []) {
    report.assertions.push(assertion(`${prefix}_item_not_${slug(forbidden)}`, !items.some((item) => normalized(item).includes(normalized(forbidden))), JSON.stringify(items)));
  }
  if (expectation.paymentMethod) report.assertions.push(assertion(`${prefix}_payment`, conversation?.orderDraft?.paymentMethod === expectation.paymentMethod, conversation?.orderDraft?.paymentMethod ?? 'null'));
  if (expectation.savedProfile) {
    const profile = runtimeProfile(conversation, report);
    report.assertions.push(assertion(`${prefix}_profile_name`, normalized(profile?.name).includes(normalized(expectation.savedProfile.name)), profile?.name ?? 'sin perfil'));
    report.assertions.push(assertion(`${prefix}_profile_address`, normalized(profile?.defaultAddress).includes(normalized(expectation.savedProfile.defaultAddress)), profile?.defaultAddress ?? 'sin perfil'));
  }
  if ((expectation.missingFields ?? []).includes('payment_method')) {
    report.assertions.push(assertion(`${prefix}_pago_interactivo`, responseMessages.some((outbound) => outbound.interactive), JSON.stringify(responseMessages)));
  }
  if (expectation.paymentOffer) {
    const paymentTitles = responseMessages
      .flatMap((outbound) => outbound.interactive?.action?.buttons ?? [])
      .map((button) => normalized(button?.reply?.title));
    report.assertions.push(assertion(
      `${prefix}_oferta_pago_interactiva`,
      ['efectivo', 'tarjeta', 'bre-b'].every((title) => paymentTitles.includes(title)),
      JSON.stringify(responseMessages),
    ));
  }
  if (expectation.options) assertSemanticCatalogOptions({ report, prefix, options: expectation.options, events, reply });
}

function buildSemanticEvidence({ plan, conversation, events, responseMessages }) {
  const catalogEvents = events.filter((event) => event.type === 'catalog.candidates.evaluated');
  return {
    semanticFrame: sanitize(plan?.semanticFrame ?? null),
    candidateSets: sanitize(catalogEvents.map((event) => ({
      rawItemId: event.metadata?.rawItemId ?? null,
      query: event.metadata?.query ?? null,
      candidates: event.metadata?.candidates ?? [],
      presentedCandidates: event.metadata?.presentedCandidates ?? [],
    }))),
    resolutionSets: sanitize(catalogEvents.map((event) => ({
      rawItemId: event.metadata?.rawItemId ?? null,
      status: event.metadata?.decision ?? null,
      reason: event.metadata?.reason ?? null,
      selectedSku: event.metadata?.selectedSku ?? null,
    }))),
    orderDraft: sanitizeOrderDraft(conversation?.orderDraft),
    draftTransitions: sanitize(events.filter((event) => event.type === 'order.draft.updated').map((event) => event.metadata)),
    replyFacts: sanitize(events.filter((event) => event.type === 'reply.facts.prepared').map((event) => event.metadata?.replyFacts ?? null)),
    interactiveOffers: sanitize(responseMessages.filter((message) => message.interactive).map((message) => message.interactive)),
  };
}

function assertSemanticCatalogOptions({ report, prefix, options, events, reply }) {
  const catalogEvents = events.filter((event) => event.type === 'catalog.candidates.evaluated' && event.metadata?.decision === 'catalog_option_proposed');
  const presented = catalogEvents.flatMap((event) => event.metadata?.presentedCandidates ?? []);
  const candidates = uniqueCandidates(presented.length
    ? presented
    : catalogEvents.flatMap((event) => event.metadata?.candidates ?? []));
  const active = candidates.filter((item) => item.active !== false && Number(item.stock ?? 0) > 0);
  const searchable = (item) => normalized([
    item.name,
    item.category,
    item.productFamily,
    ...(Array.isArray(item.tags) ? item.tags : []),
  ].filter(Boolean).join(' '));
  if (options.min !== undefined) report.assertions.push(assertion(`${prefix}_options_min`, active.length >= Number(options.min), JSON.stringify(active)));
  if (options.max !== undefined) report.assertions.push(assertion(`${prefix}_options_max`, active.length <= Number(options.max), JSON.stringify(active)));
  if (options.mustMatchAny?.length) report.assertions.push(assertion(
    `${prefix}_options_relevant`,
    options.mustMatchAny.some((term) => active.some((item) => searchable(item).includes(normalized(term)))),
    JSON.stringify(active),
  ));
  if (options.mustBeActive) report.assertions.push(assertion(`${prefix}_options_active`, active.length > 0 && active.length === candidates.length, JSON.stringify(candidates)));
  if (options.mustHave?.length) report.assertions.push(assertion(
    `${prefix}_options_shape`,
    active.length > 0 && active.every((item) => options.mustHave.every((field) => item[field] !== null && item[field] !== undefined && item[field] !== '')),
    JSON.stringify(active),
  ));
  if (options.diverseFamilies) report.assertions.push(assertion(
    `${prefix}_options_diverse`,
    new Set(active.map((item) => normalized(item.productFamily ?? item.category ?? item.name))).size >= 2,
    JSON.stringify(active),
  ));
  if (options.unrelatedFamilies?.length) report.assertions.push(assertion(
    `${prefix}_options_without_unrelated`,
    options.unrelatedFamilies.every((term) => !active.some((item) => sameSemanticTerms(term, searchable(item)))),
    JSON.stringify(active),
  ));
  if (options.noInventedPrice) {
    const allowed = new Set(active.map((item) => Number(item.price ?? 0)).filter(Boolean));
    const mentioned = [...String(reply ?? '').matchAll(/\$\s*([\d.]+)/g)].map((match) => Number(match[1].replace(/\./g, '')));
    report.assertions.push(assertion(`${prefix}_options_no_invented_price`, mentioned.every((price) => allowed.has(price)), JSON.stringify({ mentioned, allowed: [...allowed] })));
  }
}

function uniqueCandidates(candidates = []) {
  const bySku = new Map();
  for (const candidate of candidates) {
    const key = candidate?.sku ?? `${candidate?.name ?? ''}:${candidate?.presentation ?? ''}`;
    if (key && !bySku.has(key)) bySku.set(key, candidate);
  }
  return [...bySku.values()];
}

function missingFieldMatches(expected, actual, conversation) {
  if (expected === actual) return true;
  const prefix = ['presentation:', 'quantity:'].find((candidate) => String(expected).startsWith(candidate));
  if (!prefix || !String(actual).startsWith(prefix)) return false;
  const expectedQuery = String(expected).replace(prefix, '');
  const rawItemId = String(actual).replace(prefix, '');
  if (prefix === 'quantity:') return sameSemanticTerms(expectedQuery, rawItemId);
  const item = (conversation?.orderDraft?.items ?? []).find((candidate) => candidate.rawItemId === rawItemId);
  const itemText = normalized(`${item?.rawName ?? ''} ${item?.catalogQuery ?? ''} ${item?.product?.name ?? ''}`);
  const target = normalized(expectedQuery);
  return Boolean(item && (itemText.includes(target) || target.includes(itemText) || sameSemanticTerms(target, itemText)));
}

function sameSemanticTerms(expected, actual) {
  const expectedTerms = normalized(expected).split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
  const actualTerms = new Set(normalized(actual).split(/[^a-z0-9]+/).filter((term) => term.length >= 3));
  return expectedTerms.length > 0 && expectedTerms.every((term) => actualTerms.has(term));
}

function runtimeProfile(conversation, report) {
  const wa = report.actorTrace.customer;
  const state = runtime?.store.getState();
  const actualWa = conversation?.waId;
  return state?.customerProfilesByTenant?.[conversation?.tenantId]?.[actualWa] ?? (wa ? null : null);
}

async function runShopkeeperWorkflow({ baseUrl, meta, runtime: activeRuntime, shadow, orderId, caseId }) {
  const report = { caseId, orderId, status: 'passed', assertions: [], outboundBefore: graphOutbound.length, errors: [] };
  try {
    const pending = (await getJson(`${baseUrl}/api/pending-requests?tenantId=${encodeURIComponent(shadow.tenantId)}`))
      .find((request) => request.contextSnapshot?.orderId === orderId && request.status === 'pending');
    report.assertions.push(assertion('tendero_puede_ver_tarea', Boolean(pending), pending?.id ?? 'sin tarea'));
    if (!pending) throw new Error('No se encontro tarea operativa para el pedido confirmado.');
    const taken = await postJson(`${baseUrl}/api/pending-requests/${encodeURIComponent(pending.id)}/resolve`, { outcome: 'approved', approverId: 'e2e-tendero', responseMode: 'none' });
    report.assertions.push(assertion('tendero_toma_pedido', taken.status === 'resolved', taken.status));
    const preparing = activeRuntime.orders.findOrder(orderId, shadow.tenantId);
    report.assertions.push(assertion('pedido_alistando', preparing?.status === 'preparing', preparing?.status ?? 'sin pedido'));
    const dispatched = await patchJson(`${baseUrl}/api/orders/${encodeURIComponent(orderId)}/status`, { status: 'dispatched' });
    report.assertions.push(assertion('tendero_marca_en_camino', dispatched.status === 'dispatched', dispatched.status));
    await activeRuntime.integrationOutbox.drain();
    await activeRuntime.store.flush();
    const conversation = await activeRuntime.store.getConversation(preparing.conversationId);
    const dispatchOutbounds = graphOutbound.slice(report.outboundBefore);
    report.assertions.push(assertion('cliente_recibe_aviso_en_camino', dispatchOutbounds.some((item) => /en camino/i.test(item.text)), JSON.stringify(dispatchOutbounds)));
    report.assertions.push(assertion('conversacion_cerrada_al_despachar', ['completed', 'resolved'].includes(conversation?.caseStatus ?? conversation?.status), `${conversation?.caseStatus}/${conversation?.status}`));
    const next = await meta.sendText({ messageId: `wamid.${runId}.post-dispatch`, waId: conversation.waId, profileName: 'Cliente E2E nuevo pedido', text: 'Buenas, me regalas un chocorramo?' });
    report.assertions.push(assertion('nuevo_mensaje_aceptado', next.body.queued === true, JSON.stringify(next.body)));
    const inbound = await drainUntilInbound(activeRuntime, `wamid.${runId}.post-dispatch`, maxCaseDurationMs);
    const newerConversationId = inbound.result?.conversationId;
    report.assertions.push(assertion('nuevo_pedido_nueva_conversacion', newerConversationId !== conversation.id, `${conversation.id} -> ${newerConversationId}`));
  } catch (error) {
    report.errors.push({ message: error.message, stack: shortStack(error.stack) });
  }
  if (report.errors.length || report.assertions.some((item) => !item.passed)) report.status = 'failed_functional';
  return report;
}

function createMetaSimulator({ baseUrl, phoneNumberId, tenantId }) {
  const postRaw = async (payload, signature) => {
    const body = JSON.stringify(payload);
    const response = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? signatureFor(body) },
      body,
    });
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : {}, elapsedMs: 0 };
  };
  const send = async ({ messageId, waId, profileName, text, messageType = 'text', mediaRef, interactive }) => {
    const payload = interactive
      ? interactivePayload({ messageId, waId, profileName, phoneNumberId, option: interactive })
      : textPayload({ messageId, waId, profileName, phoneNumberId, text, messageType, mediaRef });
    const body = JSON.stringify(payload);
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signatureFor(body) },
      body,
    });
    const responseText = await response.text();
    return { body: responseText ? JSON.parse(responseText) : {}, response, elapsedMs: Date.now() - startedAt };
  };
  return {
    baseUrl,
    tenantId,
    postRaw,
    sendText: (input) => send(input),
    sendInteractive: ({ option, ...input }) => send({ ...input, interactive: option }),
    sendDeliveryStatus: async ({ messageId, waId }) => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [{ id: 'waba-e2e', changes: [{ field: 'messages', value: { metadata: { display_phone_number: '+1 555 202 4079', phone_number_id: phoneNumberId }, statuses: [{ id: messageId, recipient_id: waId, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }],
      };
      const body = JSON.stringify(payload);
      const response = await fetch(`${baseUrl}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signatureFor(body) }, body });
      const text = await response.text();
      return { response, body: text ? JSON.parse(text) : {} };
    },
    textPayload: ({ messageId, waId, text }) => textPayload({ messageId, waId, profileName: 'E2E', phoneNumberId, text }),
  };
}

function textPayload({ messageId, waId, profileName, phoneNumberId, text, messageType = 'text', mediaRef }) {
  const message = messageType === 'image'
    ? { id: messageId, from: waId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: mediaRef ?? `media-${messageId}`, caption: text } }
    : { id: messageId, from: waId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } };
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-e2e', changes: [{ field: 'messages', value: { metadata: { display_phone_number: '+1 555 202 4079', phone_number_id: phoneNumberId }, contacts: [{ profile: { name: profileName || 'Cliente E2E' }, wa_id: waId }], messages: [message] } }] }] };
}

function interactivePayload({ messageId, waId, profileName, phoneNumberId, option }) {
  return { object: 'whatsapp_business_account', entry: [{ id: 'waba-e2e', changes: [{ field: 'messages', value: { metadata: { display_phone_number: '+1 555 202 4079', phone_number_id: phoneNumberId }, contacts: [{ profile: { name: profileName || 'Cliente E2E' }, wa_id: waId }], messages: [{ id: messageId, from: waId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: option.id, title: option.title } } }] } }] }] };
}

function signatureFor(body) {
  return `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(body).digest('hex')}`;
}

async function drainUntilInbound(activeRuntime, messageId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await activeRuntime.integrationOutbox.drain();
    last = await activeRuntime.store.getInboundMessage(messageId);
    if (['completed', 'dead_letter'].includes(last?.status)) return last;
    await delay(20);
  }
  throw new Error(`Timeout esperando inbound ${messageId}; ultimo estado ${last?.status ?? 'no creado'}.`);
}

async function seedKnownCustomer(store, tenantId, waId, name) {
  store.mutate((state) => {
    state.customerProfilesByTenant ??= {};
    state.customerProfilesByTenant[tenantId] ??= {};
    state.customerProfilesByTenant[tenantId][waId] = {
      sheetRowId: `e2e-profile-${waId}`,
      phone: waId,
      name,
      defaultAddress: 'Calle E2E 100 # 10-20, Bogota',
      addresses: [{ label: 'casa', address: 'Calle E2E 100 # 10-20, Bogota' }],
      preferences: { channel: 'whatsapp', deliveryDefault: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
  await store.persistCustomerProfile(tenantId, waId);
}

async function fingerprintDatabase(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, ssl: false });
  try {
    const result = await pool.query(`
      SELECT json_build_object(
        'database', current_database(),
        'app_state', (SELECT md5(COALESCE(document::text, '')) FROM app_state WHERE id = 'runtime'),
        'tenants', (SELECT count(*)::int FROM tenants),
        'products', (SELECT count(*)::int FROM products),
        'conversations', (SELECT count(*)::int FROM conversations),
        'orders', (SELECT count(*)::int FROM orders),
        'inbound_messages', (SELECT count(*)::int FROM inbound_messages),
        'outbox', (SELECT count(*)::int FROM integration_outbox)
      ) AS value
    `);
    const value = result.rows[0]?.value ?? {};
    return { ...value, fingerprint: crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') };
  } finally {
    await pool.end();
  }
}

async function writeCaseReport(report) {
  const caseDir = path.join(resultRoot, 'cases', report.caseId);
  await fs.mkdir(caseDir, { recursive: true });
  await writeJson(path.join(caseDir, 'case-report.json'), sanitize(report));
  await writeJson(path.join(caseDir, 'timeline.json'), sanitize(report.steps.map((step) => ({
    step: step.step,
    inbound: step.inbound,
    conversationId: step.conversationId,
    kind: step.kind,
  }))));
  await writeJson(path.join(caseDir, 'meta-inbound.redacted.json'), sanitize(report.steps.map((step) => ({
    messageType: step.kind,
    customerMessage: step.customerMessage,
    inbound: step.inbound,
  }))));
  await writeJson(path.join(caseDir, 'planner.json'), sanitize(report.steps.map((step) => step.plan)));
  await writeJson(path.join(caseDir, 'events.json'), sanitize(report.steps.map((step) => ({
    step: step.step,
    conversationId: step.conversationId,
    events: step.events ?? [],
  }))));
  await writeJson(path.join(caseDir, 'graph-outbound.json'), sanitize(report.graphOutbound));
  await writeJson(path.join(caseDir, 'database-snapshot.json'), sanitize(report.databaseSnapshot ?? null));
  await writeJson(path.join(caseDir, 'outbox.json'), sanitize(report.outbox ?? []));
  const markdown = [
    `# ${report.caseId}`,
    '',
    `Estado: **${report.status}**`,
    '',
    `Duracion: ${report.durationMs ?? 0} ms`,
    '',
    '## Aserciones',
    ...report.assertions.map((item) => `- ${item.passed ? 'PASS' : 'FAIL'} ${item.name}: ${item.detail}`),
    ...(report.errors.length ? ['', '## Errores', ...report.errors.map((error) => `- ${error.message}`)] : []),
  ].join('\n');
  await fs.writeFile(path.join(caseDir, 'case-report.md'), `${markdown}\n`, 'utf8');
}

async function writeEvidence({ shadow, metaContracts, caseReports, shopkeeperReport, summary }) {
  await writeJson(path.join(resultRoot, 'baseline-source.json'), { before: sourceFingerprintBefore, after: sourceFingerprintAfter, unchanged: sameFingerprint(sourceFingerprintBefore, sourceFingerprintAfter) });
  await writeJson(path.join(resultRoot, 'baseline-clone.json'), sanitize(cloneInfo));
  await writeJson(path.join(resultRoot, 'run-manifest.json'), sanitize({ runId, generatedAt: new Date().toISOString(), baselineTenantId, shadow, deepSeekCalls, maxDeepSeekCalls, blockedNetwork, git: process.env.GITHUB_SHA ?? null }));
  await writeJson(path.join(resultRoot, 'meta-contracts.json'), metaContracts);
  await writeJson(path.join(resultRoot, 'shopkeeper-workflow.json'), sanitize(shopkeeperReport));
  await writeJson(path.join(resultRoot, 'summary.json'), sanitize(summary));
  await fs.writeFile(path.join(resultRoot, 'summary.md'), renderSummaryMarkdown(summary), 'utf8');
  await fs.writeFile(path.join(resultRoot, 'junit.xml'), junitXml(caseReports, shopkeeperReport), 'utf8');
}

function buildSummary({ shadow, metaContracts, caseReports, shopkeeperReport }) {
  const byStatus = Object.groupBy(caseReports, (item) => item.status);
  const statusCounts = Object.fromEntries(Object.entries(byStatus).map(([status, reports]) => [status, reports.length]));
  const failedAssertions = caseReports.flatMap((item) => item.assertions
    .filter((assertion) => !assertion.passed)
    .map((assertion) => ({ caseId: item.caseId, cause: classifyFailureCause(assertion), ...assertion })));
  const failedMetaContracts = metaContracts
    .filter((item) => !item.passed)
    .map((item) => ({ ...item, cause: 'contract' }));
  const failedShopkeeperAssertions = (shopkeeperReport.assertions ?? [])
    .filter((item) => !item.passed)
    .map((item) => ({ caseId: shopkeeperReport.caseId ?? 'shopkeeper-workflow', cause: classifyFailureCause(item), ...item }));
  const contractFailures = [...failedMetaContracts, ...failedAssertions, ...failedShopkeeperAssertions];
  const passed = (byStatus.passed ?? []).length;
  const functionalPassed = caseReports.filter((item) => ['passed', 'failed_functional'].includes(item.status)).length;
  const noExternalNetwork = blockedNetwork.length === 0;
  const timings = summarizeRunTimings(caseReports);
  const acceptance = {
    sourceUnchanged: sameFingerprint(sourceFingerprintBefore, sourceFingerprintAfter),
    deepSeekReal: caseReports.every((item) => item.steps.filter((step) => step.kind !== 'interactive_button_reply').every((step) => step.plan?.executionMode === 'provider_api')),
    noExternalNetwork,
    contractP0Pass: contractFailures.length === 0,
    functionalThreshold: passed >= 38 && functionalPassed === 40,
    webhookAckP95UnderOneSecond: timings.webhookAckP95Ms !== null && timings.webhookAckP95Ms < 1_000,
    processingP95WithinTarget: timings.workerProcessingP95Ms !== null && timings.workerProcessingP95Ms <= 10_000,
  };
  acceptance.readyForPilot = Boolean(acceptance.sourceUnchanged && acceptance.deepSeekReal && acceptance.noExternalNetwork && acceptance.contractP0Pass && acceptance.functionalThreshold && acceptance.webhookAckP95UnderOneSecond && acceptance.processingP95WithinTarget);
  return {
    generatedAt: new Date().toISOString(),
    runId,
    shadow,
    counts: { total: caseReports.length, passed, failed: caseReports.length - passed, byStatus: statusCounts, deepSeekCalls, blockedNetwork: blockedNetwork.length },
    timings,
    tokenUsage: summarizeTokenUsage(caseReports),
    cases: caseReports.map((item) => ({ caseId: item.caseId, scenarioId: item.scenarioId, status: item.status, durationMs: item.durationMs })),
    metaContracts,
    shopkeeperWorkflow: shopkeeperReport,
    failures: contractFailures.slice(0, 200),
    acceptance,
  };
}

function renderSummaryMarkdown(summary) {
  const acceptance = summary.acceptance;
  return [
    '# E2E local Meta simulada y DeepSeek real',
    '',
    `Run: ${summary.runId}`,
    `Casos aprobados: ${summary.counts.passed}/${summary.counts.total}`,
    `Llamadas DeepSeek: ${summary.counts.deepSeekCalls}`,
    `Tokens DeepSeek: ${summary.tokenUsage.totalTokens ?? 'N/D'} (${summary.tokenUsage.averageTokensPerCase ?? 'N/D'} por caso en promedio)`,
    `p95 acuse webhook: ${summary.timings.webhookAckP95Ms ?? 'N/D'} ms`,
    `p95 procesamiento worker: ${summary.timings.workerProcessingP95Ms ?? 'N/D'} ms`,
    `Listo para piloto: ${acceptance.readyForPilot ? 'SI' : 'NO'}`,
    '',
    '## Controles',
    `- Fuente sin cambios: ${acceptance.sourceUnchanged ? 'PASS' : 'FAIL'}`,
    `- DeepSeek provider_api: ${acceptance.deepSeekReal ? 'PASS' : 'FAIL'}`,
    `- Sin red externa prohibida: ${acceptance.noExternalNetwork ? 'PASS' : 'FAIL'}`,
    `- Contratos P0: ${acceptance.contractP0Pass ? 'PASS' : 'FAIL'}`,
    `- p95 acuse < 1 s: ${acceptance.webhookAckP95UnderOneSecond ? 'PASS' : 'FAIL'}`,
    `- p95 worker <= 10 s: ${acceptance.processingP95WithinTarget ? 'PASS' : 'FAIL'}`,
    `- Umbral funcional: ${acceptance.functionalThreshold ? 'PASS' : 'FAIL'}`,
    '',
    '## Fallos',
    ...(summary.failures.length ? summary.failures.map((failure) => `- ${failure.caseId ?? 'global'} [${failure.cause ?? 'contract'}] ${failure.name}: ${failure.detail}`) : ['- Ninguno']),
  ].join('\n').concat('\n');
}

function junitXml(caseReports, shopkeeperReport) {
  const tests = [...caseReports, { caseId: 'shopkeeper-workflow', status: shopkeeperReport.status, assertions: shopkeeperReport.assertions ?? [], errors: shopkeeperReport.errors ?? [] }];
  const failures = tests.filter((item) => item.status !== 'passed').length;
  const cases = tests.map((item) => {
    const message = [...item.assertions.filter((assertion) => !assertion.passed).map((assertion) => `${assertion.name}: ${assertion.detail}`), ...item.errors.map((error) => error.message)].join('\n');
    return `<testcase name="${xml(item.caseId)}">${message ? `<failure message="${xml(message)}"/>` : ''}</testcase>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="ventas-ia-e2e-local" tests="${tests.length}" failures="${failures}">${cases}</testsuite>\n`;
}

function blockedCaseReport({ index, scenario, reason }) {
  return { caseId: `${String(index + 1).padStart(2, '0')}-${scenario.id}`, scenarioId: scenario.id, status: 'blocked_ai', assertions: [], steps: [], graphOutbound: [], orderId: null, errors: [{ message: reason }], durationMs: 0 };
}

function summarizeLlmEvents(events = []) {
  return events
    .filter((event) => ['llm.plan.created', 'llm.reply.composed', 'llm.plan.fallback', 'llm.reply.fallback'].includes(event.type))
    .map((event) => ({
      stage: event.type.includes('.plan.') ? 'planner' : 'composer',
      event: event.type,
      durationMs: Number(event.metadata?.durationMs ?? 0) || null,
      provider: event.metadata?.providerMetadata?.provider ?? event.metadata?.provider ?? null,
      model: event.metadata?.providerMetadata?.model ?? event.metadata?.model ?? null,
      usage: event.metadata?.providerMetadata?.usage ?? null,
    }));
}

function summarizeRunTimings(caseReports = []) {
  const steps = caseReports.flatMap((report) => report.steps ?? []);
  return {
    webhookAckP95Ms: percentile(steps.map((step) => step.timing?.webhookAckMs)),
    workerProcessingP95Ms: percentile(steps.map((step) => step.timing?.workerProcessingMs)),
    plannerP95Ms: percentile(steps.flatMap((step) => (step.timing?.llm ?? []).filter((item) => item.stage === 'planner').map((item) => item.durationMs))),
    composerP95Ms: percentile(steps.flatMap((step) => (step.timing?.llm ?? []).filter((item) => item.stage === 'composer').map((item) => item.durationMs))),
  };
}

function summarizeTokenUsage(caseReports = []) {
  const calls = caseReports
    .flatMap((report) => report.steps ?? [])
    .flatMap((step) => step.timing?.llm ?? [])
    .map((item) => ({ stage: item.stage, total: Number(item.usage?.total_tokens ?? item.usage?.totalTokens) }))
    .filter((item) => Number.isFinite(item.total) && item.total >= 0);
  const totalTokens = calls.reduce((sum, item) => sum + item.total, 0);
  const perStage = Object.fromEntries(['planner', 'composer'].map((stage) => {
    const selected = calls.filter((item) => item.stage === stage);
    const total = selected.reduce((sum, item) => sum + item.total, 0);
    return [stage, { calls: selected.length, totalTokens: total, averageTokensPerCall: selected.length ? Math.round(total / selected.length) : null }];
  }));
  return {
    calls: calls.length,
    totalTokens: calls.length ? totalTokens : null,
    averageTokensPerCall: calls.length ? Math.round(totalTokens / calls.length) : null,
    averageTokensPerCase: caseReports.length && calls.length ? Math.round(totalTokens / caseReports.length) : null,
    byStage: perStage,
  };
}

function elapsedMs(start, end) {
  const value = Date.parse(end ?? '') - Date.parse(start ?? '');
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percentile(values = [], ratio = 0.95) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function assertion(name, passed, detail = '') { return { name, passed: Boolean(passed), detail: String(detail).slice(0, 1_500) }; }
function classifyFailedCase(report) { return report.assertions.some((item) => /ack|deduplicacion|deepseek|pago_interactivo|pedido_confirmado/.test(item.name)) ? 'failed_contract' : 'failed_functional'; }
function classifyFailureCause(assertion = {}) {
  const name = normalized(assertion.name);
  if (/ack|webhook|deduplicacion|graph|outbound/.test(name)) return 'contract';
  if (/intent|semantic_frame|raw_text|planner/.test(name)) return 'interpretation';
  if (/options|catalog|candidate|item_/.test(name)) return 'retrieval';
  if (/variant|presentation|quantity|stock|availability/.test(name)) return 'resolution';
  if (/order|draft|payment|pago|confirm|tendero|dispatch|conversacion/.test(name)) return 'state';
  if (/reply|voice|tone/.test(name)) return 'composition';
  return 'contract';
}
function sanitizePlan(plan) { return sanitize({ provider: plan.provider, model: plan.model, executionMode: plan.executionMode, intent: plan.intent, confidence: plan.confidence, reasoningMode: plan.reasoningMode, responseStrategy: plan.responseStrategy, missingFields: plan.missingFields, semanticFrame: plan.semanticFrame, candidateItems: plan.candidateItems, toolPlan: plan.toolPlan }); }
function sanitizeOrderDraft(draft) { return sanitize(draft ? { version: draft.version, missingFields: draft.missingFields, paymentMethod: draft.paymentMethod, subtotal: draft.subtotal, items: draft.items?.map((item) => ({ rawItemId: item.rawItemId, rawName: item.rawName, catalogQuery: item.catalogQuery, quantity: item.quantity, lineTotal: item.lineTotal, resolution: item.resolution, product: item.product ? { sku: item.product.sku, name: item.product.name, presentation: item.product.presentation, price: item.product.price, stock: item.product.stock } : null })) } : null); }
function sanitize(value) { if (Array.isArray(value)) return value.map(sanitize); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).map(([key, item]) => /authorization|secret|password|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token/i.test(key) ? [key, '***'] : [key, sanitize(item)])); }
function maskPhone(value) { const digits = String(value ?? '').replace(/\D/g, ''); return digits ? `***${digits.slice(-4)}` : null; }
function normalized(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function slug(value) { return normalized(value).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60); }
function sameFingerprint(before, after) { return before?.fingerprint && before.fingerprint === after?.fingerprint; }
function isLoopback(hostname) { return ['127.0.0.1', 'localhost', '::1'].includes(hostname); }
function positiveInt(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function jsonResponse(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } }); }
function shortStack(stack) { return String(stack ?? '').split('\n').slice(0, 6).join('\n'); }
function xml(value) { return String(value ?? '').replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[character])); }
function createRunId() { return `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}`.toLowerCase(); }
async function startServer(app) { server = app.listen(0, '127.0.0.1'); return new Promise((resolve) => server.once('listening', () => resolve(server.address().port))); }
async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
async function getJson(url) { const response = await fetch(url); const text = await response.text(); if (!response.ok) throw new Error(`${url} devolvio ${response.status}: ${text}`); return text ? JSON.parse(text) : {}; }
async function postJson(url, body) { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const text = await response.text(); if (!response.ok) throw new Error(`${url} devolvio ${response.status}: ${text}`); return text ? JSON.parse(text) : {}; }
async function patchJson(url, body) { const response = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const text = await response.text(); if (!response.ok) throw new Error(`${url} devolvio ${response.status}: ${text}`); return text ? JSON.parse(text) : {}; }
function execFileText(command, args, options) { return new Promise((resolve, reject) => execFile(command, args, { ...options, windowsHide: true, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }))); }
