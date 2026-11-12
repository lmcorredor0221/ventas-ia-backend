-- PostgreSQL is the operational catalog search engine.  Google Drive/Sheets
-- remains the tenant-managed authoring source and publishes into this
-- projection through the explicit catalog sync flow.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS catalog_search_products (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  catalog_version TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  brand TEXT,
  presentation TEXT,
  normalized_presentation TEXT,
  product_family TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  stock NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  search_text TEXT NOT NULL,
  search_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  search_tsv TSVECTOR NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, catalog_version, sku)
);

CREATE INDEX IF NOT EXISTS catalog_search_products_active_idx
  ON catalog_search_products (tenant_id, catalog_version, name, sku)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS catalog_search_products_tsv_idx
  ON catalog_search_products USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS catalog_search_products_text_trgm_idx
  ON catalog_search_products USING GIN (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS catalog_search_products_tokens_idx
  ON catalog_search_products USING GIN (search_tokens);

CREATE INDEX IF NOT EXISTS catalog_search_products_family_idx
  ON catalog_search_products (tenant_id, catalog_version, product_family, brand, presentation)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS catalog_search_relations (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  catalog_version TEXT NOT NULL,
  product_sku TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  anchor_key TEXT NOT NULL,
  anchor_tokens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, catalog_version, product_sku, relation_type, anchor_key),
  FOREIGN KEY (tenant_id, catalog_version, product_sku)
    REFERENCES catalog_search_products (tenant_id, catalog_version, sku)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS catalog_search_relations_anchor_idx
  ON catalog_search_relations (tenant_id, catalog_version, anchor_key, product_sku);

CREATE INDEX IF NOT EXISTS catalog_search_relations_tokens_idx
  ON catalog_search_relations USING GIN (anchor_tokens);
