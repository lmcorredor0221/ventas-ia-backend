import { effectiveCatalogRange } from '../domain/catalogSource.js';

export class CatalogSyncWorker {
  constructor({ store, tools, config, events, telemetry } = {}) {
    Object.assign(this, { store, tools, config, events, telemetry });
    this.timer = null;
    this.running = false;
    this.locks = new Map();
    this.lastResults = new Map();
  }

  async syncTenant(tenantId, reason = 'manual') {
    if (this.locks.has(tenantId)) return this.locks.get(tenantId);
    const operation = this.syncTenantUnlocked(tenantId, reason);
    const tracked = operation.then((result) => {
      this.lastResults.set(tenantId, result);
      return result;
    }, (error) => {
      const result = { status: 'failed', tenantId, reason, error: error.message };
      this.lastResults.set(tenantId, result);
      throw error;
    }).finally(() => {
      if (this.locks.get(tenantId) === tracked) this.locks.delete(tenantId);
    });
    this.locks.set(tenantId, tracked);
    return tracked;
  }

  async syncTenantUnlocked(tenantId, reason) {
    const startedAt = performance.now();
    const tenant = this.store.getTenant
      ? await this.store.getTenant(tenantId)
      : this.store.getState().tenants.find((item) => item.id === tenantId);
    if (!tenant) return { status: 'not_found', tenantId };

    try {
      const live = await this.tools.liveGoogleContext(tenantId);
      if (!live) {
        const result = { status: 'skipped', code: 'google_unavailable', tenantId, reason };
        this.events?.emit({ type: 'catalog.sync.skipped', tenantId, detail: 'Catalog sync skipped: Google unavailable', metadata: result });
        return result;
      }
      const range = effectiveCatalogRange(tenant);
      const rows = await this.tools.readLiveCatalogRows({ tenantId, tenant, live, range, persist: false });
      if (!rows.length) {
        const result = { status: 'skipped', code: 'empty_catalog', tenantId, reason };
        this.events?.emit({ type: 'catalog.sync.skipped', tenantId, detail: 'Catalog sync skipped: empty catalog', metadata: result });
        return result;
      }
      const driveFiles = rows
        .filter((row) => row.driveFileId)
        .map((row) => ({
          fileId: row.driveFileId,
          name: `${row.name} - ficha comercial`,
          mimeType: 'application/vnd.google-apps.document',
          summary: `${row.name}. Categoria: ${row.category}. Marca: ${row.brand ?? 'N/D'}. Presentacion: ${row.presentation ?? 'N/D'}. Precio: ${row.price}. Stock: ${row.stock}.`,
        }));
      const index = await this.tools.catalogSearch?.sync({
        tenantId,
        rows,
        sourceRef: live.spreadsheetId,
        range,
        persist: false,
      });
      await this.store.persistCatalogSnapshot?.({ tenantId, products: rows, driveFiles, index });
      const result = {
        status: 'published',
        tenantId,
        reason,
        sourceRef: live.spreadsheetId,
        range,
        catalogVersion: index?.catalogVersion ?? null,
        rowCount: rows.length,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
      };
      this.events?.emit({ type: 'catalog.sync.worker_completed', tenantId, detail: 'Catalog sync worker published a version', metadata: result });
      this.telemetry?.record('catalog', 'worker_sync', { durationMs: performance.now() - startedAt, status: 'ok', tenantId, metadata: result });
      return result;
    } catch (error) {
      const result = { status: 'failed', tenantId, reason, error: error.message, durationMs: Number((performance.now() - startedAt).toFixed(2)) };
      this.events?.emit({ type: 'catalog.sync.worker_failed', tenantId, detail: error.message, metadata: result });
      this.telemetry?.record('catalog', 'worker_sync', { durationMs: performance.now() - startedAt, status: 'error', tenantId, metadata: result });
      return result;
    }
  }

  async syncAll(reason = 'scheduled') {
    const tenants = this.store.listTenants
      ? await this.store.listTenants()
      : this.store.getState().tenants ?? [];
    return Promise.all(tenants.map((tenant) => this.syncTenant(tenant.id, reason)));
  }

  getStatus(tenantId) {
    const state = this.store?.getState?.() ?? {};
    const published = state.catalogIndexStatusByTenant?.[tenantId] ?? null;
    return {
      tenantId,
      mode: this.config.catalogSyncMode ?? 'on_demand',
      scheduled: Boolean(this.timer),
      inProgress: this.locks.has(tenantId),
      lastResult: this.lastResults.get(tenantId) ?? null,
      published,
    };
  }

  start() {
    if (
      this.timer
      || this.config.catalogSyncMode !== 'scheduled'
      || this.config.catalogSyncWorkerEnabled !== true
    ) return;
    const interval = Math.max(Number(this.config.catalogSyncIntervalMs ?? 300_000), 60_000);
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.syncAll('scheduled').catch((error) => {
        this.events?.emit({ type: 'catalog.sync.worker_failed', detail: error.message, metadata: { reason: 'scheduled_batch' } });
      }).finally(() => { this.running = false; });
    }, interval);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.locks.values()]);
  }
}
