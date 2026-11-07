import assert from 'node:assert/strict';
import { buildProductInferencePrompt, buildTenantProductVocabulary } from '../prompts/catalogSemanticGuide.js';
import { normalizeCandidateItems } from '../services/llmPlanner.js';

const index = {
  catalogVersion: 'catalog-v1',
  products: {
    'SKU-65': {
      name: 'Ponque Chocorramo 65 g',
      family: 'Ponque Chocorramo',
      productFamily: 'Ponque Chocorramo',
      brand: 'Ramo',
      presentation: '65 g',
      price: 2800,
      stock: 55,
    },
    'SKU-95': {
      name: 'Ponque Chocorramo 95 g',
      family: 'Ponque Chocorramo',
      productFamily: 'Ponque Chocorramo',
      brand: 'Ramo',
      presentation: '95 g',
      price: 3600,
      stock: 20,
    },
    'SKU-COKE': {
      name: 'Coca-Cola Original 1.5 L',
      family: 'Coca-Cola',
      productFamily: 'Coca-Cola',
      brand: 'Coca-Cola',
      presentation: '1.5 L',
      price: 7200,
      stock: 10,
    },
  },
};

const vocabulary = buildTenantProductVocabulary(index);
assert.deepEqual(vocabulary, {
  catalogVersion: 'catalog-v1',
  products: [
    { product: 'Coca-Cola', brand: 'Coca-Cola' },
    { product: 'Ponque Chocorramo', brand: 'Ramo' },
  ],
});

const prompt = buildProductInferencePrompt({
  text: 'Una coca cola litro y medio y un chocorramo',
  contextAnalysis: { intent: 'delivery_order', productRequestDetected: true },
  customerProfile: null,
  conversation: { messages: [], orderDraft: null },
  config: { agentName: 'Rocio', tone: 'tendero_colombiano', responseLanguage: 'es-CO' },
  tenantCatalogVocabulary: vocabulary,
});
assert.match(prompt, /Ponque Chocorramo/);
assert.match(prompt, /Coca-Cola/);
assert.match(prompt, /catalogVersion: catalog-v1/);
assert.match(prompt, /no.*disponibilidad/i);
assert.doesNotMatch(prompt, /\$\s?2800/);

const normalized = normalizeCandidateItems([{
  rawText: 'chocorramo',
  familyHypothesis: 'ponque',
  productHypothesis: 'ponque de chocolate',
  quantity: 1,
}]);
assert.equal(normalized[0].rawName, 'chocorramo');
assert.equal(normalized[0].catalogQuery, 'chocorramo');
assert.equal(normalized[0].productHypothesis, 'ponque de chocolate');

console.log('tenant-vocabulary-grounding: ok');
