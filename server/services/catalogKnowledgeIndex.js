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
  const productsBySku = {};
  const familyProducts = new Map();

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
    addRelation(relations, CATALOG_RELATION_TYPES.relatedTo, tenantNode, productNode, { scope: 'tenant' });
    addRelation(relations, CATALOG_RELATION_TYPES.belongsToFamily, productNode, familyNode);
    if (brandNode) addRelation(relations, CATALOG_RELATION_TYPES.sameBrand, productNode, brandNode);
    if (categoryNode) addRelation(relations, CATALOG_RELATION_TYPES.relatedTo, productNode, categoryNode);
    if (presentationNode) addRelation(relations, CATALOG_RELATION_TYPES.hasPresentation, productNode, presentationNode);
    for (const [key, value] of Object.entries(product.attributes ?? {})) {
      const attributeNode = addNode(CATALOG_NODE_TYPES.attribute, `${key}:${value}`, { key, value });
      addRelation(relations, CATALOG_RELATION_TYPES.hasAttribute, productNode, attributeNode);
      const normalizedKey = normalizeKey(key);
      if (normalizedKey.includes('sabor') || normalizedKey.includes('flavor')) {
        addRelation(relations, CATALOG_RELATION_TYPES.hasFlavor, productNode, attributeNode);
      }
      if (normalizedKey.includes('variante') || normalizedKey.includes('tipo')) {
        addRelation(relations, CATALOG_RELATION_TYPES.hasVariant, productNode, attributeNode);
      }
    }
    productsBySku[product.sku] = { ...product, family, nodeId: productNode };
    familyProducts.set(familyKey(family), [...(familyProducts.get(familyKey(family)) ?? []), product]);
  }

  // Alternatives are relation data, not family-specific business rules.
  for (const productsInFamily of familyProducts.values()) {
    for (const product of productsInFamily) {
      for (const alternative of productsInFamily) {
        if (product.sku === alternative.sku) continue;
        const samePresentation = normalizedValue(product.normalizedPresentation)
          && normalizedValue(product.normalizedPresentation) === normalizedValue(alternative.normalizedPresentation);
        const sameBrand = normalizedValue(product.brand) && normalizedValue(product.brand) === normalizedValue(alternative.brand);
        const sameCategory = normalizedValue(product.category) && normalizedValue(product.category) === normalizedValue(alternative.category);
        if (samePresentation || (sameBrand && sameCategory)) {
          addRelation(
            relations,
            CATALOG_RELATION_TYPES.alternativeOf,
            nodeKey(CATALOG_NODE_TYPES.product, product.sku),
            nodeKey(CATALOG_NODE_TYPES.product, alternative.sku),
            { samePresentation, sameBrand, sameCategory },
          );
        }
      }
    }
  }

  const searchDocuments = products.map((product) => {
    const text = productSearchText(product);
    return {
      id: nodeKey(CATALOG_NODE_TYPES.product, product.sku),
      sku: product.sku,
      catalogVersion,
      text,
      tokens: tokenize(text),
      vector: hashedVector(text),
    };
  });

  return {
    tenantId,
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

export function searchCatalogKnowledgeIndex(index, { query = '', semanticQuery = '', recommendation = false, filters = {}, limit = 25 } = {}) {
  if (!index?.products) {
    return {
      catalogVersion: null,
      rows: [],
      relations: [],
      retrieval: { directCandidateCount: 0, graphCandidateCount: 0, candidateCount: 0, graphPaths: [] },
    };
  }
  const normalizedQuery = normalizeText(query);
  const normalizedSemanticQuery = normalizeText(semanticQuery);
  const queryTokens = tokenize(normalizedQuery);
  const semanticTokens = tokenize(normalizedSemanticQuery);
  // A semantic query is only additional evidence. It must not silently turn
  // an exact/product lookup into a recommendation search. The planner marks
  // recommendation intent explicitly so concrete requests keep their
  // presentation, attribute constraints and ranking behavior unchanged.
  const recommendationMode = Boolean(recommendation && semanticTokens.length);
  const compatibleProducts = Object.values(index.products)
    .filter((product) => productMatchesFilters(product, filters));
  const directCandidates = compatibleProducts
    .map((product) => scoreDirectCandidate(product, queryTokens, normalizedQuery, semanticTokens, recommendationMode))
    .filter((row) => {
      if (!queryTokens.length && !semanticTokens.length) return true;
      if (recommendationMode) return row.lexicalEvidence || row.semanticEvidence || row.semanticScore > 0;
      return row.matchScore >= 2.25 && row.lexicalEvidence;
    });

  // The graph is a retrieval expansion layer. It does not decide the intent
  // or select a product on behalf of the LLM. It follows tenant-local family,
  // presentation, brand, category and attribute relations, then applies the
  // same explicit filters before returning candidates.
  const graphEvidence = graphCandidateEvidence(index, queryTokens, semanticTokens, filters, compatibleProducts);
  const bySku = new Map(directCandidates.map((row) => [row.sku, row]));
  for (const [sku, evidence] of graphEvidence.entries()) {
    const product = index.products[sku];
    if (!product || bySku.has(sku) || (queryTokens.length && !evidence.anchorEvidence)) continue;
    bySku.set(sku, {
      ...product,
      matchScore: Number((2.25 + Math.min(2, evidence.anchorScore)).toFixed(2)),
      matchType: 'graph_relation',
      lexicalEvidence: false,
      semanticScore: 0,
      semanticEvidence: false,
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
    relations: relationEvidence(index, rows),
    retrieval: {
      directCandidateCount: directCandidates.length,
      graphCandidateCount: graphEvidence.size,
      candidateCount: bySku.size,
      semanticCandidateCount: directCandidates.filter((row) => row.semanticEvidence || row.semanticScore > 0).length,
      recommendation: recommendationMode,
      diversityApplied: recommendationMode && rows.length > 1,
      graphPaths: [...graphEvidence.values()].flatMap((evidence) => evidence.paths).slice(0, 100),
    },
  };
}

function scoreDirectCandidate(product, queryTokens, normalizedQuery, semanticTokens = [], recommendation = false) {
  const text = productSearchText(product);
  const tokens = tokenize(text);
  const lexical = weightedTokenScore(queryTokens, product);
  const semantic = weightedTokenScore(semanticTokens, product);
  const vector = normalizedQuery ? cosineSimilarity(hashedVector(normalizedQuery), hashedVector(text)) : 0;
  const semanticVector = semanticTokens.length
    ? cosineSimilarity(hashedVector(semanticTokens.join(' ')), hashedVector(text))
    : 0;
  const score = recommendation
    ? (semantic * 0.65) + (semanticVector * 25 * 0.2) + (lexical * 0.15)
    : queryTokens.length ? (lexical * 0.75) + (vector * 25 * 0.25) : 0;
  const lexicalEvidence = hasLexicalEvidence(queryTokens, tokens);
  const semanticEvidence = hasLexicalEvidence(semanticTokens, tokens);
  return {
    ...product,
    matchScore: Number(score.toFixed(2)),
    matchType: recommendation ? 'index_semantic_recommendation' : (lexicalEvidence ? 'index_lexical' : 'index_semantic'),
    lexicalEvidence: lexicalEvidence || semanticEvidence,
    semanticScore: Number(semantic.toFixed(2)),
    semanticEvidence,
  };
}

function graphCandidateEvidence(index, queryTokens, semanticTokens, filters, compatibleProducts) {
  const compatibleSkus = new Set(compatibleProducts.map((product) => product.sku));
  const nodesById = new Map((index.nodes ?? []).map((node) => [node.id, node]));
  const evidenceTokens = [...queryTokens, ...semanticTokens, ...filterEvidenceTokens(filters)];
  const anchors = (index.nodes ?? []).filter((node) => (
    node.type !== CATALOG_NODE_TYPES.product
    && node.type !== CATALOG_NODE_TYPES.tenant
    && nodeMatchesEvidence(node, evidenceTokens)
  ));
  const reverseRelations = new Map();
  const alternativesByProduct = new Map();
  for (const relation of index.relations ?? []) {
    const list = reverseRelations.get(relation.to) ?? [];
    list.push(relation);
    reverseRelations.set(relation.to, list);
    if (relation.type === CATALOG_RELATION_TYPES.alternativeOf) {
      alternativesByProduct.set(relation.from, [...(alternativesByProduct.get(relation.from) ?? []), relation]);
      alternativesByProduct.set(relation.to, [...(alternativesByProduct.get(relation.to) ?? []), relation]);
    }
  }
  const attributeAnchors = anchors.filter((anchor) => anchor.type === CATALOG_NODE_TYPES.attribute);
  const restrictAlternativeExpansion = attributeAnchors.length > 0;
  const pathsBySku = new Map();
  const addPath = (sku, anchor, relations) => {
    if (!compatibleSkus.has(sku)) return;
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
    for (const relation of reverseRelations.get(anchor.id) ?? []) {
      const productNode = nodesById.get(relation.from);
      if (productNode?.type !== CATALOG_NODE_TYPES.product) continue;
      addPath(productNode.payload?.sku ?? productNode.key, anchor, [relation]);
      // An explicit attribute match is already a precise anchor (for example
      // material=algodon or variante=Original). Do not fan it back out to
      // sibling alternatives that could contradict the customer's constraint.
      if (restrictAlternativeExpansion) continue;
      for (const alternative of alternativesByProduct.get(productNode.id) ?? []) {
        if (alternative.from === productNode.id) {
          const target = nodesById.get(alternative.to);
          addPath(target?.payload?.sku ?? target?.key, anchor, [relation, alternative]);
        }
        if (alternative.to === productNode.id) {
          const source = nodesById.get(alternative.from);
          addPath(source?.payload?.sku ?? source?.key, anchor, [relation, alternative]);
        }
      }
    }
  }
  return pathsBySku;
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

function weightedTextTokenScore(queryTokens, productTokens) {
  if (!queryTokens.length) return 0;
  const matched = queryTokens.filter((queryToken) => productTokens.some((token) => (
    token === queryToken
    || (token.length >= 4 && queryToken.length >= 4 && (token.startsWith(queryToken) || queryToken.startsWith(token)))
  ))).length;
  return matched / queryTokens.length;
}

export function relationEvidence(index, rows = []) {
  const productNodeIds = new Set(rows.map((row) => nodeKey(CATALOG_NODE_TYPES.product, row.sku)));
  const familyIds = new Set(
    rows.map((row) => nodeKey(CATALOG_NODE_TYPES.family, row.family || row.productFamily || deriveFamily(row))),
  );
  return (index?.relations ?? []).filter((relation) => productNodeIds.has(relation.from) || familyIds.has(relation.from) || productNodeIds.has(relation.to) || familyIds.has(relation.to));
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

function weightedTokenScore(queryTokens, product) {
  if (!queryTokens.length) return 0;
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

function productMatchesFilters(product, filters = {}) {
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
