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
    this.state.transactions ??= [];
    ensureSaasState(this.state);
    ensureIdentityState(this.state);
    ensureUsageState(this.state);
    ensureSecretState(this.state);
    ensurePlatformState(this.state);
    this.save();
  }
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
