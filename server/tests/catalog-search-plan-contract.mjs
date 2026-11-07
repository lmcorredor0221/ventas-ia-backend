import assert from 'node:assert/strict';
import { catalogSearchesFromPlan } from '../services/agentRuntime.js';

const searches = catalogSearchesFromPlan({
  toolPlan: [{
    tool: 'google_sheets_read_table',
    candidateIndex: 0,
    candidate: 'Coca-Cola original',
    query: 'Coca-Cola 1.5 L',
    filters: { query: 'gaseosa', presentation: '1.5 L' },
  }],
}, [{
  rawName: 'Coca-Cola original',
  catalogQuery: 'Coca-Cola 1.5 L',
  requestedPresentation: '1.5 L',
}], 'una coca cola litro y medio');

assert.equal(searches.length, 1);
assert.equal(searches[0].query, 'Coca-Cola 1.5 L');
assert.equal(searches[0].filters.query, undefined);
assert.equal(searches[0].filters.presentation, '1.5 L');

const staleGenericPlan = catalogSearchesFromPlan({
  toolPlan: [{
    tool: 'google_sheets_read_table',
    candidateIndex: 0,
    candidate: 'Coca-Cola',
    filters: { query: 'gaseosa' },
  }],
}, [{
  rawName: 'Coca-Cola',
  catalogQuery: 'Coca-Cola 1.5 L',
  requestedPresentation: '1.5 L',
}], 'una coca cola litro y medio');

assert.equal(staleGenericPlan[0].query, 'Coca-Cola 1.5 L');
assert.deepEqual(staleGenericPlan[0].filters, { presentation: '1.5 L' });

const recommendationPlan = catalogSearchesFromPlan({
  candidateItems: [{
    rawName: 'algo para la sed',
    catalogQuery: 'sed',
    recommendationIntent: 'recommendation',
    semanticQuery: 'refrescante hidratacion fruta',
  }],
  toolPlan: [{
    tool: 'google_sheets_read_table',
    candidateIndex: 0,
    candidate: 'algo para la sed',
    filters: { category: 'bebidas' },
  }],
}, [{
  rawName: 'algo para la sed',
  catalogQuery: 'sed',
  recommendationIntent: 'recommendation',
  semanticQuery: 'refrescante hidratacion fruta',
}], 'algo para la sed');

assert.equal(recommendationPlan[0].recommendation, true);
assert.equal(recommendationPlan[0].semanticQuery, 'refrescante hidratacion fruta');
assert.equal(recommendationPlan[0].categoryQuery, true);

console.log('catalog-search-plan-contract: ok');
