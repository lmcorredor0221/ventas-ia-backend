import crypto from 'node:crypto';
import { attributesSearchText, matchesCatalogAttributes } from '../domain/catalogMetadata.js';
import {
  CATALOG_NODE_TYPES,
  CATALOG_RELATION_TYPES,
  addRelation,
  nodeKey,
  normalizeKey,
} from '../domain/catalogRelations.js';

const VECTOR_DIMENSIONS = 96;
// Snapshot v2 keeps the graph compact. Product alternatives are derivable
// from their family/brand/presentation relations and therefore must not be
// materialized as an O(n²) relation for every family.
export const CATALOG_GRAPH_SCHEMA_VERSION = 2;

// Runtime lookup structures are deliberately not serialized to PostgreSQL.
// A published snapshot remains portable JSON; each Node process prepares these
// maps once per tenant/version and releases them when the bounded tenant cache
// evicts the corresponding snapshot.
const runtimeByIndex = new WeakMap();

/**
 * Builds a tenant-local, immutable catalog snapshot.
 *
 * The vector is a small deterministic lexical fingerprint, not an LLM
 * embedding. It gives the search layer a cheap semantic-ish signal while the
 * LLM remains responsible for interpreting colloquial language. An embedding
 * provider can replace this field later without changing the graph contract.
 */
export function buildCatalogKnowledgeIndex({ tenantId, rows = [], sourceRef = null, range = null, previousVersion = null }) {
  const products = rows
    .filter((row) => row?.sku && row?.name && row.active !== false)
    .map(normalizeProduct)
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  const sourceHash = hash(stableStringify({ sourceRef, range, products }));
  const catalogVersion = sourceHash.slice(0, 20);
  const nodes = [];
  const nodeIds = new Set();
  const relations = [];
  const relationKeys = new Set();
  const productsBySku = {};

  const addNode = (type, value, payload = {}) => {
    const id = nodeKey(type, value);
    if (!id || nodeIds.has(id)) return id;
    nodeIds.add(id);
    nodes.push({ id, type, key: normalizeKey(value), payload });
    return id;
  };

  const tenantNode = addNode(CATALOG_NODE_TYPES.tenant, tenantId, { tenantId });
  for (const product of products) {
    const productNode = addNode(CATALOG_NODE_TYPES.product, product.sku, product);
    const family = product.productFamily || deriveFamily(product);
    const familyNode = addNode(CATALOG_NODE_TYPES.family, family, { name: family, inferred: !product.productFamily });
    const brandNode = product.brand ? addNode(CATALOG_NODE_TYPES.brand, product.brand, { name: product.brand }) : null;
    const categoryNode = product.category ? addNode(CATALOG_NODE_TYPES.category, product.category, { name: product.category }) : null;
    const presentationNode = product.presentation
      ? addNode(CATALOG_NODE_TYPES.presentation, `${family}:${product.presentation}`, { value: product.presentation, family })
      : null;
    addRelation(relations, CATALOG_RELATION_TYPES.relatedTo, tenantNode, productNode, { scope: 'tenant' }, relationKeys);
    addRelation(relations, CATALOG_RELATION_TYPES.belongsToFamily, productNode, familyNode, {}, relationKeys);
    if (brandNode) addRelation(relations, CATALOG_RELATION_TYPES.sameBrand, productNode, brandNode, {}, relationKeys);
    if (categoryNode) addRelation(relations, CATALOG_RELATION_TYPES.relatedTo, productNode, categoryNode, {}, relationKeys);
    if (presentationNode) addRelation(relations, CATALOG_RELATION_TYPES.hasPresentation, productNode, presentationNode, {}, relationKeys);
    for (const [key, value] of Object.entries(product.attributes ?? {})) {
      if (key === 'commerce' && value && typeof value === 'object' && !Array.isArray(value)) {
        const modeLabels = { unit: 'unidad', units: 'unidad', unidad: 'unidad', unidades: 'unidad', weight: 'peso', peso: 'peso', amount: 'presupuesto', presupuesto: 'presupuesto', valor: 'presupuesto' };
        for (const mode of Array.isArray(value.saleModes) ? value.saleModes : []) {
          const label = modeLabels[String(mode).trim().toLowerCase()];
          if (!label) continue;
          const attributeNode = addNode(CATALOG_NODE_TYPES.attribute, `modalidad_venta:${label}`, { key: 'modalidad_venta', value: label });
          addRelation(relations, CATALOG_RELATION_TYPES.hasAttribute, productNode, attributeNode, {}, relationKeys);
        }
        const configuredModeKeys = new Set((Array.isArray(value.saleModes) ? value.saleModes : [])
          .map((mode) => String(mode).trim().toLowerCase()));
        if (product.allowsSaleByAmount === true && !['amount', 'presupuesto', 'valor'].some((mode) => configuredModeKeys.has(mode))) {
          const attributeNode = addNode(CATALOG_NODE_TYPES.attribute, 'modalidad_venta:presupuesto', { key: 'modalidad_venta', value: 'presupuesto' });
          addRelation(relations, CATALOG_RELATION_TYPES.hasAttribute, productNode, attributeNode, {}, relationKeys);
        }
        continue;
      }
      const attributeNode = addNode(CATALOG_NODE_TYPES.attribute, `${key}:${value}`, { key, value });
      addRelation(relations, CATALOG_RELATION_TYPES.hasAttribute, productNode, attributeNode, {}, relationKeys);
      const normalizedKey = normalizeKey(key);
      if (normalizedKey.includes('sabor') || normalizedKey.includes('flavor')) {
        addRelation(relations, CATALOG_RELATION_TYPES.hasFlavor, productNode, attributeNode, {}, relationKeys);
      }
      if (normalizedKey.includes('variante') || normalizedKey.includes('tipo')) {
        addRelation(relations, CATALOG_RELATION_TYPES.hasVariant, productNode, attributeNode, {}, relationKeys);
      }
    }
    productsBySku[product.sku] = { ...product, family, nodeId: productNode };
  }

  const searchDocuments = products.map((product) => {
    const text = productSearchText(product);
    return {
      id: nodeKey(CATALOG_NODE_TYPES.product, product.sku),
      sku: product.sku,
      catalogVersion,
      text,
      tokens: tokenize(text),
      // Computed during explicit catalog sync, never during the customer's
      // message path. Keeping this compact fingerprint avoids a cold tenant
      // spending CPU hashing every product before its first reply.
      vector: hashedVector(text),
    };
  });

  return {
    tenantId,
    graphSchemaVersion: CATALOG_GRAPH_SCHEMA_VERSION,
    alternativeStrategy: 'family_compatible_runtime',
    catalogVersion,
    sourceHash,
    sourceRef,
    range,
    previousVersion,
    status: 'published',
    syncedAt: new Date().toISOString(),
    rowCount: products.length,
    nodeCount: nodes.length,
    relationCount: relations.length,
    vectorCount: searchDocuments.length,
    nodes,
    relations,
    products: productsBySku,
    searchDocuments,
    vectorProvider: 'deterministic_lexical_fingerprint',
  };
}

/**
 * Converts a legacy snapshot into the compact graph representation in memory.
 *
 * Catalog snapshots published before schema v2 materialized every compatible
 * alternative as a relation. Loading one of those documents must not make a
 * tenant pay the old memory/CPU cost until its owner explicitly synchronizes
 * the catalog again. The source document remains untouched here; `sync()` is
 * still the only path that persists the compact v2 snapshot.
 */
export function compactCatalogKnowledgeIndex(index) {
  if (!index?.products || Number(index.graphSchemaVersion ?? 1) >= CATALOG_GRAPH_SCHEMA_VERSION) return index;
  const relations = (index.relations ?? []).filter((relation) => relation.type !== CATALOG_RELATION_TYPES.alternativeOf);
  return {
    ...index,
    graphSchemaVersion: CATALOG_GRAPH_SCHEMA_VERSION,
    alternativeStrategy: 'family_compatible_runtime',
    relationCount: relations.length,
    relations,
    compactedFromGraphSchemaVersion: Number(index.graphSchemaVersion ?? 1),
  };
}

/**
 * Builds process-local lookup structures for an immutable catalog snapshot.
 *
 * These artifacts intentionally hold references to the snapshot instead of
 * copies of it. They make token, node and relation lookups O(relevant data)
 * rather than rebuilding maps and hashing every product on each message.
 */
export function prepareCatalogKnowledgeRuntime(index) {
  if (!index?.products) return null;
  const cached = runtimeByIndex.get(index);
  if (cached) return cached;

  const startedAt = performance.now();
  const products = Object.values(index.products);
  const documentsBySku = new Map((index.searchDocuments ?? []).map((document) => [document.sku, document]));
  const productDataBySku = new Map();
  const productSkusByToken = new Map();
  const productVocabulary = new Set();
  const productsByFamily = new Map();

  const addProductToken = (token, sku) => {
    if (!token) return;
    productVocabulary.add(token);
    const skus = productSkusByToken.get(token) ?? new Set();
    skus.add(sku);
    productSkusByToken.set(token, skus);
  };

  for (const product of products) {
    const document = documentsBySku.get(product.sku);
    const text = document?.text ?? productSearchText(product);
    const allTokens = document?.tokens ?? tokenize(text);
    const nameTokens = tokenize([product.name, product.brand].filter(Boolean).join(' '));
    const aliasTokens = tokenize([product.sku, product.productFamily, ...(product.aliases ?? [])].filter(Boolean).join(' '));
    const supportingTokens = tokenize([
      product.category,
      product.presentation,
      product.normalizedPresentation,
      product.description,
      attributesSearchText(product.attributes),
      ...(product.tags ?? []),
    ].filter(Boolean).join(' '));
    const coreTokens = tokenize([
      product.name,
      product.brand,
      product.productFamily,
      product.category,
      product.presentation,
      product.normalizedPresentation,
      ...(product.aliases ?? []),
      ...(product.tags ?? []),
    ].filter(Boolean).join(' '));
    for (const token of coreTokens) addProductToken(token, product.sku);
    const family = product.family ?? product.productFamily ?? deriveFamily(product);
    const inFamily = productsByFamily.get(familyKey(family)) ?? [];
    inFamily.push(product);
    productsByFamily.set(familyKey(family), inFamily);
    productDataBySku.set(product.sku, {
      text,
      normalizedText: normalizedValue(text),
      allTokens,
      nameTokens,
      aliasTokens,
      supportingTokens,
      vector: Array.isArray(document?.vector) ? document.vector : hashedVector(text),
    });
  }

  const nodesById = new Map();
  const anchorNodes = [];
  const anchorNodeIdsByToken = new Map();
  const anchorVocabulary = new Set();
  for (const node of index.nodes ?? []) {
    nodesById.set(node.id, node);
    if (node.type === CATALOG_NODE_TYPES.product || node.type === CATALOG_NODE_TYPES.tenant) continue;
    anchorNodes.push(node);
    for (const token of tokenize(nodeSearchText(node))) {
      anchorVocabulary.add(token);
      const nodeIds = anchorNodeIdsByToken.get(token) ?? new Set();
      nodeIds.add(node.id);
      anchorNodeIdsByToken.set(token, nodeIds);
    }
  }

  const reverseRelations = new Map();
  const relationsByNode = new Map();
  const storedAlternativeTargetsByProduct = new Map();
  const addRelationForNode = (nodeId, relation) => {
    const relations = relationsByNode.get(nodeId) ?? [];
    relations.push(relation);
    relationsByNode.set(nodeId, relations);
  };
  const addStoredAlternative = (productNodeId, targetNodeId, relation) => {
    const targets = storedAlternativeTargetsByProduct.get(productNodeId) ?? [];
    targets.push({ targetNodeId, relation });
    storedAlternativeTargetsByProduct.set(productNodeId, targets);
  };
  for (const relation of index.relations ?? []) {
    const reverse = reverseRelations.get(relation.to) ?? [];
    reverse.push(relation);
    reverseRelations.set(relation.to, reverse);
    addRelationForNode(relation.from, relation);
    addRelationForNode(relation.to, relation);
    if (relation.type === CATALOG_RELATION_TYPES.alternativeOf) {
      addStoredAlternative(relation.from, relation.to, relation);
      addStoredAlternative(relation.to, relation.from, relation);
    }
  }

  const runtime = {
    products,
    productsBySku: index.products,
    productDataBySku,
    productSkusByToken,
    productVocabulary,
    productsByFamily,
    nodesById,
    anchorNodes,
    anchorNodeIdsByToken,
    anchorVocabulary,
    reverseRelations,
    relationsByNode,
    storedAlternativeTargetsByProduct,
    generatedAlternativeTargetsByProduct: new Map(),
    preparedAt: new Date().toISOString(),
    preparationMs: Number((performance.now() - startedAt).toFixed(2)),
  };
  runtimeByIndex.set(index, runtime);
  return runtime;
}

export function searchCatalogKnowledgeIndex(index, {
  query = '',
  semanticQuery = '',
  recommendation = false,
  filters = {},
  retrievalHints = {},
  excludeSkus = [],
  limit = 25,
  includeRelations = true,
} = {}) {
  if (!index?.products) {
    return {
      catalogVersion: null,
      rows: [],
      relations: [],
      retrieval: { directCandidateCount: 0, graphCandidateCount: 0, candidateCount: 0, excludedSkuCount: 0, graphPaths: [] },
    };
  }
  const normalizedQuery = normalizeText(query);
  const normalizedSemanticQuery = normalizeText(semanticQuery);
  const queryTokens = tokenize(normalizedQuery);
  const semanticTokens = tokenize(normalizedSemanticQuery);
  const runtime = prepareCatalogKnowledgeRuntime(index);
  const excludedSkuSet = new Set((excludeSkus ?? []).map((sku) => String(sku ?? '').trim()).filter(Boolean));
  // A semantic query is only additional evidence. It must not silently turn
  // an exact/product lookup into a recommendation search. The planner marks
  // recommendation intent explicitly so concrete requests keep their
  // presentation, attribute constraints and ranking behavior unchanged.
  const recommendationMode = Boolean(recommendation && semanticTokens.length);
  const compatibleProducts = runtime.products
    .filter((product) => productMatchesFilters(product, filters))
    .filter((product) => !excludedSkuSet.has(String(product?.sku ?? '').trim()));
  const directProducts = catalogDirectCandidates(runtime, {
    queryTokens,
    semanticTokens,
    retrievalHints,
    compatibleProducts,
  });
  const queryVector = normalizedQuery ? hashedVector(normalizedQuery) : null;
  const semanticVector = semanticTokens.length ? hashedVector(semanticTokens.join(' ')) : null;
  const directCandidates = directProducts
    .map((product) => scoreDirectCandidate(product, queryTokens, normalizedQuery, semanticTokens, recommendationMode, retrievalHints, {
      runtimeProduct: runtime.productDataBySku.get(product.sku),
      queryVector,
      semanticVector,
    }))
    .filter((row) => {
      if (!queryTokens.length && !semanticTokens.length) return true;
      // A recommendation can be grounded by a catalog concept inferred by
      // the LLM (for example, category=snacks). That is positive retrieval
      // evidence, not a hard predicate: candidates outside the hint still
      // remain eligible if their lexical or semantic evidence is stronger.
      // Without this branch, products such as Chocoramo never enter the
      // candidate set for "antojo de algo dulce" because their description
      // need not literally contain the word "antojo".
      if (recommendationMode) {
        return row.lexicalEvidence
          || row.semanticEvidence
          || row.semanticScore > 0
          || row.retrievalHintEvidence.length > 0;
      }
      return row.matchScore >= 2.25 && row.lexicalEvidence;
    });

  // The graph is a retrieval expansion layer. It does not decide the intent
  // or select a product on behalf of the LLM. It follows tenant-local family,
  // presentation, brand, category and attribute relations, then applies the
  // same explicit filters before returning candidates.
  const graphEvidence = graphCandidateEvidence(index, runtime, queryTokens, semanticTokens, filters, compatibleProducts, retrievalHints);
  const bySku = new Map(directCandidates.map((row) => [row.sku, row]));
  // When a concrete customer term already retrieved a product directly, a
  // category-only graph path (for example "arepa" -> panaderia -> pan
  // tajado) is discovery noise, not a selectable alternative. Keep graph
  // paths through family, brand, presentation or attributes: those are the
  // meaningful relationships used to surface real variants. Broad category
  // requests have no direct lexical anchor and continue to explore normally.
  const hasConcreteDirectEvidence = directCandidates.some((row) => row.queryLexicalEvidence);
  for (const [sku, evidence] of graphEvidence.entries()) {
    const product = index.products[sku];
    if (hasConcreteDirectEvidence && graphEvidenceIsCategoryOnly(evidence)) continue;
    if (!product || bySku.has(sku) || (queryTokens.length && !evidence.anchorEvidence)) continue;
    bySku.set(sku, {
      ...product,
      matchScore: Number((2.25 + Math.min(2, evidence.anchorScore) + softRetrievalHintScore(product, retrievalHints).score).toFixed(2)),
      matchType: 'graph_relation',
      lexicalEvidence: false,
      semanticScore: 0,
      semanticEvidence: false,
      retrievalHintEvidence: softRetrievalHintScore(product, retrievalHints).evidence,
      graphEvidence: evidence,
    });
  }
  for (const [sku, row] of bySku.entries()) {
    const evidence = graphEvidence.get(sku);
    if (evidence) row.graphEvidence = evidence;
  }
  const rankedRows = [...bySku.values()]
    .sort((a, b) => b.matchScore - a.matchScore || Number(b.stock ?? 0) - Number(a.stock ?? 0))
  const rows = recommendationMode
    ? diversifyRecommendationRows(rankedRows, Math.max(1, Number(limit) || 25))
    : rankedRows.slice(0, Math.max(1, Number(limit) || 25));
  return {
    catalogVersion: index.catalogVersion,
    rows,
    relations: includeRelations ? relationEvidence(index, rows, runtime) : [],
    retrieval: {
      directCandidateCount: directCandidates.length,
      directScannedCount: directProducts.length,
      compatibleProductCount: compatibleProducts.length,
      graphCandidateCount: graphEvidence.size,
      candidateCount: bySku.size,
      excludedSkuCount: excludedSkuSet.size,
      semanticCandidateCount: directCandidates.filter((row) => row.semanticEvidence || row.semanticScore > 0).length,
      retrievalHintKeys: Object.keys(retrievalHints ?? {}).filter((key) => retrievalHints[key] !== undefined && retrievalHints[key] !== null && retrievalHints[key] !== ''),
      recommendation: recommendationMode,
      diversityApplied: recommendationMode && rows.length > 1,
      graphPaths: [...graphEvidence.values()].flatMap((evidence) => evidence.paths).slice(0, 100),
      graphSchemaVersion: index.graphSchemaVersion ?? 1,
      runtimePreparationMs: runtime.preparationMs,
    },
  };
}

function scoreDirectCandidate(product, queryTokens, normalizedQuery, semanticTokens = [], recommendation = false, retrievalHints = {}, {
  runtimeProduct = null,
  queryVector = null,
  semanticVector = null,
} = {}) {
  const text = runtimeProduct?.text ?? productSearchText(product);
  const tokens = runtimeProduct?.allTokens ?? tokenize(text);
  const lexical = weightedTokenScore(queryTokens, product, runtimeProduct);
  const semantic = weightedTokenScore(semanticTokens, product, runtimeProduct);
  const vector = queryVector ? cosineSimilarity(queryVector, runtimeProduct?.vector ?? hashedVector(text)) : 0;
  const semanticVectorScore = semanticVector
    ? cosineSimilarity(semanticVector, runtimeProduct?.vector ?? hashedVector(text))
    : 0;
  const baseScore = recommendation
    ? (semantic * 0.65) + (semanticVectorScore * 25 * 0.2) + (lexical * 0.15)
    : queryTokens.length ? (lexical * 0.75) + (vector * 25 * 0.25) : 0;
  const hint = softRetrievalHintScore(product, retrievalHints, runtimeProduct?.normalizedText ?? normalizedValue(text));
  // Hints are soft evidence from the interpreter. They help rank compatible
  // variants but never decide eligibility or suppress graph exploration.
  // In a recommendation, an LLM-derived concept is a stronger relevance
  // signal than incidental words from the customer's sentence. It raises
  // compatible products, but it never excludes the rest of the catalog.
  const hintWeight = recommendation ? 4 : 1;
  const score = baseScore + (hint.score * hintWeight) + (!recommendation && semanticTokens.length ? semantic * 0.12 : 0);
  const lexicalEvidence = hasLexicalEvidence(queryTokens, tokens);
  const semanticEvidence = hasLexicalEvidence(semanticTokens, tokens);
  return {
    ...product,
    matchScore: Number(score.toFixed(2)),
    matchType: recommendation ? 'index_semantic_recommendation' : (lexicalEvidence ? 'index_lexical' : 'index_semantic'),
    queryLexicalEvidence: lexicalEvidence,
    lexicalEvidence: lexicalEvidence || semanticEvidence,
    semanticScore: Number(semantic.toFixed(2)),
    semanticEvidence,
    retrievalHintEvidence: hint.evidence,
  };
}

function graphEvidenceIsCategoryOnly(evidence = {}) {
  const paths = Array.isArray(evidence.paths) ? evidence.paths : [];
  return paths.length > 0 && paths.every((path) => path.anchorType === CATALOG_NODE_TYPES.category);
}

function catalogDirectCandidates(runtime, { queryTokens = [], semanticTokens = [], retrievalHints = {}, compatibleProducts = [] } = {}) {
  const evidenceTokens = usefulRetrievalTokens([
    ...queryTokens,
    ...semanticTokens,
    ...retrievalHintTokens(retrievalHints),
  ]);
  if (!evidenceTokens.length) return compatibleProducts;
  const candidateSkus = candidateSkusForTokens(runtime.productSkusByToken, runtime.productVocabulary, evidenceTokens);
  if (!candidateSkus.size) return compatibleProducts;
  const compatibleSkuSet = new Set(compatibleProducts.map((product) => product.sku));
  const candidates = [...candidateSkus]
    .filter((sku) => compatibleSkuSet.has(sku))
    .map((sku) => runtime.productsBySku[sku])
    .filter(Boolean);
  // A lexical index is only a fast shortlist. It must never be a destructive
  // filter when its vocabulary has no compatible entry after tenant filters.
  return candidates.length ? candidates : compatibleProducts;
}

function graphCandidateEvidence(index, runtime, queryTokens, semanticTokens, filters, compatibleProducts, retrievalHints = {}) {
  const compatibleSkus = compatibleProducts.length === runtime.products.length
    ? null
    : new Set(compatibleProducts.map((product) => product.sku));
  const evidenceTokens = [...queryTokens, ...semanticTokens, ...filterEvidenceTokens(filters), ...retrievalHintTokens(retrievalHints)];
  const anchors = graphAnchorsForTokens(runtime, evidenceTokens);
  const attributeAnchors = anchors.filter((anchor) => anchor.type === CATALOG_NODE_TYPES.attribute);
  const restrictAlternativeExpansion = attributeAnchors.length > 0;
  const pathsBySku = new Map();
  const addPath = (sku, anchor, relations) => {
    if (compatibleSkus && !compatibleSkus.has(sku)) return;
    const entry = pathsBySku.get(sku) ?? { anchorEvidence: true, anchorScore: 0, paths: [] };
    const anchorText = nodeSearchText(anchor);
    const anchorScore = evidenceTokens.length ? weightedTextTokenScore(evidenceTokens, tokenize(anchorText)) : 1;
    entry.anchorScore = Math.max(entry.anchorScore, anchorScore);
    const path = {
      sku,
      anchorType: anchor.type,
      anchorKey: anchor.key,
      relationTypes: relations.map((relation) => relation.type),
    };
    if (!entry.paths.some((current) => current.sku === path.sku && current.anchorKey === path.anchorKey && current.relationTypes.join('|') === path.relationTypes.join('|'))) {
      entry.paths.push(path);
    }
    pathsBySku.set(sku, entry);
  };

  for (const anchor of anchors) {
    for (const relation of runtime.reverseRelations.get(anchor.id) ?? []) {
      const productNode = runtime.nodesById.get(relation.from);
      if (productNode?.type !== CATALOG_NODE_TYPES.product) continue;
      addPath(productNode.payload?.sku ?? productNode.key, anchor, [relation]);
      // An explicit attribute match is already a precise anchor (for example
      // material=algodon or variante=Original). Do not fan it back out to
      // sibling alternatives that could contradict the customer's constraint.
      if (restrictAlternativeExpansion) continue;
      for (const alternative of alternativeTargetsForProduct(runtime, productNode)) {
        const target = runtime.nodesById.get(alternative.targetNodeId);
        addPath(target?.payload?.sku ?? target?.key, anchor, [relation, alternative.relation]);
      }
    }
  }
  return pathsBySku;
}

function graphAnchorsForTokens(runtime, evidenceTokens = []) {
  const usefulTokens = usefulRetrievalTokens(evidenceTokens);
  if (!usefulTokens.length) return [];
  const candidateNodeIds = candidateSkusForTokens(runtime.anchorNodeIdsByToken, runtime.anchorVocabulary, usefulTokens);
  const candidates = candidateNodeIds.size
    ? [...candidateNodeIds].map((id) => runtime.nodesById.get(id)).filter(Boolean)
    : runtime.anchorNodes;
  return candidates.filter((node) => nodeMatchesEvidence(node, evidenceTokens));
}

function alternativeTargetsForProduct(runtime, productNode) {
  const stored = runtime.storedAlternativeTargetsByProduct.get(productNode.id);
  if (stored?.length) return stored;
  const cached = runtime.generatedAlternativeTargetsByProduct.get(productNode.id);
  if (cached) return cached;
  const product = productNode.payload ?? runtime.productsBySku[productNode.key];
  const family = product?.family ?? product?.productFamily ?? deriveFamily(product ?? {});
  const alternatives = (runtime.productsByFamily.get(familyKey(family)) ?? [])
    .filter((candidate) => candidate.sku !== product?.sku)
    .filter((candidate) => {
      const samePresentation = normalizedValue(product?.normalizedPresentation)
        && normalizedValue(product?.normalizedPresentation) === normalizedValue(candidate.normalizedPresentation);
      const sameBrand = normalizedValue(product?.brand) && normalizedValue(product?.brand) === normalizedValue(candidate.brand);
      const sameCategory = normalizedValue(product?.category) && normalizedValue(product?.category) === normalizedValue(candidate.category);
      return samePresentation || (sameBrand && sameCategory);
    })
    .map((candidate) => ({
      targetNodeId: nodeKey(CATALOG_NODE_TYPES.product, candidate.sku),
      relation: {
        type: CATALOG_RELATION_TYPES.alternativeOf,
        from: productNode.id,
        to: nodeKey(CATALOG_NODE_TYPES.product, candidate.sku),
        metadata: { generated: true },
      },
    }));
  runtime.generatedAlternativeTargetsByProduct.set(productNode.id, alternatives);
  return alternatives;
}

const RETRIEVAL_STOP_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'me',
  'mi', 'para', 'por', 'que', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'o',
  'quiero', 'regalame', 'regala', 'dame', 'necesito', 'favor', 'pedido',
]);

function usefulRetrievalTokens(tokens = []) {
  return [...new Set(tokens.filter((token) => token.length >= 3 && !RETRIEVAL_STOP_WORDS.has(token)))];
}

function candidateSkusForTokens(indexByToken, vocabulary, tokens = []) {
  const candidates = new Set();
  for (const token of tokens) {
    const matchingTokens = matchingVocabularyTokens(vocabulary, token);
    for (const matchingToken of matchingTokens) {
      for (const candidate of indexByToken.get(matchingToken) ?? []) candidates.add(candidate);
    }
  }
  return candidates;
}

function matchingVocabularyTokens(vocabulary, queryToken) {
  if (vocabulary.has(queryToken)) return [queryToken];
  const prefixMatches = [];
  for (const candidate of vocabulary) {
    if (candidate.length < 4 || queryToken.length < 4) continue;
    if (candidate.startsWith(queryToken) || queryToken.startsWith(candidate)) prefixMatches.push(candidate);
  }
  if (prefixMatches.length) return prefixMatches;
  if (queryToken.length < 6) return [];
  const typoMatches = [];
  for (const candidate of vocabulary) {
    if (candidate.length < 6) continue;
    if (levenshtein(candidate, queryToken) <= (candidate.length >= 8 && queryToken.length >= 8 ? 2 : 1)) typoMatches.push(candidate);
  }
  return typoMatches;
}

function diversifyRecommendationRows(rows, limit) {
  const selected = [];
  const usedFamilies = new Set();
  for (const row of rows) {
    const family = normalizedValue(row.family ?? row.productFamily ?? row.category ?? row.name) || row.sku;
    if (usedFamilies.has(family)) continue;
    usedFamilies.add(family);
    selected.push(row);
    if (selected.length >= limit) return selected;
  }
  for (const row of rows) {
    if (selected.some((candidate) => candidate.sku === row.sku)) continue;
    selected.push(row);
    if (selected.length >= limit) break;
  }
  return selected;
}

function nodeMatchesEvidence(node, evidenceTokens) {
  if (!evidenceTokens.length) return false;
  return hasLexicalEvidence(evidenceTokens, tokenize(nodeSearchText(node)));
}

function nodeSearchText(node) {
  return [
    node?.key,
    node?.payload?.name,
    node?.payload?.value,
    node?.payload?.family,
    node?.payload?.key,
  ].filter(Boolean).join(' ');
}

function filterEvidenceTokens(filters = {}) {
  const values = [];
  const collect = (value) => {
    if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'number') return;
    if (Array.isArray(value)) return value.forEach(collect);
    if (typeof value === 'object') return Object.entries(value).forEach(([key, item]) => { values.push(key); collect(item); });
    values.push(String(value));
  };
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (key !== 'query' && key !== 'sku') collect(value);
  }
  return tokenize(values.join(' '));
}

function retrievalHintTokens(hints = {}) {
  const values = [];
  const collect = (value) => {
    if (value == null || value === '' || typeof value === 'boolean' || typeof value === 'number') return;
    if (Array.isArray(value)) return value.forEach(collect);
    if (typeof value === 'object') return Object.entries(value).forEach(([key, item]) => { values.push(key); collect(item); });
    values.push(String(value));
  };
  collect(hints);
  return tokenize(values.join(' '));
}

function weightedTextTokenScore(queryTokens, productTokens) {
  if (!queryTokens.length) return 0;
  const matched = queryTokens.filter((queryToken) => productTokens.some((token) => (
    token === queryToken
    || (token.length >= 4 && queryToken.length >= 4 && (token.startsWith(queryToken) || queryToken.startsWith(token)))
  ))).length;
  return matched / queryTokens.length;
}

export function relationEvidence(index, rows = [], runtime = prepareCatalogKnowledgeRuntime(index)) {
  const productNodeIds = new Set(rows.map((row) => nodeKey(CATALOG_NODE_TYPES.product, row.sku)));
  const evidence = [];
  const seen = new Set();
  for (const productNodeId of productNodeIds) {
    for (const relation of runtime?.relationsByNode?.get(productNodeId) ?? []) {
      // Pairwise legacy alternative edges can be extremely numerous. The
      // selected product's direct family/brand/presentation edges are enough
      // evidence for the LLM and keep a response bounded.
      if (relation.type === CATALOG_RELATION_TYPES.alternativeOf) continue;
      if (seen.has(relation.key)) continue;
      seen.add(relation.key);
      evidence.push(relation);
      if (evidence.length >= 200) return evidence;
    }
  }
  return evidence;
}

export function normalizeProduct(row) {
  return {
    sku: String(row.sku).trim(),
    name: String(row.name ?? '').trim(),
    category: String(row.category ?? '').trim() || null,
    brand: String(row.brand ?? '').trim() || null,
    presentation: String(row.presentation ?? '').trim() || null,
    normalizedPresentation: String(row.normalizedPresentation ?? row.presentation ?? '').trim() || null,
    price: Number(row.price ?? 0),
    stock: Number(row.stock ?? 0),
    aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
    description: String(row.description ?? '').trim() || null,
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    productFamily: String(row.productFamily ?? '').trim() || null,
    attributes: row.attributes && typeof row.attributes === 'object' ? row.attributes : {},
    allowsSaleByAmount: row.allowsSaleByAmount === true,
    active: row.active !== false,
    driveFileId: row.driveFileId ?? null,
    catalogOrigin: row.catalogOrigin ?? null,
  };
}

function productSearchText(product) {
  return [
    product.name,
    product.brand,
    product.category,
    product.presentation,
    product.normalizedPresentation,
    product.productFamily,
    product.description,
    ...(product.aliases ?? []),
    ...(product.tags ?? []),
    attributesSearchText(product.attributes),
  ].filter(Boolean).join(' ');
}

function deriveFamily(product) {
  return String(product.name ?? '').replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|l|lt|litros?|g|gr|kg|unidades?)\b/gi, '').replace(/\s+/g, ' ').trim() || product.name;
}

function familyKey(value) {
  return normalizedValue(value) || 'unknown';
}

function normalizedValue(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  return [...new Set(normalizeText(value).split(' ').filter((token) => token.length >= 2))];
}

function hasLexicalEvidence(queryTokens, productTokens) {
  return queryTokens.some((queryToken) => productTokens.some((productToken) => (
    productToken === queryToken
    || (productToken.length >= 4 && queryToken.length >= 4 && productToken.startsWith(queryToken))
    || (productToken.length >= 4 && queryToken.length >= 4 && queryToken.startsWith(productToken))
    || (queryToken.length >= 6 && productToken.length >= 6
      && levenshtein(queryToken, productToken) <= (queryToken.length >= 8 && productToken.length >= 8 ? 2 : 1))
  )));
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) matrix[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return matrix[a.length][b.length];
}

function tokenScore(queryTokens, productTokens) {
  if (!queryTokens.length) return 0;
  let matched = 0;
  for (const queryToken of queryTokens) {
    if (productTokens.includes(queryToken) || productTokens.some((token) => token.startsWith(queryToken) || queryToken.startsWith(token))) matched += 1;
  }
  return matched / queryTokens.length * 20;
}

function weightedTokenScore(queryTokens, product, runtimeProduct = null) {
  if (!queryTokens.length) return 0;
  const nameTokens = runtimeProduct?.nameTokens ?? tokenize([product.name, product.brand].filter(Boolean).join(' '));
  const aliasTokens = runtimeProduct?.aliasTokens ?? tokenize([product.sku, product.productFamily, ...(product.aliases ?? [])].filter(Boolean).join(' '));
  const supportingTokens = runtimeProduct?.supportingTokens ?? tokenize([
    product.category,
    product.presentation,
    product.normalizedPresentation,
    product.description,
    attributesSearchText(product.attributes),
    ...(product.tags ?? []),
  ].filter(Boolean).join(' '));
  const firstNameToken = nameTokens[0] ?? '';
  let score = 0;
  for (const queryToken of queryTokens) {
    if (nameTokens.includes(queryToken)) score += queryToken === firstNameToken ? 20 : 12;
    else if (aliasTokens.includes(queryToken)) score += 11;
    else if (hasCompatiblePrefix(nameTokens, queryToken)) score += 8;
    else if (hasCompatiblePrefix(aliasTokens, queryToken)) score += 7;
    else if (supportingTokens.includes(queryToken)) score += 4;
    else if (hasCompatiblePrefix(supportingTokens, queryToken)) score += 3;
    else if (hasCloseTypo([...nameTokens, ...aliasTokens], queryToken)) score += 6;
  }
  return score / queryTokens.length;
}

function hasCompatiblePrefix(tokens, queryToken) {
  return tokens.some((candidate) => candidate.length >= 4 && queryToken.length >= 4
    && (candidate.startsWith(queryToken) || queryToken.startsWith(candidate)));
}

function hasCloseTypo(tokens, queryToken) {
  return tokens.some((candidate) => candidate.length >= 6 && queryToken.length >= 6
    && levenshtein(candidate, queryToken) <= (candidate.length >= 8 && queryToken.length >= 8 ? 2 : 1));
}

function hashedVector(value) {
  const vector = Array.from({ length: VECTOR_DIMENSIONS }, () => 0);
  for (const token of tokenize(value)) {
    const digest = crypto.createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % VECTOR_DIMENSIONS;
    vector[index] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((total, item) => total + item * item, 0)) || 1;
  return vector.map((item) => Number((item / magnitude).toFixed(6)));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  return Math.max(0, Math.min(1, a.reduce((total, value, index) => total + value * (b[index] ?? 0), 0)));
}

function softRetrievalHintScore(product, hints = {}, normalizedProductText = null) {
  if (!hints || typeof hints !== 'object') return { score: 0, evidence: [] };
  const text = normalizedProductText ?? normalizedValue([
    product.name,
    product.brand,
    product.category,
    product.presentation,
    product.normalizedPresentation,
    product.productFamily ?? product.family,
    product.description,
    ...(product.aliases ?? []),
    ...(product.tags ?? []),
    typeof product.attributes === 'object' ? JSON.stringify(product.attributes) : product.attributes,
  ].filter(Boolean).join(' '));
  const evidence = [];
  let score = 0;
  for (const [key, rawValue] of Object.entries(hints)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    if (key === 'attributes' && typeof rawValue === 'object') {
      const attributeText = normalizedValue(JSON.stringify(rawValue));
      if (attributeText && tokenOverlap(attributeText, text) >= 0.5) {
        score += 0.35;
        evidence.push('attributes');
      }
      continue;
    }
    const value = normalizedValue(rawValue);
    if (!value) continue;
    if (text.includes(value)) {
      score += key === 'brand' || key === 'family' ? 1.1 : 0.65;
      evidence.push(key);
    } else if (tokenOverlap(value, text) >= 0.6) {
      score += 0.25;
      evidence.push(`${key}:partial`);
    }
  }
  return { score: Number(Math.min(score, 2.5).toFixed(2)), evidence };
}

function tokenOverlap(left, right) {
  const leftTokens = new Set(String(left).split(/\s+/).filter((token) => token.length >= 2));
  if (!leftTokens.size) return 0;
  const rightTokens = new Set(String(right).split(/\s+/));
  const matches = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return matches / leftTokens.size;
}

export function productMatchesFilters(product, filters = {}) {
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'sku' && normalizedValue(product.sku) !== normalizedValue(value)) return false;
    if (key === 'category' && !categoryMatches(product.category, value)) return false;
    if (key === 'brand' && !normalizedValue(product.brand).includes(normalizedValue(value))) return false;
    if (key === 'presentation' && !normalizedValue(`${product.presentation} ${product.normalizedPresentation}`).includes(normalizedValue(value))) return false;
    if (key === 'attributes' && !matchesCatalogAttributes(product.attributes, value)) return false;
  }
  return true;
}

function categoryMatches(actual, expected) {
  const normalizedActual = normalizedValue(actual);
  const normalizedExpected = normalizedValue(expected);
  if (!normalizedExpected || normalizedActual.includes(normalizedExpected)) return true;
  const aliases = {
    bebidas: ['jugos', 'gaseosas', 'aguas', 'hidratantes', 'maltas', 'te listo'],
    snacks: ['snack', 'galletas', 'dulces', 'pasabocas'],
    aseo: ['aseo', 'limpieza', 'cuidado personal', 'higiene'],
    lacteos: ['lacteo', 'leche', 'queso', 'yogur'],
    despensa: ['granos', 'basicos', 'aceite', 'cocina', 'harina', 'pasta', 'enlatado', 'condimento', 'cereal', 'huevo'],
    cafe: ['cafe'],
  };
  return (aliases[normalizedExpected] ?? []).some((alias) => normalizedActual.includes(alias));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
