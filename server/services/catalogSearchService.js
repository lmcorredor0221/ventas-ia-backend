import {
  buildCatalogKnowledgeIndex,
  CATALOG_GRAPH_SCHEMA_VERSION,
  compactCatalogKnowledgeIndex,
  prepareCatalogKnowledgeRuntime,
  productMatchesFilters,
  searchCatalogKnowledgeIndex,
} from './catalogKnowledgeIndex.js';

export class CatalogSearchService {
  constructor({ store, events, telemetry, maxCachedTenants = 2, maxCachedBytes = 64 * 1024 * 1024 } = {}) {
    this.store = store;
    this.events = events;
    this.telemetry = telemetry;
    this.indexes = new Map();
    this.loadPromises = new Map();
    this.maxCachedTenants = Math.min(16, Math.max(1, Number(maxCachedTenants) || 2));
    this.maxCachedBytes = Math.max(1, Number(maxCachedBytes) || (64 * 1024 * 1024));
    this.cachedBytesByTenant = new Map();
    this.indexByteEstimates = new WeakMap();
    this.cachedBytes = 0;
  }

  getIndex(tenantId) {
    const inMemory = this.indexes.get(tenantId);
    if (inMemory) {
      this.touch(tenantId, inMemory);
      return inMemory;
    }
    // JsonStore has no catalog-index repository, so its persisted state is the
    // local published source. Postgres deliberately does not fall back to the
    // app-state projection here: doing so would defeat the bounded LRU cache.
    if (!this.store?.getPublishedCatalogKnowledgeIndex) {
      const persisted = this.store?.getState?.().catalogKnowledgeIndexesByTenant?.[tenantId] ?? null;
      return persisted ? this.hydrate(persisted) : null;
    }
    return null;
  }

  hydrate(index) {
    if (!index?.tenantId || !index?.products) return null;
    const compactIndex = compactCatalogKnowledgeIndex(index);
    if (compactIndex !== index) {
      this.telemetry?.record('catalog', 'legacy_graph_compacted', {
        durationMs: 0,
        status: 'ok',
        tenantId: compactIndex.tenantId,
        metadata: {
          catalogVersion: compactIndex.catalogVersion,
          previousGraphSchemaVersion: index.graphSchemaVersion ?? 1,
          previousRelationCount: index.relationCount ?? index.relations?.length ?? 0,
          relationCount: compactIndex.relationCount,
        },
      });
    }
    prepareCatalogKnowledgeRuntime(compactIndex);
    this.touch(compactIndex.tenantId, compactIndex);
    return compactIndex;
  }

  /**
   * Loads the published immutable index once per tenant/version. Metadata is
   * deliberately queried without `document`, so routine reads can detect a
   * new publication without repeatedly transporting a multi-megabyte JSONB.
   */
  async loadPublishedIndex(tenantId) {
    const startedAt = performance.now();
    const metadata = await this.store?.getPublishedCatalogKnowledgeIndexMetadata?.(tenantId);
    const cached = this.getIndex(tenantId);
    if (cached && (!metadata || cached.catalogVersion === metadata.catalogVersion)) {
      this.recordCache('hit', tenantId, startedAt, { catalogVersion: cached.catalogVersion, documentBytes: 0 });
      return { index: cached, metadata: metadata ?? indexMetadata(cached), cacheHit: true, cacheLoadWait: false };
    }

    // JsonStore/test stores do not have a metadata query. Their in-memory
    // state is already the published snapshot and must not be fetched again.
    if (cached && !this.store?.getPublishedCatalogKnowledgeIndexMetadata) {
      this.recordCache('hit', tenantId, startedAt, { catalogVersion: cached.catalogVersion, documentBytes: 0 });
      return { index: cached, metadata: indexMetadata(cached), cacheHit: true, cacheLoadWait: false };
    }

    const version = metadata?.catalogVersion ?? 'unknown';
    const key = `${tenantId}:${version}`;
    const pending = this.loadPromises.get(key);
    if (pending) {
      const index = await pending;
      this.recordCache('load_wait', tenantId, startedAt, { catalogVersion: index?.catalogVersion ?? version, documentBytes: 0 });
      return { index, metadata: metadata ?? indexMetadata(index), cacheHit: true, cacheLoadWait: true };
    }

    const load = (async () => {
      const publishedIndex = await this.store?.getPublishedCatalogKnowledgeIndex?.(tenantId);
      return publishedIndex?.tenantId && publishedIndex?.products
        ? this.hydrate(publishedIndex)
        : null;
    })();
    this.loadPromises.set(key, load);
    try {
      const index = await load;
      this.recordCache('miss', tenantId, startedAt, {
        catalogVersion: index?.catalogVersion ?? version,
        documentBytes: index ? jsonBytes(index) : 0,
        graphSchemaVersion: index?.graphSchemaVersion ?? null,
        legacyGraphCompacted: Boolean(index?.compactedFromGraphSchemaVersion),
      });
      return { index, metadata: metadata ?? indexMetadata(index), cacheHit: false, cacheLoadWait: false };
    } finally {
      this.loadPromises.delete(key);
    }
  }

  page(tenantId, { query = '', semanticQuery = '', filters = {}, cursor = null, limit = 25, productFilter = null } = {}) {
    const index = this.getIndex(tenantId);
    if (!index?.products) return emptyPage();
    const size = clampPageLimit(limit);
    const normalizedQuery = String(query ?? '').trim();
    const hasSearch = Boolean(normalizedQuery || String(semanticQuery ?? '').trim());
    // Browsing the manual catalog must not run graph retrieval over every
    // product. It uses the same published snapshot, simply paged and sorted.
    const retrieved = hasSearch
      ? searchCatalogKnowledgeIndex(index, {
        query: normalizedQuery,
        semanticQuery,
        filters,
        limit: Math.max(index.rowCount ?? Object.keys(index.products).length, 1),
        includeRelations: false,
      })
      : null;
    const candidates = (retrieved?.rows ?? Object.values(index.products).filter((product) => productMatchesFilters(product, filters)))
      .filter((product) => !productFilter || productFilter(product))
      .sort((left, right) => {
        if (normalizedQuery) {
          const scoreDelta = Number(right.matchScore ?? 0) - Number(left.matchScore ?? 0);
          if (scoreDelta) return scoreDelta;
        }
        return String(left.name ?? '').localeCompare(String(right.name ?? ''), 'es')
          || String(left.sku ?? '').localeCompare(String(right.sku ?? ''));
      });
    const offset = decodeCursor(cursor, index.catalogVersion);
    const rows = candidates.slice(offset, offset + size);
    const nextOffset = offset + rows.length;
    return {
      catalogVersion: index.catalogVersion,
      totalCount: candidates.length,
      returnedCount: rows.length,
      nextCursor: nextOffset < candidates.length ? encodeCursor(index.catalogVersion, nextOffset) : null,
      rows,
      retrieval: hasSearch ? retrieved.retrieval : null,
    };
  }

  invalidate(tenantId) {
    this.cachedBytes -= this.cachedBytesByTenant.get(tenantId) ?? 0;
    this.cachedBytesByTenant.delete(tenantId);
    this.indexes.delete(tenantId);
  }

  touch(tenantId, index) {
    const previousBytes = this.cachedBytesByTenant.get(tenantId) ?? 0;
    this.cachedBytes = Math.max(0, this.cachedBytes - previousBytes);
    this.cachedBytesByTenant.delete(tenantId);
    this.indexes.delete(tenantId);
    const estimatedBytes = this.estimatedResidentBytes(index);
    this.indexes.set(tenantId, index);
    this.cachedBytesByTenant.set(tenantId, estimatedBytes);
    this.cachedBytes += estimatedBytes;
    while (this.indexes.size > this.maxCachedTenants || (this.cachedBytes > this.maxCachedBytes && this.indexes.size > 1)) {
      const evictedTenantId = this.indexes.keys().next().value;
      const evicted = this.indexes.get(evictedTenantId);
      const evictedBytes = this.cachedBytesByTenant.get(evictedTenantId) ?? 0;
      this.indexes.delete(evictedTenantId);
      this.cachedBytesByTenant.delete(evictedTenantId);
      this.cachedBytes = Math.max(0, this.cachedBytes - evictedBytes);
      this.telemetry?.record('catalog', 'index_cache', {
        durationMs: 0,
        status: 'ok',
        tenantId: evictedTenantId,
        metadata: {
          operation: 'eviction',
          catalogVersion: evicted?.catalogVersion ?? null,
          rowCount: evicted?.rowCount ?? null,
          graphSchemaVersion: evicted?.graphSchemaVersion ?? 1,
          maxCachedTenants: this.maxCachedTenants,
          maxCachedBytes: this.maxCachedBytes,
          evictedEstimatedBytes: evictedBytes,
          cacheEstimatedBytes: this.cachedBytes,
          reason: this.indexes.size >= this.maxCachedTenants ? 'tenant_limit' : 'memory_budget',
        },
      });
    }
  }

  estimatedResidentBytes(index) {
    const cached = this.indexByteEstimates.get(index);
    if (cached) return cached;
    // The immutable snapshot is retained together with maps/sets used for
    // retrieval. This deliberately overestimates a little, so cache eviction
    // protects other tenants instead of gambling with the Node heap.
    const estimate = Math.max(1, Math.ceil(jsonBytes(index) * 2.5));
    this.indexByteEstimates.set(index, estimate);
    return estimate;
  }

  recordCache(operation, tenantId, startedAt, metadata = {}) {
    this.telemetry?.record('catalog', 'index_cache', {
      durationMs: performance.now() - startedAt,
      status: 'ok', tenantId,
      metadata: { operation, ...metadata },
    });
  }

  async sync({ tenantId, rows, sourceRef, range, persist = true }) {
    const startedAt = performance.now();
    const previous = this.getIndex(tenantId);
    this.events?.emit({ type: 'catalog.sync.started', tenantId, detail: 'Catalog knowledge index sync started', metadata: { previousVersion: previous?.catalogVersion ?? null, sourceRef, range } });
    const index = buildCatalogKnowledgeIndex({ tenantId, rows, sourceRef, range, previousVersion: previous?.catalogVersion ?? null });
    if (previous?.sourceHash === index.sourceHash
      && previous?.graphSchemaVersion === CATALOG_GRAPH_SCHEMA_VERSION
      && !previous?.compactedFromGraphSchemaVersion) {
      this.events?.emit({ type: 'catalog.sync.published', tenantId, detail: 'Catalog knowledge index unchanged', metadata: { catalogVersion: previous.catalogVersion, rowCount: previous.rowCount, unchanged: true } });
      return previous;
    }
    this.touch(tenantId, index);
    this.store?.mutate?.((state) => {
      state.catalogKnowledgeIndexesByTenant ??= {};
      state.catalogKnowledgeIndexesByTenant[tenantId] = index;
      state.catalogIndexStatusByTenant ??= {};
      state.catalogIndexStatusByTenant[tenantId] = {
        status: 'published',
        catalogVersion: index.catalogVersion,
        sourceHash: index.sourceHash,
        rowCount: index.rowCount,
        nodeCount: index.nodeCount,
        relationCount: index.relationCount,
        vectorCount: index.vectorCount,
        graphSchemaVersion: index.graphSchemaVersion,
        syncedAt: index.syncedAt,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
      };
    });
    if (persist) await this.store?.persistCatalogKnowledgeIndex?.(index);
    this.events?.emit({ type: 'catalog.sync.source_read', tenantId, detail: 'Catalog source normalized', metadata: { catalogVersion: index.catalogVersion, rowCount: index.rowCount } });
    this.events?.emit({ type: 'catalog.sync.normalized', tenantId, detail: 'Catalog nodes normalized', metadata: { catalogVersion: index.catalogVersion, nodeCount: index.nodeCount } });
    this.events?.emit({ type: 'catalog.sync.graph_updated', tenantId, detail: 'Catalog relations updated', metadata: { catalogVersion: index.catalogVersion, relationCount: index.relationCount } });
    this.events?.emit({ type: 'catalog.sync.vector_index_updated', tenantId, detail: 'Catalog search vectors updated', metadata: { catalogVersion: index.catalogVersion, vectorCount: index.vectorCount, provider: index.vectorProvider } });
    this.events?.emit({ type: 'catalog.sync.published', tenantId, detail: 'Catalog knowledge index published', metadata: { catalogVersion: index.catalogVersion, previousVersion: previous?.catalogVersion ?? null, durationMs: Number((performance.now() - startedAt).toFixed(2)) } });
    this.telemetry?.record('catalog', 'sync', { durationMs: performance.now() - startedAt, status: 'ok', tenantId, metadata: { catalogVersion: index.catalogVersion, rowCount: index.rowCount, nodeCount: index.nodeCount, relationCount: index.relationCount, vectorCount: index.vectorCount, graphSchemaVersion: index.graphSchemaVersion, previousVersion: previous?.catalogVersion ?? null } });
    return index;
  }

  search(tenantId, payload = {}) {
    const startedAt = performance.now();
    const result = searchCatalogKnowledgeIndex(this.getIndex(tenantId), payload);
    this.telemetry?.record('catalog', 'search', {
      durationMs: performance.now() - startedAt,
      status: 'ok',
      tenantId,
      metadata: {
        catalogVersion: result.catalogVersion,
        query: payload.query ?? '',
        semanticQuery: payload.semanticQuery ?? '',
        filterKeys: Object.keys(payload.filters ?? {}).sort(),
        retrievalHintKeys: Object.keys(payload.retrievalHints ?? {}).filter((key) => payload.retrievalHints[key] !== undefined && payload.retrievalHints[key] !== null && payload.retrievalHints[key] !== '').sort(),
        candidateCount: result.rows.length,
        directCandidateCount: result.retrieval?.directCandidateCount ?? 0,
        graphCandidateCount: result.retrieval?.graphCandidateCount ?? 0,
        semanticCandidateCount: result.retrieval?.semanticCandidateCount ?? 0,
        recommendation: result.retrieval?.recommendation ?? false,
        diversityApplied: result.retrieval?.diversityApplied ?? false,
        graphPathCount: result.retrieval?.graphPaths?.length ?? 0,
        directScannedCount: result.retrieval?.directScannedCount ?? 0,
        compatibleProductCount: result.retrieval?.compatibleProductCount ?? 0,
        graphSchemaVersion: result.retrieval?.graphSchemaVersion ?? 1,
        runtimePreparationMs: result.retrieval?.runtimePreparationMs ?? 0,
        maxCachedTenants: this.maxCachedTenants,
        maxCachedBytes: this.maxCachedBytes,
        cacheEstimatedBytes: this.cachedBytes,
      },
    });
    return result;
  }
}

function indexMetadata(index) {
  if (!index?.catalogVersion) return null;
  return {
    tenantId: index.tenantId,
    catalogVersion: index.catalogVersion,
    sourceHash: index.sourceHash ?? null,
    rowCount: index.rowCount ?? Object.keys(index.products ?? {}).length,
    graphSchemaVersion: index.graphSchemaVersion ?? 1,
    publishedAt: index.syncedAt ?? null,
  };
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function clampPageLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

function encodeCursor(catalogVersion, offset) {
  return Buffer.from(JSON.stringify({ catalogVersion, offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor, catalogVersion) {
  if (!cursor) return 0;
  let parsed;
  try { parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8')); }
  catch { throw Object.assign(new Error('El cursor del catálogo no es válido.'), { code: 'catalog_cursor_invalid', statusCode: 400 }); }
  if (parsed?.catalogVersion !== catalogVersion) {
    throw Object.assign(new Error('El catálogo cambió. Actualiza la lista antes de continuar.'), { code: 'catalog_cursor_stale', statusCode: 409 });
  }
  const offset = Number(parsed?.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error('El cursor del catálogo no es válido.'), { code: 'catalog_cursor_invalid', statusCode: 400 });
  }
  return offset;
}

function emptyPage() {
  return { catalogVersion: null, totalCount: 0, returnedCount: 0, nextCursor: null, rows: [], retrieval: null };
}
