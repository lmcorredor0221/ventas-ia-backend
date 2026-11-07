CREATE TABLE IF NOT EXISTS catalog_knowledge_indexes (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  catalog_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_ref TEXT,
  source_range TEXT,
  status TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  relation_count INTEGER NOT NULL DEFAULT 0,
  vector_count INTEGER NOT NULL DEFAULT 0,
  vector_provider TEXT,
  document JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, catalog_version)
);

CREATE INDEX IF NOT EXISTS catalog_knowledge_indexes_published_idx
  ON catalog_knowledge_indexes (tenant_id, published_at DESC)
  WHERE status = 'published';
