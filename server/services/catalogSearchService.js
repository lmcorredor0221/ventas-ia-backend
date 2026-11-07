import { buildCatalogKnowledgeIndex, searchCatalogKnowledgeIndex } from './catalogKnowledgeIndex.js';

export class CatalogSearchService {
  constructor({ store, events, telemetry } = {}) {
    this.store = store;
    this.events = events;
    this.telemetry = telemetry;
    this.indexes = new Map();
  }

  getIndex(tenantId) {
    return this.indexes.get(tenantId) ?? this.store?.getState?.().catalogKnowledgeIndexesByTenant?.[tenantId] ?? null;
  }

  async sync({ tenantId, rows, sourceRef, range }) {
    const startedAt = performance.now();
    const previous = this.getIndex(tenantId);
    this.events?.emit({ type: 'catalog.sync.started', tenantId, detail: 'Catalog knowledge index sync started', metadata: { previousVersion: previous?.catalogVersion ?? null, sourceRef, range } });
    const index = buildCatalogKnowledgeIndex({ tenantId, rows, sourceRef, range, previousVersion: previous?.catalogVersion ?? null });
    if (previous?.sourceHash === index.sourceHash) {
      this.events?.emit({ type: 'catalog.sync.published', tenantId, detail: 'Catalog knowledge index unchanged', metadata: { catalogVersion: previous.catalogVersion, rowCount: previous.rowCount, unchanged: true } });
      return previous;
    }
    this.indexes.set(tenantId, index);
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
        syncedAt: index.syncedAt,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
      };
    });
    await this.store?.persistCatalogKnowledgeIndex?.(index);
    this.events?.emit({ type: 'catalog.sync.source_read', tenantId, detail: 'Catalog source normalized', metadata: { catalogVersion: index.catalogVersion, rowCount: index.rowCount } });
    this.events?.emit({ type: 'catalog.sync.normalized', tenantId, detail: 'Catalog nodes normalized', metadata: { catalogVersion: index.catalogVersion, nodeCount: index.nodeCount } });
    this.events?.emit({ type: 'catalog.sync.graph_updated', tenantId, detail: 'Catalog relations updated', metadata: { catalogVersion: index.catalogVersion, relationCount: index.relationCount } });
    this.events?.emit({ type: 'catalog.sync.vector_index_updated', tenantId, detail: 'Catalog search vectors updated', metadata: { catalogVersion: index.catalogVersion, vectorCount: index.vectorCount, provider: index.vectorProvider } });
    this.events?.emit({ type: 'catalog.sync.published', tenantId, detail: 'Catalog knowledge index published', metadata: { catalogVersion: index.catalogVersion, previousVersion: previous?.catalogVersion ?? null, durationMs: Number((performance.now() - startedAt).toFixed(2)) } });
    this.telemetry?.record('catalog', 'sync', { durationMs: performance.now() - startedAt, status: 'ok', tenantId, metadata: { catalogVersion: index.catalogVersion, rowCount: index.rowCount, nodeCount: index.nodeCount, relationCount: index.relationCount, vectorCount: index.vectorCount, previousVersion: previous?.catalogVersion ?? null } });
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
        candidateCount: result.rows.length,
        directCandidateCount: result.retrieval?.directCandidateCount ?? 0,
        graphCandidateCount: result.retrieval?.graphCandidateCount ?? 0,
        semanticCandidateCount: result.retrieval?.semanticCandidateCount ?? 0,
        recommendation: result.retrieval?.recommendation ?? false,
        diversityApplied: result.retrieval?.diversityApplied ?? false,
        graphPathCount: result.retrieval?.graphPaths?.length ?? 0,
      },
    });
    return result;
  }
}
