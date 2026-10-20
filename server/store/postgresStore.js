import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createSeedState } from '../data/seed.js';
import { ensureSaasState } from '../services/saasControlPlane.js';
import { ensureIdentityState } from '../services/authService.js';
import { ensureUsageState } from '../services/usageService.js';
import { ensureSecretState } from '../services/secretVault.js';
import { ensurePlatformState } from '../services/platformService.js';
import { collapseDuplicateOpenPendingRequests } from '../services/pendingRequestPolicy.js';
import { exponentialBackoff } from '../services/integrationOutbox.js';
import { CLOSED_CONVERSATION_STATUSES } from '../domain/conversationStatus.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');
const SNAPSHOT_IDLE_DELAY_MS = 10_000;

export class PostgresStore {
  constructor({ databaseUrl, ssl = 'auto', max = 5 }) {
    if (!databaseUrl) throw new Error('DATABASE_URL is required when STORAGE_DRIVER=postgres');
    this.pool = new Pool({
      connectionString: databaseUrl,
      max,
      ssl: resolveSsl(databaseUrl, ssl),
    });
    this.state = null;
    this.saveQueue = Promise.resolve();
    this.snapshotSaveTimer = null;
    this.snapshotSaveDeferred = null;
    this.snapshotSaving = false;
    this.snapshotDirty = false;
  }

  async load() {
    await this.migrate();
    const result = await this.pool.query('SELECT document FROM app_state WHERE id = $1', ['runtime']);
    if (result.rows[0]?.document) {
      this.state = result.rows[0].document;
      mergeSeedCatalog(this.state);
      ensureSaasState(this.state);
      ensureIdentityState(this.state);
      ensureUsageState(this.state);
      ensureSecretState(this.state);
      ensurePlatformState(this.state);
      collapseDuplicateOpenPendingRequests(this.state);
      await this.save();
      return this.state;
    }
    this.state = createSeedState();
    ensureSaasState(this.state);
    ensureIdentityState(this.state);
    ensureUsageState(this.state);
    ensureSecretState(this.state);
    ensurePlatformState(this.state);
    await this.save();
    return this.state;
  }

  getState() {
    if (!this.state) throw new Error('PostgresStore must be loaded before use');
    return this.state;
  }

  async listTenants() {
    const result = await this.pool.query('SELECT payload FROM tenants ORDER BY name ASC');
    return result.rows.map((row) => row.payload);
  }

  async getTenant(tenantId) {
    const result = await this.pool.query('SELECT payload FROM tenants WHERE id = $1', [tenantId]);
    return result.rows[0]?.payload ?? null;
  }

  async listConversations({ tenantId } = {}) {
    const result = tenantId
      ? await this.pool.query('SELECT payload FROM conversations WHERE tenant_id = $1 ORDER BY updated_at DESC', [tenantId])
      : await this.pool.query('SELECT payload FROM conversations ORDER BY updated_at DESC');
    return result.rows.map((row) => row.payload);
  }

  async getConversation(conversationId) {
    const result = await this.pool.query('SELECT payload FROM conversations WHERE id = $1', [conversationId]);
    return result.rows[0]?.payload ?? null;
  }

  async listEvents({ tenantId, limit = 50 } = {}) {
    const size = Number(limit) || 50;
    const result = tenantId
      ? await this.pool.query('SELECT payload FROM events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2', [tenantId, size])
      : await this.pool.query('SELECT payload FROM events ORDER BY created_at DESC LIMIT $1', [size]);
    return result.rows.map((row) => row.payload);
  }

  async listPendingRequests({ tenantId } = {}) {
    const result = tenantId
      ? await this.pool.query('SELECT payload FROM pending_requests WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId])
      : await this.pool.query('SELECT payload FROM pending_requests ORDER BY created_at DESC');
    return result.rows.map((row) => row.payload);
  }

  async listProducts(tenantId) {
    const result = await this.pool.query('SELECT payload FROM products WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
    return result.rows.map((row) => row.payload);
  }

  async listDriveFiles(tenantId) {
    const result = await this.pool.query('SELECT payload FROM drive_files WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
    return result.rows.map((row) => row.payload);
  }

  async getCustomerProfile(tenantId, waId) {
    const result = await this.pool.query('SELECT payload FROM customer_profiles WHERE tenant_id = $1 AND wa_id = $2', [tenantId, waId]);
    return result.rows[0]?.payload ?? null;
  }

  async getUsageCounters(tenantId, period) {
    const result = await this.pool.query(
      'SELECT metric, value FROM usage_counters WHERE tenant_id = $1 AND period = $2',
      [tenantId, period],
    );
    return Object.fromEntries(result.rows.map((row) => [row.metric, Number(row.value)]));
  }

  async listWebhookEvents({ tenantId, provider, status, limit = 200 } = {}) {
    const clauses = [];
    const values = [];
    if (tenantId) {
      values.push(tenantId);
      clauses.push(`tenant_id = $${values.length}`);
    }
    if (provider) {
      values.push(provider);
      clauses.push(`provider = $${values.length}`);
    }
    if (status) {
      values.push(status);
      clauses.push(`status = $${values.length}`);
    }
    values.push(Number(limit) || 200);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const result = await this.pool.query(
      `SELECT payload FROM webhook_events ${where} ORDER BY received_at DESC LIMIT $${values.length}`,
      values,
    );
    return result.rows.map((row) => row.payload);
  }

  async findConversationByWa(tenantId, waId) {
    const result = await this.pool.query(
      `SELECT payload FROM conversations
       WHERE tenant_id = $1
         AND wa_id = $2
          AND COALESCE(payload->>'caseStatus', payload->>'status', status) <> ALL($3::text[])
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, waId, CLOSED_CONVERSATION_STATUSES],
    );
    return result.rows[0]?.payload ?? null;
  }

  async findLatestConversationByWa(tenantId, waId) {
    const result = await this.pool.query(
      'SELECT payload FROM conversations WHERE tenant_id = $1 AND wa_id = $2 ORDER BY updated_at DESC LIMIT 1',
      [tenantId, waId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async isMessageProcessed(messageId) {
    if (!messageId) return false;
    const result = await this.pool.query('SELECT 1 FROM processed_messages WHERE message_id = $1', [messageId]);
    return Boolean(result.rows[0]);
  }

  claimProcessedMessage(messageId, payload = {}) {
    if (!messageId) return Promise.resolve(true);
    return this.queueWrite(async () => {
      const client = await this.pool.connect();
      try {
        const result = await client.query(
          `
            INSERT INTO processed_messages (message_id, tenant_id, conversation_id, provider, payload, created_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, now())
            ON CONFLICT (message_id) DO NOTHING
            RETURNING message_id
          `,
          [
            messageId,
            payload.tenantId ?? null,
            payload.conversationId ?? null,
            payload.provider ?? null,
            JSON.stringify(payload),
          ],
        );
        return result.rowCount === 1;
      } finally {
        client.release();
      }
    }, 'processed message claim');
  }

  mutate(mutator) {
    const state = this.getState();
    const result = mutator(state);
    this.queueSave();
    return result;
  }

  persistTenantCritical(tenantId) {
    return this.queueWrite(async () => {
      const state = this.getState();
      const tenant = state.tenants.find((item) => item.id === tenantId);
      if (!tenant) return;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await upsertTenant(client, tenant);
        const subscription = state.subscriptionsByTenant?.[tenantId];
        if (subscription) await upsertSubscription(client, tenantId, subscription);
        const connection = state.googleConnectionsByTenant?.[tenantId];
        if (connection) await upsertGoogleConnection(client, tenantId, connection);
        const workspace = state.googleWorkspacesByTenant?.[tenantId];
        if (workspace) await upsertGoogleWorkspace(client, tenantId, workspace);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, 'critical tenant write');
  }

  persistEvent(event) {
    return this.queueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await upsertEvent(client, event);
      } finally {
        client.release();
      }
    }, 'event write');
  }

  persistConversation(conversationId) {
    return this.queueWrite(async () => {
      const conversation = this.getState().conversations.find((item) => item.id === conversationId);
      if (!conversation) return;
      const client = await this.pool.connect();
      try {
        await upsertConversation(client, conversation);
      } finally {
        client.release();
      }
    }, 'conversation write');
  }

  deleteConversation(conversationId) {
    return this.queueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM pending_requests WHERE conversation_id = $1', [conversationId]);
        await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, 'conversation delete');
  }

  persistOrder(tenantId, orderId) {
    return this.queueWrite(async () => {
      const order = (this.getState().ordersByTenant?.[tenantId] ?? []).find((item) => item.id === orderId);
      if (!order) return;
      const client = await this.pool.connect();
      try {
        const result = await upsertOrder(client, tenantId, order, { strictVersion: true, throwOnConflict: false });
        if (result.rowCount === 0) {
          const current = await client.query('SELECT version, payload FROM orders WHERE id = $1 AND tenant_id = $2', [orderId, tenantId]);
          const currentPayload = current.rows[0]?.payload ?? {};
          const sameWrite = Number(current.rows[0]?.version ?? -1) === Number(order.version ?? 0)
            && currentPayload.status === order.status
            && currentPayload.updatedAt === order.updatedAt;
          if (!sameWrite) {
            const error = new Error('El pedido fue actualizado por otro operador. Recarga la cola e inténtalo de nuevo.');
            error.code = 'order_version_conflict';
            error.statusCode = 409;
            throw error;
          }
        }
      } finally {
        client.release();
      }
    }, 'order write');
  }

  persistCustomerProfile(tenantId, waId) {
    return this.queueWrite(async () => {
      const profile = this.getState().customerProfilesByTenant?.[tenantId]?.[waId];
      if (!profile) return;
      const client = await this.pool.connect();
      try {
        await upsertCustomerProfile(client, tenantId, waId, profile);
      } finally {
        client.release();
      }
    }, 'customer profile write');
  }

  persistPendingRequest(requestId) {
    return this.queueWrite(async () => {
      const request = this.getState().pendingRequests.find((item) => item.id === requestId);
      if (!request) return;
      const client = await this.pool.connect();
      try {
        await upsertPendingRequest(client, request);
      } finally {
        client.release();
      }
    }, 'pending request write');
  }

  persistTransaction(transactionId) {
    return this.queueWrite(async () => {
      const transaction = this.getState().transactions.find((item) => item.id === transactionId);
      if (!transaction) return;
      const client = await this.pool.connect();
      try {
        await upsertTransaction(client, transaction);
      } finally {
        client.release();
      }
    }, 'transaction write');
  }

  persistProcessedMessage(messageId, payload = {}) {
    if (!messageId) return Promise.resolve();
    return this.queueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await client.query(
          `
            INSERT INTO processed_messages (message_id, tenant_id, conversation_id, provider, payload, created_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, now())
            ON CONFLICT (message_id) DO NOTHING
          `,
          [
            messageId,
            payload.tenantId ?? null,
            payload.conversationId ?? null,
            payload.provider ?? null,
            JSON.stringify(payload),
          ],
        );
      } finally {
        client.release();
      }
    }, 'processed message write');
  }

  persistUsageCounter(tenantId, period, metric) {
    if (!tenantId || !period || !metric) return Promise.resolve();
    return this.queueWrite(async () => {
      const value = this.getState().usageCountersByTenant?.[tenantId]?.[period]?.[metric];
      if (value === undefined) return;
      const client = await this.pool.connect();
      try {
        await upsertUsageCounter(client, tenantId, period, metric, value);
      } finally {
        client.release();
      }
    }, 'usage counter write');
  }

  persistWebhookEvent(event) {
    return this.queueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await upsertWebhookEvent(client, event);
      } finally {
        client.release();
      }
    }, 'webhook event write');
  }

  enqueueOutbox(entry) {
    return this.queueWrite(async () => {
      const result = await this.pool.query(
        `INSERT INTO integration_outbox
          (id, tenant_id, kind, aggregate_type, aggregate_id, idempotency_key, payload, status, attempts, next_attempt_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', 0, $8, $9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [entry.id, entry.tenantId, entry.kind, entry.aggregateType, entry.aggregateId, entry.idempotencyKey, JSON.stringify(entry.payload ?? {}), entry.nextAttemptAt, entry.createdAt],
      );
      return result.rows[0] ? outboxRow(result.rows[0]) : { ...entry, created: false };
    }, 'outbox enqueue');
  }

  async claimOutbox({ limit = 10 } = {}) {
    return this.queueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT * FROM integration_outbox
           WHERE status IN ('pending', 'retrying') AND next_attempt_at <= now()
           ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
          [Number(limit) || 10],
        );
        const entries = [];
        for (const row of result.rows) {
          const updated = await client.query(
            `UPDATE integration_outbox
             SET status = 'processing', attempts = attempts + 1, locked_at = now()
             WHERE id = $1 RETURNING *`,
            [row.id],
          );
          if (updated.rows[0]) entries.push(outboxRow(updated.rows[0]));
        }
        await client.query('COMMIT');
        return entries;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }, 'outbox claim');
  }

  completeOutbox(id, result = null) {
    return this.queueWrite(() => this.pool.query(
      `UPDATE integration_outbox
       SET status = 'processed', processed_at = now(), locked_at = NULL, payload = payload || $2::jsonb
       WHERE id = $1`,
      [id, JSON.stringify({ result })],
    ), 'outbox complete');
  }

  failOutbox(id, error) {
    return this.queueWrite(async () => {
      const current = await this.pool.query('SELECT attempts FROM integration_outbox WHERE id = $1', [id]);
      const attempts = Number(current.rows[0]?.attempts ?? 1);
      const status = attempts >= 8 ? 'failed' : 'retrying';
      return this.pool.query(
        `UPDATE integration_outbox
         SET status = $2, next_attempt_at = now() + ($3 * interval '1 millisecond'), last_error = $4, locked_at = NULL
         WHERE id = $1`,
        [id, status, exponentialBackoff(attempts), error?.message ?? String(error)],
      );
    }, 'outbox failure');
  }

  listOutbox({ status, limit = 100 } = {}) {
    const values = [];
    const clauses = [];
    if (status) {
      values.push(status);
      clauses.push(`status = $${values.length}`);
    }
    values.push(Number(limit) || 100);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.pool.query(
      `SELECT * FROM integration_outbox ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
      values,
    ).then((result) => result.rows.map(outboxRow));
  }

  async save() {
    const state = this.getState();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
          INSERT INTO app_state (id, document, schema_version, updated_at)
          VALUES ($1, $2::jsonb, $3, now())
          ON CONFLICT (id) DO UPDATE
          SET document = EXCLUDED.document,
              schema_version = EXCLUDED.schema_version,
              updated_at = now()
        `,
        ['runtime', JSON.stringify(state), state.schemaVersion ?? 'unknown'],
      );
      await upsertMirrorTables(client, state);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  queueSave() {
    this.snapshotDirty = true;
    if (!this.snapshotSaveDeferred) this.snapshotSaveDeferred = deferred();
    this.scheduleSnapshotSave();
    return this.snapshotSaveDeferred.promise;
  }

  scheduleSnapshotSave() {
    if (this.snapshotSaving || !this.snapshotDirty || this.snapshotSaveTimer) return;
    this.snapshotSaveTimer = setTimeout(() => {
      this.snapshotSaveTimer = null;
      this.startSnapshotSave();
    }, SNAPSHOT_IDLE_DELAY_MS);
    this.snapshotSaveTimer.unref?.();
  }

  startSnapshotSave() {
    if (this.snapshotSaving || !this.snapshotDirty) return this.saveQueue;
    const snapshot = this.snapshotSaveDeferred;
    this.snapshotSaveDeferred = null;
    this.snapshotDirty = false;
    this.snapshotSaving = true;
    const write = this.queueWrite(() => this.save(), 'deferred snapshot save');
    write.then(
      () => snapshot?.resolve(),
      (error) => snapshot?.reject(error),
    ).finally(() => {
      this.snapshotSaving = false;
      this.scheduleSnapshotSave();
    });
    return write;
  }

  queueWrite(operation, label) {
    this.saveQueue = this.saveQueue.catch(() => undefined).then(operation);
    this.saveQueue.catch((error) => {
      console.error(`PostgresStore ${label} failed`, error);
    });
    return this.saveQueue;
  }

  async flush() {
    if (this.snapshotSaveTimer) {
      clearTimeout(this.snapshotSaveTimer);
      this.snapshotSaveTimer = null;
    }
    this.startSnapshotSave();
    await this.saveQueue;
    if (this.snapshotDirty) {
      this.startSnapshotSave();
      await this.saveQueue;
    }
  }

  async close() {
    await this.flush();
    await this.pool.end();
  }

  async migrate() {
    const migrations = (await fs.readdir(MIGRATIONS_DIR))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      const applied = await client.query('SELECT version FROM schema_migrations');
      const appliedVersions = new Set(applied.rows.map((row) => row.version));
      for (const migration of migrations) {
        if (appliedVersions.has(migration)) continue;
        const sql = await fs.readFile(path.join(MIGRATIONS_DIR, migration), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mergeSeedCatalog(state) {
  const seed = createSeedState();
  state.productsByTenant ??= {};
  state.driveFilesByTenant ??= {};
  for (const [tenantId, products] of Object.entries(seed.productsByTenant ?? {})) {
    state.productsByTenant[tenantId] = mergeByKey(state.productsByTenant[tenantId] ?? [], products, 'sku');
  }
  for (const [tenantId, files] of Object.entries(seed.driveFilesByTenant ?? {})) {
    state.driveFilesByTenant[tenantId] = mergeByKey(state.driveFilesByTenant[tenantId] ?? [], files, 'fileId');
  }
  state.tools = mergeByKey(state.tools ?? [], seed.tools ?? [], 'key');
}

function mergeByKey(current, seeded, key) {
  const byKey = new Map(current.map((item) => [item[key], item]));
  for (const seededItem of seeded) {
    if (!byKey.has(seededItem[key])) byKey.set(seededItem[key], seededItem);
  }
  return [...byKey.values()];
}

function outboxRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    idempotencyKey: row.idempotency_key,
    payload: row.payload ?? {},
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    lockedAt: row.locked_at,
    processedAt: row.processed_at,
  };
}

async function upsertMirrorTables(client, state) {
  const tenantIds = new Set((state.tenants ?? []).map((tenant) => tenant.id));
  for (const tenant of state.tenants ?? []) {
    await upsertTenant(client, tenant);
  }

  for (const [tenantId, subscription] of Object.entries(state.subscriptionsByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    await upsertSubscription(client, tenantId, subscription);
  }

  for (const plan of state.billingPlans ?? []) {
    await upsertBillingPlan(client, plan);
  }

  for (const [tenantId, payments] of Object.entries(state.subscriptionPaymentsByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const payment of payments ?? []) {
      await upsertSubscriptionPayment(client, tenantId, payment);
    }
  }

  for (const event of state.subscriptionEvents ?? []) {
    await upsertSubscriptionEvent(client, event);
  }

  for (const discount of state.billingDiscounts ?? []) {
    if (!tenantIds.has(discount.tenantId)) continue;
    await upsertBillingDiscount(client, discount);
  }

  for (const exception of state.billingAccessExceptions ?? []) {
    if (!tenantIds.has(exception.tenantId)) continue;
    await upsertBillingAccessException(client, exception);
  }

  for (const [tenantId, cycles] of Object.entries(state.billingUsageCyclesByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const cycle of cycles ?? []) {
      await upsertBillingUsageCycle(client, tenantId, cycle);
    }
  }

  for (const event of state.billingFunnelEvents ?? []) {
    await upsertBillingFunnelEvent(client, event);
  }

  for (const [tenantId, connection] of Object.entries(state.googleConnectionsByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    await upsertGoogleConnection(client, tenantId, connection);
  }

  for (const [tenantId, workspace] of Object.entries(state.googleWorkspacesByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    await upsertGoogleWorkspace(client, tenantId, workspace);
  }

  for (const [tenantId, products] of Object.entries(state.productsByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const product of products ?? []) {
      await upsertProduct(client, tenantId, product);
    }
  }

  for (const [tenantId, files] of Object.entries(state.driveFilesByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const file of files ?? []) {
      await upsertDriveFile(client, tenantId, file);
    }
  }

  for (const [tenantId, profiles] of Object.entries(state.customerProfilesByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const [waId, profile] of Object.entries(profiles ?? {})) {
      await upsertCustomerProfile(client, tenantId, waId, profile);
    }
  }

  for (const conversation of state.conversations ?? []) {
    if (!tenantIds.has(conversation.tenantId)) continue;
    await upsertConversation(client, conversation);
  }

  for (const [tenantId, orders] of Object.entries(state.ordersByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const order of orders ?? []) {
      await upsertOrder(client, tenantId, order, { strictVersion: true, throwOnConflict: false });
    }
  }

  for (const request of state.pendingRequests ?? []) {
    if (!tenantIds.has(request.tenantId)) continue;
    await upsertPendingRequest(client, request);
  }

  for (const transaction of state.transactions ?? []) {
    if (!tenantIds.has(transaction.tenantId)) continue;
    await upsertTransaction(client, transaction);
  }

  for (const event of state.events ?? []) {
    if (event.tenantId && !tenantIds.has(event.tenantId)) continue;
    await upsertEvent(client, event);
  }

  for (const user of state.users ?? []) {
    await upsertUser(client, user);
  }

  const userIds = new Set((state.users ?? []).map((user) => user.id));
  for (const member of state.tenantMembers ?? []) {
    if (!tenantIds.has(member.tenantId) || !userIds.has(member.userId)) continue;
    await upsertTenantMember(client, member);
  }

  for (const session of Object.values(state.sessionsById ?? {})) {
    if (!userIds.has(session.userId)) continue;
    await upsertSession(client, session);
  }

  for (const event of state.auditEvents ?? []) {
    if (event.tenantId && !tenantIds.has(event.tenantId)) continue;
    await upsertAuditEvent(client, event);
  }

  for (const event of state.webhookEvents ?? []) {
    await upsertWebhookEvent(client, event);
  }

  for (const [tenantId, periods] of Object.entries(state.usageCountersByTenant ?? {})) {
    if (!tenantIds.has(tenantId)) continue;
    for (const [period, counters] of Object.entries(periods ?? {})) {
      for (const [metric, value] of Object.entries(counters ?? {})) {
        await upsertUsageCounter(client, tenantId, period, metric, value);
      }
    }
  }
}

async function upsertWebhookEvent(client, event) {
  await client.query(
    `
      INSERT INTO webhook_events (
        id, provider, tenant_id, event_type, external_id, status,
        received_at, processed_at, duration_ms, http_status, idempotency_key,
        payload_redacted, headers_redacted, error_code, error_message,
        conversation_id, metadata, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17::jsonb, $18::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          processed_at = EXCLUDED.processed_at,
          duration_ms = EXCLUDED.duration_ms,
          http_status = EXCLUDED.http_status,
          error_code = EXCLUDED.error_code,
          error_message = EXCLUDED.error_message,
          conversation_id = EXCLUDED.conversation_id,
          metadata = EXCLUDED.metadata,
          payload = EXCLUDED.payload
    `,
    [
      event.id,
      event.provider,
      event.tenantId,
      event.eventType,
      event.externalId,
      event.status,
      event.receivedAt,
      event.processedAt,
      event.durationMs ?? 0,
      event.httpStatus,
      event.idempotencyKey,
      JSON.stringify(event.payloadRedacted ?? {}),
      JSON.stringify(event.headersRedacted ?? {}),
      event.errorCode,
      event.errorMessage,
      event.conversationId,
      JSON.stringify(event.metadata ?? {}),
      JSON.stringify(event),
    ],
  );
}

async function upsertTenant(client, tenant) {
  await client.query(
    `
      INSERT INTO tenants (id, name, status, plan, whatsapp_number, config, lifecycle, payload, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, now())
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          status = EXCLUDED.status,
          plan = EXCLUDED.plan,
          whatsapp_number = EXCLUDED.whatsapp_number,
          config = EXCLUDED.config,
          lifecycle = EXCLUDED.lifecycle,
          payload = EXCLUDED.payload,
          updated_at = now()
    `,
    [
      tenant.id,
      tenant.name,
      tenant.status,
      tenant.plan,
      tenant.whatsappNumber,
      JSON.stringify(tenant.config ?? {}),
      JSON.stringify(tenant.lifecycle ?? {}),
      JSON.stringify(tenant),
    ],
  );

  const whatsapp = tenant.config?.whatsapp ?? {};
  await client.query(
    `
      INSERT INTO whatsapp_bindings (tenant_id, phone_number_id_ref, phone_number_id, access_token_ref, payload, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, now())
      ON CONFLICT (tenant_id) DO UPDATE
      SET phone_number_id_ref = EXCLUDED.phone_number_id_ref,
          phone_number_id = EXCLUDED.phone_number_id,
          access_token_ref = EXCLUDED.access_token_ref,
          payload = EXCLUDED.payload,
          updated_at = now()
    `,
    [tenant.id, whatsapp.phoneNumberIdRef, whatsapp.phoneNumberId, whatsapp.accessTokenRef, JSON.stringify(whatsapp)],
  );

  for (const secret of secretReferencesFromTenant(tenant)) {
    await client.query(
      `
        INSERT INTO secret_references (tenant_id, name, provider, purpose, ref, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (tenant_id, name) DO UPDATE
        SET provider = EXCLUDED.provider,
            purpose = EXCLUDED.purpose,
            ref = EXCLUDED.ref,
            updated_at = now()
      `,
      [tenant.id, secret.name, secret.provider, secret.purpose, secret.ref],
    );
  }
}

async function upsertSubscription(client, tenantId, subscription) {
  await client.query(
    `
      INSERT INTO subscriptions (
        tenant_id, provider, status, payer_email, mercado_pago_preapproval_id, plan_id,
        checkout_url, checkout_expires_at, current_period_start, current_period_end,
        next_billing_date, grace_ends_at, cancel_at_period_end, cancelled_at,
        suspended_at, reactivated_at, last_sync_at, payload, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, now())
      ON CONFLICT (tenant_id) DO UPDATE
      SET provider = EXCLUDED.provider,
          status = EXCLUDED.status,
          payer_email = EXCLUDED.payer_email,
          mercado_pago_preapproval_id = EXCLUDED.mercado_pago_preapproval_id,
          plan_id = EXCLUDED.plan_id,
          checkout_url = EXCLUDED.checkout_url,
          checkout_expires_at = EXCLUDED.checkout_expires_at,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          next_billing_date = EXCLUDED.next_billing_date,
          grace_ends_at = EXCLUDED.grace_ends_at,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          cancelled_at = EXCLUDED.cancelled_at,
          suspended_at = EXCLUDED.suspended_at,
          reactivated_at = EXCLUDED.reactivated_at,
          last_sync_at = EXCLUDED.last_sync_at,
          payload = EXCLUDED.payload,
          updated_at = now()
    `,
    [
      tenantId,
      subscription.provider ?? 'mercado_pago',
      subscription.status ?? 'pending',
      subscription.payerEmail,
      subscription.mercadoPagoPreapprovalId,
      subscription.planId ?? null,
      subscription.checkoutUrl ?? null,
      subscription.checkoutExpiresAt ?? null,
      subscription.currentPeriodStart ?? null,
      subscription.currentPeriodEnd ?? null,
      subscription.nextBillingDate ?? null,
      subscription.graceEndsAt ?? null,
      Boolean(subscription.cancelAtPeriodEnd),
      subscription.cancelledAt ?? null,
      subscription.suspendedAt ?? null,
      subscription.reactivatedAt ?? null,
      subscription.lastSyncAt ?? null,
      JSON.stringify(subscription),
    ],
  );
}

async function upsertBillingPlan(client, plan) {
  await client.query(
    `
      INSERT INTO billing_plans (
        id, name, description, currency, amount, billing_frequency, included_deliveries,
        included_interactions, trial_enabled, trial_days, grace_days, is_active, is_default,
        mercadopago_plan_id, payload, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          description = EXCLUDED.description,
          currency = EXCLUDED.currency,
          amount = EXCLUDED.amount,
          billing_frequency = EXCLUDED.billing_frequency,
          included_deliveries = EXCLUDED.included_deliveries,
          included_interactions = EXCLUDED.included_interactions,
          trial_enabled = EXCLUDED.trial_enabled,
          trial_days = EXCLUDED.trial_days,
          grace_days = EXCLUDED.grace_days,
          is_active = EXCLUDED.is_active,
          is_default = EXCLUDED.is_default,
          mercadopago_plan_id = EXCLUDED.mercadopago_plan_id,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      plan.id,
      plan.name,
      plan.description ?? '',
      plan.currency ?? 'COP',
      plan.amount ?? 0,
      plan.billingFrequency ?? 'monthly',
      plan.includedDeliveries ?? 400,
      plan.includedInteractions ?? 2700,
      Boolean(plan.trialEnabled),
      plan.trialDays ?? 0,
      plan.graceDays ?? 5,
      plan.isActive ?? true,
      Boolean(plan.isDefault),
      plan.mercadoPagoPlanId ?? null,
      JSON.stringify(plan),
      plan.createdAt ?? new Date().toISOString(),
      plan.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertSubscriptionPayment(client, tenantId, payment) {
  await client.query(
    `
      INSERT INTO subscription_payments (
        id, tenant_id, subscription_id, mercadopago_payment_id, mercadopago_preapproval_id,
        status, amount, currency, paid_at, external_reference, receipt_url,
        raw_status_detail, payload, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          paid_at = EXCLUDED.paid_at,
          receipt_url = EXCLUDED.receipt_url,
          raw_status_detail = EXCLUDED.raw_status_detail,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      payment.id,
      tenantId,
      payment.subscriptionId ?? `sub-${tenantId}`,
      payment.mercadoPagoPaymentId ?? null,
      payment.mercadoPagoPreapprovalId ?? null,
      payment.status ?? 'approved',
      payment.amount ?? 0,
      payment.currency ?? 'COP',
      payment.paidAt ?? null,
      payment.externalReference ?? tenantId,
      payment.receiptUrl ?? null,
      payment.rawStatusDetail ?? null,
      JSON.stringify(payment),
      payment.createdAt ?? new Date().toISOString(),
      payment.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertSubscriptionEvent(client, event) {
  await client.query(
    `
      INSERT INTO subscription_events (id, tenant_id, subscription_id, provider, event_type, external_event_id, status_before, status_after, payload_masked, processed_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
      ON CONFLICT (id) DO UPDATE
      SET status_after = EXCLUDED.status_after,
          payload_masked = EXCLUDED.payload_masked,
          processed_at = EXCLUDED.processed_at
    `,
    [
      event.id,
      event.tenantId ?? null,
      event.subscriptionId ?? null,
      event.provider ?? 'mercado_pago',
      event.eventType,
      event.externalEventId ?? null,
      event.statusBefore ?? null,
      event.statusAfter ?? null,
      JSON.stringify(event.payloadMasked ?? {}),
      event.processedAt ?? null,
      event.createdAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertBillingDiscount(client, discount) {
  await client.query(
    `
      INSERT INTO billing_discounts (id, tenant_id, plan_id, discount_type, discount_value, starts_at, ends_at, reason, approved_by, status, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      discount.id,
      discount.tenantId,
      discount.planId ?? null,
      discount.discountType,
      discount.discountValue,
      discount.startsAt,
      discount.endsAt,
      discount.reason,
      discount.approvedBy ?? null,
      discount.status ?? 'active',
      JSON.stringify(discount),
      discount.createdAt ?? new Date().toISOString(),
      discount.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertBillingAccessException(client, exception) {
  await client.query(
    `
      INSERT INTO billing_access_exceptions (id, tenant_id, reason, starts_at, expires_at, created_by, status, payload, created_at, revoked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      ON CONFLICT (id) DO UPDATE
      SET status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          revoked_at = EXCLUDED.revoked_at
    `,
    [
      exception.id,
      exception.tenantId,
      exception.reason,
      exception.startsAt,
      exception.expiresAt,
      exception.createdBy ?? null,
      exception.status ?? 'active',
      JSON.stringify(exception),
      exception.createdAt ?? new Date().toISOString(),
      exception.revokedAt ?? null,
    ],
  );
}

async function upsertBillingUsageCycle(client, tenantId, cycle) {
  await client.query(
    `
      INSERT INTO billing_usage_cycles (id, tenant_id, subscription_id, period_start, period_end, deliveries_used, interactions_used, llm_tokens_used, tool_calls_used, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
      ON CONFLICT (id) DO UPDATE
      SET deliveries_used = EXCLUDED.deliveries_used,
          interactions_used = EXCLUDED.interactions_used,
          llm_tokens_used = EXCLUDED.llm_tokens_used,
          tool_calls_used = EXCLUDED.tool_calls_used,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      cycle.id,
      tenantId,
      cycle.subscriptionId ?? `sub-${tenantId}`,
      cycle.periodStart,
      cycle.periodEnd,
      cycle.deliveriesUsed ?? 0,
      cycle.interactionsUsed ?? 0,
      cycle.llmTokensUsed ?? 0,
      cycle.toolCallsUsed ?? 0,
      JSON.stringify(cycle),
      cycle.createdAt ?? new Date().toISOString(),
      cycle.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertBillingFunnelEvent(client, event) {
  await client.query(
    `
      INSERT INTO billing_funnel_events (id, tenant_id, stage, reason_code, note, actor_id, payload, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (id) DO UPDATE
      SET reason_code = EXCLUDED.reason_code,
          note = EXCLUDED.note,
          payload = EXCLUDED.payload
    `,
    [
      event.id,
      event.tenantId ?? null,
      event.stage,
      event.reasonCode ?? null,
      event.note ?? null,
      event.actorId ?? null,
      JSON.stringify(event.payload ?? {}),
      event.createdAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertGoogleConnection(client, tenantId, connection) {
  await client.query(
    `
      INSERT INTO google_connections (tenant_id, status, mode, account_email, refresh_token_ref, payload, connected_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
      ON CONFLICT (tenant_id) DO UPDATE
      SET status = EXCLUDED.status,
          mode = EXCLUDED.mode,
          account_email = EXCLUDED.account_email,
          refresh_token_ref = EXCLUDED.refresh_token_ref,
          payload = EXCLUDED.payload,
          connected_at = EXCLUDED.connected_at,
          updated_at = now()
    `,
    [
      tenantId,
      connection.status,
      connection.mode,
      connection.accountEmail,
      connection.refreshTokenRef,
      JSON.stringify(connection),
      connection.connectedAt ?? null,
    ],
  );
}

async function upsertGoogleWorkspace(client, tenantId, workspace) {
  await client.query(
    `
      INSERT INTO google_workspaces (tenant_id, status, spreadsheet_id, root_folder_id, payload, provisioned_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
      ON CONFLICT (tenant_id) DO UPDATE
      SET status = EXCLUDED.status,
          spreadsheet_id = EXCLUDED.spreadsheet_id,
          root_folder_id = EXCLUDED.root_folder_id,
          payload = EXCLUDED.payload,
          provisioned_at = EXCLUDED.provisioned_at,
          updated_at = now()
    `,
    [
      tenantId,
      workspace.status,
      workspace.spreadsheet?.id,
      workspace.rootFolder?.id,
      JSON.stringify(workspace),
      workspace.provisionedAt ?? null,
    ],
  );
}

async function upsertProduct(client, tenantId, product) {
  await client.query(
    `
      INSERT INTO products (tenant_id, sku, name, category, price, stock, drive_file_id, aliases, payload, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())
      ON CONFLICT (tenant_id, sku) DO UPDATE
      SET name = EXCLUDED.name,
          category = EXCLUDED.category,
          price = EXCLUDED.price,
          stock = EXCLUDED.stock,
          drive_file_id = EXCLUDED.drive_file_id,
          aliases = EXCLUDED.aliases,
          payload = EXCLUDED.payload,
          updated_at = now()
    `,
    [
      tenantId,
      product.sku,
      product.name,
      product.category,
      product.price ?? 0,
      product.stock ?? 0,
      product.driveFileId,
      JSON.stringify(product.aliases ?? []),
      JSON.stringify(product),
    ],
  );
}

async function upsertDriveFile(client, tenantId, file) {
  await client.query(
    `
      INSERT INTO drive_files (tenant_id, file_id, name, mime_type, summary, payload, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
      ON CONFLICT (tenant_id, file_id) DO UPDATE
      SET name = EXCLUDED.name,
          mime_type = EXCLUDED.mime_type,
          summary = EXCLUDED.summary,
          payload = EXCLUDED.payload,
          updated_at = now()
    `,
    [tenantId, file.fileId, file.name, file.mimeType, file.summary, JSON.stringify(file)],
  );
}

async function upsertCustomerProfile(client, tenantId, waId, profile) {
  await client.query(
    `
      INSERT INTO customer_profiles (tenant_id, wa_id, name, default_address, phone, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      ON CONFLICT (tenant_id, wa_id) DO UPDATE
      SET name = EXCLUDED.name,
          default_address = EXCLUDED.default_address,
          phone = EXCLUDED.phone,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      tenantId,
      waId,
      profile.name,
      profile.defaultAddress,
      profile.phone ?? waId,
      JSON.stringify(profile),
      profile.createdAt ?? new Date().toISOString(),
      profile.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertConversation(client, conversation) {
  await client.query(
    `
      INSERT INTO conversations (id, tenant_id, wa_id, status, stage, value, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
      ON CONFLICT (id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          wa_id = EXCLUDED.wa_id,
          status = EXCLUDED.status,
          stage = EXCLUDED.stage,
          value = EXCLUDED.value,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      conversation.id,
      conversation.tenantId,
      conversation.waId,
      conversation.status ?? 'live',
      conversation.stage,
      conversation.value,
      JSON.stringify(conversation),
      conversation.createdAt ?? new Date().toISOString(),
      conversation.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertOrder(client, tenantId, order, { strictVersion = false, throwOnConflict = true } = {}) {
  const result = await client.query(
    `
      INSERT INTO orders (id, tenant_id, conversation_id, wa_id, status, subtotal, version, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      ON CONFLICT (id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          conversation_id = EXCLUDED.conversation_id,
          wa_id = EXCLUDED.wa_id,
          status = EXCLUDED.status,
          subtotal = EXCLUDED.subtotal,
          version = EXCLUDED.version,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      ${strictVersion ? 'WHERE orders.version < EXCLUDED.version' : ''}
      RETURNING id
    `,
    [
      order.id,
      tenantId,
      order.conversationId,
      order.waId,
      order.status ?? 'pending',
      order.subtotal ?? 0,
      Number(order.version ?? 0),
      JSON.stringify(order),
      order.createdAt ?? new Date().toISOString(),
      order.updatedAt ?? new Date().toISOString(),
    ],
  );
  if (strictVersion && throwOnConflict && result.rowCount === 0) {
    const error = new Error('El pedido fue actualizado por otro operador. Recarga la cola e inténtalo de nuevo.');
    error.code = 'order_version_conflict';
    error.statusCode = 409;
    throw error;
  }
  return result;
}

async function upsertPendingRequest(client, request) {
  await client.query(
    `
      INSERT INTO pending_requests (id, tenant_id, conversation_id, type, status, title, urgency, payload, created_at, resolved_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      ON CONFLICT (id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          conversation_id = EXCLUDED.conversation_id,
          type = EXCLUDED.type,
          status = EXCLUDED.status,
          title = EXCLUDED.title,
          urgency = EXCLUDED.urgency,
          payload = EXCLUDED.payload,
          resolved_at = EXCLUDED.resolved_at
    `,
    [
      request.id,
      request.tenantId,
      request.conversationId,
      request.type,
      request.status ?? 'pending',
      request.title,
      request.urgency,
      JSON.stringify(request),
      request.createdAt ?? new Date().toISOString(),
      request.resolvedAt ?? null,
    ],
  );
}

async function upsertTransaction(client, transaction) {
  await client.query(
    `
      INSERT INTO transactions (id, tenant_id, conversation_id, action_name, status, payload, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT (id) DO UPDATE
      SET tenant_id = EXCLUDED.tenant_id,
          conversation_id = EXCLUDED.conversation_id,
          action_name = EXCLUDED.action_name,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload
    `,
    [
      transaction.id,
      transaction.tenantId,
      transaction.conversationId,
      transaction.actionName,
      transaction.status ?? 'success',
      JSON.stringify(transaction),
      transaction.createdAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertEvent(client, event) {
  await client.query(
    `
      INSERT INTO events (id, tenant_id, conversation_id, type, detail, metadata, payload, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      ON CONFLICT (id) DO UPDATE
      SET detail = EXCLUDED.detail,
          metadata = EXCLUDED.metadata,
          payload = EXCLUDED.payload
    `,
    [
      event.id,
      event.tenantId,
      event.conversationId,
      event.type,
      event.detail,
      JSON.stringify(event.metadata ?? {}),
      JSON.stringify(event),
      event.at ?? new Date().toISOString(),
    ],
  );
}

async function upsertUser(client, user) {
  await client.query(
    `
      INSERT INTO users (id, google_subject, email, name, picture_url, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      ON CONFLICT (id) DO UPDATE
      SET google_subject = EXCLUDED.google_subject,
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          picture_url = EXCLUDED.picture_url,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      user.id,
      user.googleSubject,
      user.email,
      user.name,
      user.pictureUrl,
      JSON.stringify(user),
      user.createdAt ?? new Date().toISOString(),
      user.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertTenantMember(client, member) {
  await client.query(
    `
      INSERT INTO tenant_members (tenant_id, user_id, role, status, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = EXCLUDED.role,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      member.tenantId,
      member.userId,
      member.role,
      member.status,
      JSON.stringify(member),
      member.createdAt ?? new Date().toISOString(),
      member.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertSession(client, session) {
  await client.query(
    `
      INSERT INTO sessions (id, user_id, expires_at, revoked_at, payload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
      ON CONFLICT (id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          expires_at = EXCLUDED.expires_at,
          revoked_at = EXCLUDED.revoked_at,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
    `,
    [
      session.id,
      session.userId,
      session.expiresAt,
      session.revokedAt ?? null,
      JSON.stringify(session),
      session.createdAt ?? new Date().toISOString(),
      session.updatedAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertAuditEvent(client, event) {
  await client.query(
    `
      INSERT INTO audit_events (id, tenant_id, actor_id, action, resource, metadata, payload, created_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      ON CONFLICT (id) DO UPDATE
      SET metadata = EXCLUDED.metadata,
          payload = EXCLUDED.payload
    `,
    [
      event.id,
      event.tenantId ?? null,
      event.actorId ?? null,
      event.action,
      event.resource ?? null,
      JSON.stringify(event.metadata ?? {}),
      JSON.stringify(event),
      event.createdAt ?? new Date().toISOString(),
    ],
  );
}

async function upsertUsageCounter(client, tenantId, period, metric, value) {
  await client.query(
    `
      INSERT INTO usage_counters (tenant_id, period, metric, value, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (tenant_id, period, metric) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = now()
    `,
    [tenantId, period, metric, Math.trunc(Number(value) || 0)],
  );
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function resolveSsl(databaseUrl, ssl) {
  if (ssl === 'disable' || ssl === false) return false;
  if (ssl === 'require') return { rejectUnauthorized: false };
  if (databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1')) return false;
  return { rejectUnauthorized: false };
}

function secretReferencesFromTenant(tenant) {
  const refs = [];
  const add = (name, ref, purpose) => {
    if (ref) refs.push({ name, ref, purpose, provider: 'environment' });
  };
  add('whatsapp_phone_number_id', tenant.config?.whatsapp?.phoneNumberIdRef, 'WhatsApp tenant phone binding');
  add('whatsapp_access_token', tenant.config?.whatsapp?.accessTokenRef, 'WhatsApp Cloud API messaging');
  add('whatsapp_verify_token', tenant.config?.whatsapp?.verifyTokenRef, 'WhatsApp webhook verification');
  add('whatsapp_app_secret', tenant.config?.whatsapp?.appSecretRef, 'WhatsApp webhook signature');
  add('google_refresh_token', tenant.config?.googleSheets?.refreshTokenRef ?? tenant.config?.googleDrive?.refreshTokenRef, 'Google Drive and Sheets OAuth');
  add('google_spreadsheet_id', tenant.config?.googleSheets?.spreadsheetIdRef, 'Tenant operations spreadsheet');
  add('google_drive_root_folder', tenant.config?.googleDrive?.rootFolderRef, 'Tenant Drive root folder');
  return refs;
}
