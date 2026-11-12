import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PostgresStore } from '../store/postgresStore.js';
import { buildCatalogKnowledgeIndex } from '../services/catalogKnowledgeIndex.js';

const configuredUrl = process.env.POSTGRES_TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? fs.readFileSync('.env.example', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();

if (!configuredUrl) throw new Error('Falta POSTGRES_TEST_DATABASE_URL para la prueba PostgreSQL nativa.');
const connection = new URL(configuredUrl);
assert.ok(['127.0.0.1', 'localhost'].includes(connection.hostname),
  'Esta prueba solo puede ejecutarse contra PostgreSQL local.');
assert.equal(connection.pathname.replace(/^\//, ''), 'ventas_ia_dev',
  'Esta prueba solo puede ejecutarse contra ventas_ia_dev.');

const suffix = Date.now().toString(36);
const tenantId = `catalog-native-${suffix}`;
const store = new PostgresStore({ databaseUrl: configuredUrl, ssl: 'disable', max: 1 });
const products = [
  {
    sku: 'COKE-15-ORIG',
    name: 'Coca-Cola original',
    brand: 'Coca-Cola',
    category: 'gaseosas',
    presentation: '1.5 L',
    normalizedPresentation: '1500 ml',
    productFamily: 'Coca-Cola',
    aliases: ['coca cola litro y medio'],
    attributes: { variante: 'Original' },
    price: 7200,
    stock: 8,
    active: true,
  },
  {
    sku: 'CHOC-65',
    name: 'Ponque Chocorramo 65 g',
    brand: 'Ramo',
    category: 'ponques',
    presentation: '65 g',
    productFamily: 'Chocorramo',
    aliases: ['chocorramo'],
    price: 2800,
    stock: 10,
    active: true,
  },
];

try {
  await store.migrate();
  await store.pool.query(
    `INSERT INTO tenants (id, name, status, plan, whatsapp_number, config, lifecycle, payload)
     VALUES ($1, $2, 'trial', 'test', '', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
    [tenantId, 'Catalog native PostgreSQL smoke'],
  );
  const index = buildCatalogKnowledgeIndex({
    tenantId,
    rows: products,
    sourceRef: 'local-native-test',
    range: 'Catalogo!A1:P10',
  });

  const published = await store.persistCatalogSnapshot({ tenantId, products, driveFiles: [], index });
  assert.equal(published.status, 'published');
  assert.equal(published.nativeProjection.productCount, products.length);

  const metadata = await store.getPublishedCatalogNativeSearchMetadata(tenantId);
  assert.equal(metadata.available, true);
  assert.equal(metadata.projectionRowCount, products.length);

  const direct = await store.searchPublishedCatalogNative(tenantId, {
    query: 'coca cola litro y medio',
    semanticQuery: 'gaseosa coca cola 1.5 litros',
    retrievalHints: { productFamily: 'Coca-Cola', presentation: '1.5 L' },
  });
  assert.equal(direct.available, true);
  assert.equal(direct.retrieval.provider, 'postgres_fts_trgm_relations');
  assert.ok(direct.rows.some((row) => row.sku === 'COKE-15-ORIG'),
    'La recuperación nativa debe encontrar una referencia por texto, alias y atributos suaves.');

  const relation = await store.searchPublishedCatalogNative(tenantId, {
    retrievalHints: { productFamily: 'Chocorramo' },
  });
  assert.ok(relation.rows.some((row) => row.sku === 'CHOC-65'),
    'La recuperación por relaciones debe encontrar la familia sin hidratar el documento JSONB.');

  const page = await store.pagePublishedCatalogNative(tenantId, {
    purpose: 'manual_order_catalog',
    query: 'coca cola',
    limit: 1,
  });
  assert.equal(page.totalCount, 1);
  assert.deepEqual(page.rows.map((row) => row.sku), ['COKE-15-ORIG']);

  console.log('catalog-native-postgres: native FTS, trigrams, relations and pagination passed');
} finally {
  await store.pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]).catch(() => {});
  await store.close();
}
