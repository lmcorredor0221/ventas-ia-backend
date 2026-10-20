import assert from 'node:assert/strict';
import { createAppAsync } from '../index.js';

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Set POSTGRES_TEST_DATABASE_URL or DATABASE_URL before running npm run test:postgres');
}

const suffix = Date.now().toString(36);
const testTenantName = `Tienda PG Smoke ${suffix}`;
const testOwnerEmail = `pg-smoke-${suffix}@example.com`;

const { app, store, controlPlane } = await createAppAsync({
  storageDriver: 'postgres',
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL ?? 'disable',
});
const server = app.listen(0, '127.0.0.1');

try {
  const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  const base = `http://127.0.0.1:${port}`;

  const health = await getJson(`${base}/health`);
  assert.equal(health.ok, true);

  const tables = await store.pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1)
    ORDER BY table_name
  `, [[
    'app_state',
    'tenants',
    'subscriptions',
    'google_connections',
    'google_workspaces',
    'whatsapp_bindings',
    'conversations',
    'orders',
    'events',
    'usage_counters',
    'secret_references',
    'products',
    'drive_files',
    'customer_profiles',
    'pending_requests',
    'transactions',
    'processed_messages',
    'users',
    'tenant_members',
    'sessions',
    'audit_events',
    'billing_plans',
    'subscription_payments',
    'subscription_events',
    'billing_discounts',
    'billing_access_exceptions',
    'billing_usage_cycles',
    'billing_funnel_events',
    'integration_outbox',
    'inbound_messages',
    'interaction_offers',
    'schema_migrations',
  ]]);
  assert.equal(tables.rows.length, 32);

  const seeded = await store.pool.query(`
    SELECT
      (SELECT count(*)::int FROM tenants) AS tenants,
      (SELECT count(*)::int FROM subscriptions) AS subscriptions,
      (SELECT count(*)::int FROM conversations) AS conversations,
      (SELECT count(*)::int FROM secret_references) AS secret_references,
      (SELECT count(*)::int FROM products) AS products,
      (SELECT count(*)::int FROM drive_files) AS drive_files,
      (SELECT count(*)::int FROM customer_profiles) AS customer_profiles,
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM tenant_members) AS tenant_members,
      (SELECT count(*)::int FROM billing_plans) AS billing_plans
  `);
  assert.ok(seeded.rows[0].tenants >= 3);
  assert.ok(seeded.rows[0].subscriptions >= 3);
  assert.ok(seeded.rows[0].conversations >= 6);
  assert.ok(seeded.rows[0].secret_references >= 1);
  assert.ok(seeded.rows[0].products >= 1);
  assert.ok(seeded.rows[0].drive_files >= 1);
  assert.ok(seeded.rows[0].customer_profiles >= 1);
  assert.ok(seeded.rows[0].users >= 1);
  assert.ok(seeded.rows[0].tenant_members >= 1);
  assert.ok(seeded.rows[0].billing_plans >= 1);

  const inbound = await store.enqueueInboundMessage({
    tenantId: 'andina',
    provider: 'meta_whatsapp_cloud_api',
    phoneNumberId: '100000000001',
    waId: `57300${suffix.slice(-6)}`,
    messageId: `wamid-pg-${suffix}`,
    messageType: 'text',
    text: 'Prueba de persistencia de webhook',
  });
  assert.equal(inbound.created, true);
  const inboundDuplicate = await store.enqueueInboundMessage({
    tenantId: 'andina',
    provider: 'meta_whatsapp_cloud_api',
    phoneNumberId: '100000000001',
    waId: `57300${suffix.slice(-6)}`,
    messageId: `wamid-pg-${suffix}`,
    messageType: 'text',
    text: 'Prueba de persistencia de webhook',
  });
  assert.equal(inboundDuplicate.created, false);
  assert.equal((await store.getInboundMessage(`wamid-pg-${suffix}`)).status, 'queued');
  const inboundOutbox = (await store.listOutbox()).find((entry) => entry.idempotencyKey === `inbound:wamid-pg-${suffix}`);
  assert.equal(inboundOutbox?.kind, 'whatsapp.inbound_processing');
  assert.equal(inboundOutbox?.status, 'pending');

  const catalogSmoke = await postJson(`${base}/api/tools/google_sheets_read_table/smoke-test`, {
    tenantId: 'andina',
    payload: { filters: { query: 'chocoramo' } },
  });
  assert.ok(catalogSmoke.result.rows.some((row) => row.name.includes('Chocoramo')));

  const createdTenant = await postJson(`${base}/api/saas/tenants`, {
    storeName: testTenantName,
    ownerEmail: testOwnerEmail,
    ownerName: 'Smoke Postgres',
    whatsappNumber: '+57 300 999 0000',
  }, { expectedStatus: 201 });
  const tenantId = createdTenant.tenant.id;
  assert.equal(createdTenant.subscription.status, 'pending_payment');

  const blockedRun = await postJson(`${base}/api/agent/run`, {
    tenantId,
    waId: `57300${suffix.slice(-6)}`,
    profileName: 'Cliente PG Bloqueado',
    text: 'tienes chocoramo?',
  }, { expectedStatus: 402 });
  assert.equal(blockedRun.code, 'tenant_not_operational');

  await postJson(`${base}/api/saas/tenants/${tenantId}/subscription/mock-activate`, {});
  const oauthStart = await getJson(`${base}/api/saas/tenants/${tenantId}/google/oauth/start`);
  await getJson(`${base}/api/saas/google/oauth/callback?state=${oauthStart.state}&code=dev-mock-code&mockAccountEmail=${encodeURIComponent(testOwnerEmail)}`);
  await postJson(`${base}/api/saas/tenants/${tenantId}/google/provision`, {});
  const whatsappBinding = controlPlane.saveWhatsAppBinding(tenantId, {
    phoneNumberId: `pg-smoke-phone-${suffix}`,
    phoneNumberIdRef: `${tenantId.toUpperCase()}_WHATSAPP_PHONE_NUMBER_ID_REF`,
    accessTokenRef: `${tenantId.toUpperCase()}_WHATSAPP_ACCESS_TOKEN_REF`,
    verifyTokenRef: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF',
    appSecretRef: 'WHATSAPP_APP_SECRET_REF',
  }, { verifiedByProvider: true });
  assert.equal(whatsappBinding.tenant.config.whatsapp.phoneNumberId, `pg-smoke-phone-${suffix}`);

  const validation = await postJson(`${base}/api/saas/tenants/${tenantId}/validate`, {});
  assert.equal(validation.readyForActivation, true);

  const activated = await postJson(`${base}/api/admin/tenants/${tenantId}/activate`, {});
  assert.equal(activated.status.readyForOperation, true);
  await store.flush();

  const persisted = await store.pool.query(`
    SELECT
      t.status AS tenant_status,
      s.status AS subscription_status,
      gc.status AS google_status,
      gw.status AS workspace_status
    FROM tenants t
    JOIN subscriptions s ON s.tenant_id = t.id
    JOIN google_connections gc ON gc.tenant_id = t.id
    JOIN google_workspaces gw ON gw.tenant_id = t.id
    WHERE t.id = $1
  `, [tenantId]);
  assert.equal(persisted.rows[0].tenant_status, 'active');
  assert.equal(persisted.rows[0].subscription_status, 'active');
  assert.equal(persisted.rows[0].google_status, 'connected');
  assert.equal(persisted.rows[0].workspace_status, 'provisioned');

  const eventRow = await store.pool.query(
    'SELECT id FROM events WHERE tenant_id = $1 AND type = $2 LIMIT 1',
    [tenantId, 'tenant.created'],
  );
  assert.equal(eventRow.rows.length, 1);

  const waId = `57319${suffix.slice(-6)}`;
  const agentRun = await postJson(`${base}/api/agent/run`, {
    tenantId,
    waId,
    profileName: 'Cliente PG Operativo',
    text: 'tienes chocoramo?',
  });
  assert.equal(agentRun.duplicate, false);

  const duplicateMessageId = `pg-smoke-message-${suffix}`;
  const firstDedupRun = await postJson(`${base}/api/agent/run`, {
    tenantId,
    waId,
    profileName: 'Cliente PG Operativo',
    text: 'tienes chocoramo?',
    messageId: duplicateMessageId,
  });
  assert.equal(firstDedupRun.duplicate, false);

  const secondDedupRun = await postJson(`${base}/api/agent/run`, {
    tenantId,
    waId,
    profileName: 'Cliente PG Operativo',
    text: 'tienes chocoramo?',
    messageId: duplicateMessageId,
  });
  assert.equal(secondDedupRun.duplicate, true);

  await postJson(`${base}/api/tools/google_sheets_customer_profile_upsert/smoke-test`, {
    tenantId,
    payload: {
      wa_id: waId,
      name: 'Cliente PG Operativo',
      defaultAddress: 'Calle 100 # 10-20, Bogota',
      preferences: { channel: 'whatsapp' },
    },
  });

  await postJson(`${base}/api/tools/google_sheets_order_write/smoke-test`, {
    tenantId,
    payload: {
      wa_id: waId,
      customer_name: 'Cliente PG Operativo',
      delivery_address: 'Calle 100 # 10-20, Bogota',
      items: [{ sku: 'TEST-1', name: 'Producto prueba', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
      subtotal: 1000,
    },
  });

  await postJson(`${base}/api/tools/human_handoff/smoke-test`, {
    tenantId,
    payload: {
      reason: 'Smoke pending request',
      assigned_team: 'operaciones',
      context_snapshot: { summary: 'Smoke test handoff' },
    },
  });

  await postJson(`${base}/api/tools/transactional_write/smoke-test`, {
    tenantId,
    payload: {
      approval_token: 'APPROVED-smoke',
      action_name: 'smoke_transaction',
      payload: { ok: true },
    },
  });

  await store.flush();

  const operational = await store.pool.query(`
    SELECT
      (SELECT count(*)::int FROM conversations WHERE tenant_id = $1 AND wa_id = $2) AS conversations,
      (SELECT count(*)::int FROM customer_profiles WHERE tenant_id = $1 AND wa_id = $2) AS customer_profiles,
      (SELECT count(*)::int FROM orders WHERE tenant_id = $1 AND wa_id = $2) AS orders,
      (SELECT count(*)::int FROM pending_requests WHERE tenant_id = $1 AND status = 'pending') AS pending_requests,
      (SELECT count(*)::int FROM transactions WHERE tenant_id = $1 AND action_name = 'smoke_transaction') AS transactions,
      (SELECT count(*)::int FROM processed_messages WHERE message_id = $3) AS processed_messages
  `, [tenantId, waId, duplicateMessageId]);
  assert.ok(operational.rows[0].conversations >= 1);
  assert.equal(operational.rows[0].customer_profiles, 1);
  assert.equal(operational.rows[0].orders, 1);
  assert.ok(operational.rows[0].pending_requests >= 1);
  assert.equal(operational.rows[0].transactions, 1);
  assert.equal(operational.rows[0].processed_messages, 1);

  const usageRows = await store.pool.query(
    'SELECT metric, value::int FROM usage_counters WHERE tenant_id = $1',
    [tenantId],
  );
  const usageMetrics = Object.fromEntries(usageRows.rows.map((row) => [row.metric, row.value]));
  assert.ok(usageMetrics.agent_interactions >= 2);
  assert.ok(usageMetrics.tool_calls >= 1);
  assert.ok(usageMetrics.llm_total_tokens >= 1);

  const audit = await store.pool.query(
    'SELECT action FROM audit_events WHERE tenant_id = $1',
    [tenantId],
  );
  const auditActions = new Set(audit.rows.map((row) => row.action));
  for (const action of [
    'subscription.activated',
    'google.workspace.provisioned',
    'tenant.activated',
    'tool.google_sheets_order_write',
    'tool.human_handoff.created',
    'tool.transactional_write.committed',
  ]) {
    assert.ok(auditActions.has(action), `missing postgres audit action ${action}`);
  }

  const apiConversations = await getJson(`${base}/api/conversations?tenantId=${tenantId}`);
  assert.ok(apiConversations.some((conversation) => conversation.waId === waId));

  const apiPending = await getJson(`${base}/api/pending-requests?tenantId=${tenantId}`);
  assert.ok(apiPending.some((request) => request.status === 'pending'));

  const apiEvents = await getJson(`${base}/api/events?tenantId=${tenantId}`);
  assert.ok(apiEvents.some((event) => event.type === 'tenant.created'));

  const overview = await getJson(`${base}/api/ops/overview?tenantId=${tenantId}`);
  assert.ok(overview.conversations.some((conversation) => conversation.waId === waId));
  assert.ok(overview.pendingRequests.length >= 1);
  assert.ok(overview.usage.metrics.agent_interactions >= 2);

  const apiUsage = await getJson(`${base}/api/usage?tenantId=${tenantId}`);
  assert.equal(apiUsage.limits.includedDeliveries, 400);
  assert.equal(apiUsage.limits.includedInteractions, 2700);

  const billingStatus = await getJson(`${base}/api/billing/status?tenantId=${tenantId}`);
  assert.equal(billingStatus.plan.id, 'ventas_ia_400_domicilios');
  assert.ok(billingStatus.payments.some((payment) => payment.status === 'approved'));

  const billingRows = await store.pool.query(`
    SELECT
      (SELECT count(*)::int FROM subscription_payments WHERE tenant_id = $1) AS payments,
      (SELECT count(*)::int FROM billing_usage_cycles WHERE tenant_id = $1) AS cycles,
      (SELECT count(*)::int FROM billing_funnel_events WHERE tenant_id = $1) AS funnel_events
  `, [tenantId]);
  assert.ok(billingRows.rows[0].payments >= 1);
  assert.ok(billingRows.rows[0].cycles >= 1);
  assert.ok(billingRows.rows[0].funnel_events >= 1);

  const snapshot = await store.pool.query('SELECT document->>$1 AS tenant_count FROM app_state WHERE id = $2', ['schemaVersion', 'runtime']);
  assert.ok(snapshot.rows[0].tenant_count);

  console.log(`Postgres smoke tests passed (${tenantId})`);
} finally {
  server.close();
  await store.close?.();
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, `${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function postJson(url, body, { expectedStatus = 200 } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function patchJson(url, body, { expectedStatus = 200 } = {}) {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${url} returned ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
