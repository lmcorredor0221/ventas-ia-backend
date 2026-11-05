export function mergeCatalogProducts(products = []) {
  const bySku = new Map();
  for (const product of products) {
    if (!product?.sku) continue;
    bySku.set(product.sku, structuredClone(product));
  }
  return [...bySku.values()];
}

export async function resetScenarioCatalog(store, shadow, extraProducts = []) {
  const catalog = mergeCatalogProducts([...shadow.baseCatalog, ...extraProducts]);
  // The tenant and the database already belong to this run's disposable clone.
  // Replacing its catalog before each scenario prevents products introduced for
  // one case from changing another case's candidate set.
  // Drain the previous snapshot BEFORE deleting. Mutating first starts a new
  // asynchronous upsert transaction that can deadlock with this DELETE.
  await store.flush();
  await store.pool.query('DELETE FROM products WHERE tenant_id = $1', [shadow.tenantId]);
  store.mutate((state) => {
    state.productsByTenant ??= {};
    state.productsByTenant[shadow.tenantId] = structuredClone(catalog);
  });
  await store.flush();
  const persisted = await store.listProducts(shadow.tenantId);
  if (persisted.length !== catalog.length) {
    throw new Error(`El catalogo aislado E2E no se pudo restaurar: esperado=${catalog.length}, persistido=${persisted.length}.`);
  }
}
