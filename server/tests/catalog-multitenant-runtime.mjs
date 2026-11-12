import assert from 'node:assert/strict';
import { CatalogSearchService } from '../services/catalogSearchService.js';
import {
  buildCatalogKnowledgeIndex,
  CATALOG_GRAPH_SCHEMA_VERSION,
  compactCatalogKnowledgeIndex,
} from '../services/catalogKnowledgeIndex.js';

function catalogRows(prefix, total = 48) {
  return Array.from({ length: total }, (_, index) => ({
    sku: `${prefix}-${index + 1}`,
    name: index < 4 ? (index % 2 ? 'Coca-Cola original' : 'Coca-Cola sin azúcar') : `Producto ${index + 1}`,
    brand: index < 4 ? 'Coca-Cola' : 'Marca',
    category: index < 4 ? 'gaseosas' : 'despensa',
    presentation: index < 4 ? `${index + 1}00 ml` : 'unidad',
    normalizedPresentation: index < 4 ? `${index + 1}00 ml` : 'unidad',
    productFamily: index < 4 ? 'Coca-Cola' : `Familia ${index + 1}`,
    price: 2000 + index,
    stock: 10,
    active: true,
  }));
}

const events = [];
const search = new CatalogSearchService({
  maxCachedTenants: 2,
  telemetry: { record: (...args) => events.push(args) },
});

const tenantA = buildCatalogKnowledgeIndex({ tenantId: 'tenant-a', rows: catalogRows('A') });
const tenantB = buildCatalogKnowledgeIndex({ tenantId: 'tenant-b', rows: catalogRows('B') });
const tenantC = buildCatalogKnowledgeIndex({ tenantId: 'tenant-c', rows: catalogRows('C') });

assert.equal(tenantA.graphSchemaVersion, CATALOG_GRAPH_SCHEMA_VERSION);
assert.ok(tenantA.relationCount < tenantA.rowCount * 8, 'El grafo persistido debe crecer linealmente, no por pares de alternativas.');

const [legacySource, legacyTarget] = tenantA.nodes.filter((node) => node.type === 'product');
const legacyIndex = {
  ...tenantA,
  graphSchemaVersion: 1,
  relations: [
    ...tenantA.relations,
    { key: 'legacy-alternative', type: 'PRODUCT_ALTERNATIVE_OF', from: legacySource.id, to: legacyTarget.id },
  ],
  relationCount: tenantA.relationCount + 1,
};
const compactLegacy = compactCatalogKnowledgeIndex(legacyIndex);
assert.equal(compactLegacy.graphSchemaVersion, CATALOG_GRAPH_SCHEMA_VERSION);
assert.equal(compactLegacy.compactedFromGraphSchemaVersion, 1);
assert.equal(compactLegacy.relations.some((relation) => relation.type === 'PRODUCT_ALTERNATIVE_OF'), false);
assert.equal(compactCatalogKnowledgeIndex(compactLegacy), compactLegacy, 'Un snapshot ya compacto no debe duplicar memoria.');

const migratedSnapshots = [];
const migrationState = {};
const migrationSearch = new CatalogSearchService({
  store: {
    mutate: (fn) => fn(migrationState),
    persistCatalogKnowledgeIndex: async (index) => migratedSnapshots.push(index),
  },
});
migrationSearch.hydrate(legacyIndex);
const migratedIndex = await migrationSearch.sync({ tenantId: 'tenant-a', rows: catalogRows('A') });
assert.equal(migratedSnapshots.length, 1, 'Una sincronización explícita debe persistir la conversión del snapshot legado.');
assert.equal(migratedIndex.compactedFromGraphSchemaVersion, undefined);
assert.equal(migratedIndex.graphSchemaVersion, CATALOG_GRAPH_SCHEMA_VERSION);

search.hydrate(tenantA);
search.hydrate(tenantB);
// Touch A so B is the least-recently-used snapshot.
assert.equal(search.getIndex('tenant-a')?.catalogVersion, tenantA.catalogVersion);
search.hydrate(tenantC);
assert.equal(search.getIndex('tenant-b'), null, 'La memoria de un tenant inactivo debe liberarse al superar el límite.');
assert.equal(search.getIndex('tenant-a')?.catalogVersion, tenantA.catalogVersion);
assert.equal(search.getIndex('tenant-c')?.catalogVersion, tenantC.catalogVersion);
assert.ok(events.some(([, operation, sample]) => operation === 'index_cache' && sample.metadata.operation === 'eviction'));

const memoryBoundedSearch = new CatalogSearchService({ maxCachedTenants: 3, maxCachedBytes: 1 });
memoryBoundedSearch.hydrate(tenantA);
memoryBoundedSearch.hydrate(tenantB);
assert.equal(memoryBoundedSearch.getIndex('tenant-a'), null, 'El presupuesto de memoria debe prevalecer aunque aún queden cupos de tenants.');
assert.equal(memoryBoundedSearch.getIndex('tenant-b')?.catalogVersion, tenantB.catalogVersion);

const result = search.search('tenant-a', { query: 'coca cola', limit: 10 });
assert.ok(result.rows.length > 0);
assert.ok(result.retrieval.directScannedCount < tenantA.rowCount, 'El índice léxico debe reducir el conjunto que se puntúa por consulta.');
assert.equal(result.retrieval.graphSchemaVersion, CATALOG_GRAPH_SCHEMA_VERSION);

console.log('catalog-multitenant-runtime: compact graph and bounded tenant cache passed');
