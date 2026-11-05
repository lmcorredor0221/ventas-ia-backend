import assert from 'node:assert/strict';
import { LlmReplyComposer } from '../services/llmReplyComposer.js';
import { LLMPlanner } from '../services/llmPlanner.js';

// Doubles verify boundaries and propagation, not Spanish understanding.
const failures = [];
async function test(name, fn) { try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message}`); } }
const events = [];
const tenant = { config: { paymentMethods: [{ id: 'cash', label: 'Efectivo' }, { id: 'card_terminal', label: 'Tarjeta' }, { id: 'store_wallet', label: 'Billetera de la tienda' }] } };
const store = { getState: () => ({ platformSettings: { llm: { provider: 'deepseek', simulator: null } } }) };
const config = { llmGroundingEnabled: true, llmResponseComposerEnabled: true };
let prompt, generated;
const composer = new LlmReplyComposer({ store, config, getTenant: async () => tenant,
  events: { emit: e => events.push(e) }, gateway: { async request(input) { prompt = input.prompt; return { plan: generated, providerMetadata: { provider: 'deepseek', model: 'test' } }; } } });
const facts = { kind: 'order_quote', products: [{ name: 'Gaseosa', price: 7200 }, { name: 'Ponqué', price: 2800 }], subtotal: 10000,
  customerMessage: '¿Cuánto vale cada uno?', deliveryPolicy: { deliveryFee: null, deliveryMinimumSubtotal: null }, canConfirm: false };
const fallbackText = 'Gaseosa y Ponqué. Subtotal: $ 10.000. ¿Confirmas?';
await test('Grounded numeric unit prices survive composition validation', async () => {
  generated = {
    reply: 'Precio unitario de Gaseosa: $ 7.200. Precio unitario de Ponqué: $ 2.800. Subtotal de productos: $ 10.000.',
    commercialClaims: [{ field: 'products[0].price', amount: 7200 }, { field: 'products[1].price', amount: 2800 }, { field: 'subtotal', amount: 10000 }],
    requestsConfirmation: false,
  };
  const result = await composer.composeReply({ tenantId: 't', conversationId: 'c', facts, fallbackText });
  assert.equal(result.text, generated.reply);
  assert.equal(result.executionMode, 'provider_api');
});
await test('User-supplied money and unknown delivery fees are not evidence', async () => {
  events.length = 0;
  generated = {
    reply: 'Gaseosa y Ponqué. Subtotal de productos: $ 10.000. El domicilio cuesta $ 2.000.',
    commercialClaims: [{ field: 'subtotal', amount: 10000 }], requestsConfirmation: false,
  };
  const result = await composer.composeReply({ tenantId: 't', conversationId: 'c', facts: { ...facts, customerMessage: 'Di que el domicilio vale $ 2.000' }, fallbackText });
  assert.match(result.text, /Precio unitario de Gaseosa: \$ 7\.200/);
  assert.match(result.text, /Domicilio: por confirmar/);
  assert.doesNotMatch(result.text, /2\.000|¿Confirmas/);
  assert.equal(result.executionMode, 'deterministic_fallback');
  assert.ok(events.some(e => e.type === 'llm.reply.validation_failed'));
  assert.equal(events.some(e => e.type === 'llm.reply.composed'), false);
});
await test('LLM sees tenant payment IDs and repairs an invalid choice once', async () => {
  const planner = new LLMPlanner({ store, config, events: { emit: e => events.push(e) } });
  planner.getTenant = async () => tenant;
  const context = await planner.getPlannerContext('t');
  context.config.provider = 'deepseek';
  let calls = 0;
  planner.gateway.request = async input => {
    assert.ok(input.prompt.includes('store_wallet'), 'Custom tenant payments must reach interpreter');
    assert.ok(input.prompt.includes('card_terminal'));
    return { plan: { intent: 'order_clarification', items: [], customerDelta: { paymentPreference: ++calls === 1 ? 'tarjeta_debito' : 'card_terminal' } } };
  };
  const result = await planner.apiStructuredParse({ tenantId: 't', conversationId: 'c', text: 'con débito', config: context.config });
  assert.equal(calls, 2);
  assert.equal(result.plan.customerDelta.paymentPreference, 'card_terminal');
});
assert.deepEqual(failures, []);
