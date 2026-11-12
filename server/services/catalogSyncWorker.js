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
    if (!tenant) return { status: 'not_found', tenantId, reason, message: 'La tienda no existe en producción.' };

    try {
      const live = await this.tools.liveGoogleContext(tenantId);
      if (!live) {
        const result = {
          status: 'skipped',
          code: 'google_unavailable',
          tenantId,
          reason,
          message: 'No se pudo acceder al Google Sheets de esta tienda. Reconecta Google y vuelve a intentar.',
        };
        this.events?.emit({ type: 'catalog.sync.skipped', tenantId, detail: 'Catalog sync skipped: Google unavailable', metadata: result });
        return result;
      }
      const range = effectiveCatalogRange(tenant);
      const rows = await this.tools.readLiveCatalogRows({ tenantId, tenant, live, range, persist: false });
      if (!rows.length) {
        const result = {
          status: 'skipped',
          code: 'empty_catalog',
          tenantId,
          reason,
          range,
          message: `La pestaña Catalogo no contiene referencias válidas en ${range}.`,
        };
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
      if (!index?.catalogVersion) {
        throw Object.assign(new Error('No se pudo construir una versión del índice del catálogo.'), {
          code: 'catalog_index_not_built',
        });
      }
      const persisted = this.store.persistCatalogSnapshot
        ? await this.store.persistCatalogSnapshot({ tenantId, products: rows, driveFiles, index })
        : { status: 'published' };
      if (!['published', 'unchanged'].includes(persisted?.status)) {
        throw Object.assign(new Error('La versión del catálogo no pudo publicarse en PostgreSQL.'), {
          code: 'catalog_snapshot_not_published',
          details: persisted,
        });
      }
      // A successful publication is the handoff from the tenant-owned Google
      // sheet to the operational PostgreSQL catalog. Persist it on the
      // tenant so legacy configurations cannot silently keep live Drive reads
      // in the WhatsApp request path.
      this.store.mutate?.((state) => {
        const current = state.tenants?.find((item) => item.id === tenantId);
        if (!current) return;
        current.config ??= {};
        current.config.catalog = { ...(current.config.catalog ?? {}), readSource: 'postgres' };
      }, { snapshot: false, domain: 'tenant_catalog', operation: 'publish_postgres_source' });
      await this.store.persistTenantCritical?.(tenantId);
      const result = {
        status: 'published',
        tenantId,
        reason,
        sourceRef: live.spreadsheetId,
        range,
        catalogVersion: index?.catalogVersion ?? null,
        rowCount: rows.length,
        operationalSource: 'postgres',
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

  async getStatus(tenantId) {
    const state = this.store?.getState?.() ?? {};
    let published = state.catalogIndexStatusByTenant?.[tenantId] ?? null;
    if (!published && this.store?.getPublishedCatalogKnowledgeIndex) {
      const index = await this.store.getPublishedCatalogKnowledgeIndex(tenantId);
      if (index?.catalogVersion) {
        published = {
          status: index.status ?? 'published',
          catalogVersion: index.catalogVersion,
          sourceHash: index.sourceHash ?? null,
          rowCount: index.rowCount ?? 0,
          nodeCount: index.nodeCount ?? 0,
          relationCount: index.relationCount ?? 0,
          vectorCount: index.vectorCount ?? 0,
          syncedAt: index.syncedAt ?? index.publishedAt ?? null,
        };
      }
    }
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
