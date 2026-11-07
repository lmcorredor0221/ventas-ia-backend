import { DEFAULT_CATALOG_RANGE } from './catalogMetadata.js';

export const CATALOG_READ_SOURCES = Object.freeze({
  google: 'google',
  postgres: 'postgres',
  shadow: 'shadow',
});

/**
 * `catalogRange` is the tenant-owned setting. `range` is retained only as a
 * migration fallback for old tenants; runtime callers must not override it
 * with the legacy value.
 */
export function effectiveCatalogRange(tenant) {
  return tenant?.config?.googleSheets?.catalogRange
    ?? tenant?.config?.googleSheets?.range
    ?? DEFAULT_CATALOG_RANGE;
}
export function catalogReadSource(config = {}, tenant = null) {
  const source = String(
    tenant?.config?.catalog?.readSource
      ?? tenant?.config?.catalogReadSource
      ?? config.catalogReadSource
      ?? CATALOG_READ_SOURCES.google,
  ).trim().toLowerCase();
  return Object.values(CATALOG_READ_SOURCES).includes(source)
    ? source
    : CATALOG_READ_SOURCES.google;
}
