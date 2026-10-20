import fs from 'node:fs';
import path from 'node:path';
import { createSeedState } from '../data/seed.js';
import { ensureSaasState } from '../services/saasControlPlane.js';
import { ensureIdentityState } from '../services/authService.js';
import { ensureUsageState } from '../services/usageService.js';
import { ensureSecretState } from '../services/secretVault.js';
import { ensurePlatformState } from '../services/platformService.js';

export class JsonStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.state = null;
  }

  load() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.state = createSeedState();
      ensureSaasState(this.state);
      ensureIdentityState(this.state);
      ensureUsageState(this.state);
      ensureSecretState(this.state);
      ensurePlatformState(this.state);
      this.save();
      return this.state;
    }
    this.state = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    this.migrate();
    return this.state;
  }

  getState() {
    if (!this.state) return this.load();
    return this.state;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  mutate(mutator) {
    const state = this.getState();
    const result = mutator(state);
    this.save();
    return result;
  }

  claimProcessedMessage(messageId, payload = {}) {
    if (!messageId) return true;
    let claimed = false;
    this.mutate((state) => {
      state.processedMessages ??= [];
      if (state.processedMessages.includes(messageId)) return;
      state.processedMessages.unshift(messageId);
      state.processedMessages = [...new Set(state.processedMessages)].slice(0, 1000);
      claimed = true;
      state.processedMessagePayloads ??= {};
      state.processedMessagePayloads[messageId] = payload;
    });
    return claimed;
  }

  enqueueOutbox(entry) {
    let created = false;
    this.mutate((state) => {
      state.integrationOutbox ??= [];
      if (state.integrationOutbox.some((item) => item.idempotencyKey === entry.idempotencyKey)) return;
      state.integrationOutbox.push(entry);
      created = true;
    });
    return { ...entry, created };
  }

  persistOrderWithOutbox(_tenantId, _orderId, entries = []) {
    this.mutate((state) => {
      state.integrationOutbox ??= [];
      for (const entry of entries) {
        if (!state.integrationOutbox.some((item) => item.idempotencyKey === entry.idempotencyKey)) {
          state.integrationOutbox.push(entry);
        }
      }
    });
  }

  enqueueInboundMessage(normalized) {
    if (!normalized?.messageId || !normalized?.tenantId) {
      throw new Error('Inbound messages require messageId and tenantId');
    }
    const now = new Date().toISOString();
    const entry = createInboundOutboxEntry(normalized, now);
    let created = false;
    let inbound = null;
    this.mutate((state) => {
      state.inboundMessagesById ??= {};
      const existing = state.inboundMessagesById[normalized.messageId];
      if (existing) {
        inbound = { ...existing };
        return;
      }
      inbound = {
        messageId: normalized.messageId,
        tenantId: normalized.tenantId,
        provider: normalized.provider ?? 'meta_whatsapp_cloud_api',
        phoneNumberId: normalized.phoneNumberId ?? null,
        waId: normalized.waId ?? null,
        messageType: normalized.messageType ?? 'text',
        payload: normalized,
        status: 'queued',
        attempts: 0,
        receivedAt: now,
        processingAt: null,
        completedAt: null,
        lastError: null,
        result: null,
      };
      state.inboundMessagesById[normalized.messageId] = inbound;
      state.integrationOutbox ??= [];
      if (!state.integrationOutbox.some((item) => item.idempotencyKey === entry.idempotencyKey)) {
        state.integrationOutbox.push(entry);
      }
      created = true;
    });
    return { created, inbound, outbox: entry };
  }

  getInboundMessage(messageId) {
    const record = this.getState().inboundMessagesById?.[messageId];
    return record ? { ...record } : null;
  }

  markInboundMessageProcessing(messageId) {
    return this.updateInboundMessage(messageId, (record) => {
      record.status = 'processing';
      record.attempts = Number(record.attempts ?? 0) + 1;
      record.processingAt = new Date().toISOString();
      record.lastError = null;
    });
  }

  completeInboundMessage(messageId, result = null) {
    return this.updateInboundMessage(messageId, (record) => {
      record.status = 'completed';
      record.completedAt = new Date().toISOString();
      record.result = result ?? null;
      record.lastError = null;
    });
  }

  failInboundMessage(messageId, error, { terminal = false } = {}) {
    return this.updateInboundMessage(messageId, (record) => {
      record.status = terminal ? 'dead_letter' : 'retrying';
      record.lastError = error?.message ?? String(error);
    });
  }

  updateInboundMessage(messageId, update) {
    let inbound = null;
    this.mutate((state) => {
      const current = state.inboundMessagesById?.[messageId];
      if (!current) return;
      update(current);
      inbound = { ...current };
    });
    return inbound;
  }

  createInteractionOffer(offer) {
    if (!offer?.id || !offer?.tenantId || !offer?.conversationId) {
      throw new Error('Interaction offers require id, tenantId and conversationId');
    }
    let saved;
    this.mutate((state) => {
      state.interactionOffersById ??= {};
      saved = state.interactionOffersById[offer.id] ?? {
        ...offer,
        status: offer.status ?? 'active',
        version: Number(offer.version ?? 1),
        createdAt: offer.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.interactionOffersById[offer.id] = saved;
    });
    return { ...saved };
  }

  consumeInteractionOffer({ offerId, optionId, tenantId, conversationId }) {
    let outcome = { status: 'not_found', offer: null };
    this.mutate((state) => {
      const offer = state.interactionOffersById?.[offerId];
      if (!offer) return;
      if (offer.tenantId !== tenantId || offer.conversationId !== conversationId) {
        outcome = { status: 'mismatch', offer: { ...offer } };
        return;
      }
      if (offer.status !== 'active' || new Date(offer.expiresAt).getTime() <= Date.now()) {
        outcome = { status: 'expired', offer: { ...offer } };
        return;
      }
      const option = (offer.options ?? []).find((item) => item.id === optionId);
      if (!option) {
        outcome = { status: 'invalid_option', offer: { ...offer } };
        return;
      }
      offer.status = 'consumed';
      offer.consumedAt = new Date().toISOString();
      offer.consumedOptionId = optionId;
      offer.updatedAt = offer.consumedAt;
      outcome = { status: 'consumed', offer: { ...offer }, option: { ...option } };
    });
    return outcome;
  }

  claimOutbox({ limit = 10 } = {}) {
    const now = Date.now();
    const claimed = [];
    this.mutate((state) => {
      state.integrationOutbox ??= [];
      for (const item of state.integrationOutbox) {
        if (claimed.length >= limit) break;
        const available = (
          ['pending', 'retrying'].includes(item.status)
          && new Date(item.nextAttemptAt ?? 0).getTime() <= now
        ) || (
          item.status === 'processing'
          && new Date(item.lockedAt ?? 0).getTime() < now - (5 * 60_000)
        );
        if (!available) continue;
        item.status = 'processing';
        item.attempts = Number(item.attempts ?? 0) + 1;
        item.lockedAt = new Date().toISOString();
        claimed.push({ ...item });
      }
    });
    return claimed;
  }

  completeOutbox(id, result = null) {
    this.mutate((state) => {
      const item = state.integrationOutbox?.find((entry) => entry.id === id);
      if (!item) return;
      item.status = 'processed';
      item.processedAt = new Date().toISOString();
      item.lockedAt = null;
      item.result = result ?? null;
    });
  }

  failOutbox(id, error, { maxAttempts = 8 } = {}) {
    let failed = null;
    this.mutate((state) => {
      const item = state.integrationOutbox?.find((entry) => entry.id === id);
      if (!item) return;
      item.status = Number(item.attempts ?? 0) >= maxAttempts ? 'failed' : 'retrying';
      item.nextAttemptAt = new Date(Date.now() + Math.min(15 * 60_000, 1_000 * (2 ** Math.max(0, Number(item.attempts ?? 1) - 1)))).toISOString();
      item.lastError = error?.message ?? String(error);
      item.lockedAt = null;
      failed = { ...item };
    });
    return failed;
  }

  listOutbox({ status, limit = 100 } = {}) {
    return (this.getState().integrationOutbox ?? [])
      .filter((item) => !status || item.status === status)
      .slice(-Number(limit));
  }

  migrate() {
    const seed = createSeedState();
    this.state.schemaVersion = seed.schemaVersion;
    this.state.tenants = mergeById(this.state.tenants ?? [], seed.tenants, (current, seeded) => ({
      ...seeded,
      ...current,
      config: mergeDeep(seeded.config ?? {}, current.config ?? {}),
    }));
    this.state.tools = mergeByKey(this.state.tools ?? [], seed.tools, 'key');
    this.state.productsByTenant = mergeTenantRecords(this.state.productsByTenant ?? {}, seed.productsByTenant ?? {}, 'sku');
    this.state.driveFilesByTenant = mergeTenantRecords(this.state.driveFilesByTenant ?? {}, seed.driveFilesByTenant ?? {}, 'fileId');
    this.state.customerProfilesByTenant = {
      ...(seed.customerProfilesByTenant ?? {}),
      ...(this.state.customerProfilesByTenant ?? {}),
    };
    this.state.ordersByTenant = {
      ...(seed.ordersByTenant ?? {}),
      ...(this.state.ordersByTenant ?? {}),
    };
    this.state.pendingRequests ??= [];
    this.state.events ??= [];
    this.state.processedMessages ??= [];
    this.state.processedMessagePayloads ??= {};
    this.state.integrationOutbox ??= [];
    this.state.inboundMessagesById ??= {};
    this.state.interactionOffersById ??= {};
    this.state.transactions ??= [];
    ensureSaasState(this.state);
    ensureIdentityState(this.state);
    ensureUsageState(this.state);
    ensureSecretState(this.state);
    ensurePlatformState(this.state);
    this.save();
  }
}

function createInboundOutboxEntry(normalized, now) {
  return {
    id: `outbox-inbound-${normalized.messageId}`,
    tenantId: normalized.tenantId,
    kind: 'whatsapp.inbound_processing',
    aggregateType: 'inbound_message',
    aggregateId: normalized.messageId,
    idempotencyKey: `inbound:${normalized.messageId}`,
    payload: { messageId: normalized.messageId },
    status: 'pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
    lockedAt: null,
    processedAt: null,
  };
}

function mergeById(current, seeded, merger = (item) => item) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const seededItem of seeded) {
    byId.set(seededItem.id, byId.has(seededItem.id) ? merger(byId.get(seededItem.id), seededItem) : seededItem);
  }
  return [...byId.values()];
}

function mergeByKey(current, seeded, key) {
  const byKey = new Map(current.map((item) => [item[key], item]));
  for (const seededItem of seeded) {
    byKey.set(seededItem[key], byKey.has(seededItem[key]) ? { ...seededItem, ...byKey.get(seededItem[key]) } : seededItem);
  }
  return [...byKey.values()];
}

function mergeTenantRecords(current, seeded, key) {
  const output = { ...current };
  for (const [tenantId, seededRecords] of Object.entries(seeded)) {
    output[tenantId] = mergeByKey(output[tenantId] ?? [], seededRecords, key);
  }
  return output;
}

function mergeDeep(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeDeep(output[key] ?? {}, value)
      : value;
  }
  return output;
}
