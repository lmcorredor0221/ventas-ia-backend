import assert from 'node:assert/strict';
import { LlmReplyComposer } from '../services/llmReplyComposer.js';

// Inject the observed bad drafts. The production LLM reviews their meaning;
// this boundary test verifies that it receives authoritative state/buttons.
const base = { kind: 'order_quote', orderCreated: false, canConfirm: false,
  subtotal: 7400, pricing: { delivery: false, status: 'not_applicable', total: 7400, deliveryFee: 0, minimumSubtotal: 0, canConfirm: true },
  deliveryPolicy: { deliveryFee: 3000, deliveryMinimumSubtotal: 0 }, missingFields: [],
  replyInteraction: { kind: 'none' }, conversationContext: { recentMessages: [{ role: 'user', text: '¿Cuánto cuesta el domicilio?' }] } };
const scenarios = [
  { name: 'Question is not a registered purchase', facts: { nextAction: 'answer_question' },
    bad: 'Le confirmo el pedido. Gracias por su compra.', good: 'El pedido aún está en cotización. ¿Deseas añadir el domicilio?' },
  { name: 'Clarification cannot ask payment or confirmation', facts: { nextAction: 'ask_clarification',
    dataAudit: { verdict: 'clarify', reason: 'No consta la modalidad de entrega' }, missingFields: ['order_data_review'] },
    bad: '¿Pagas en efectivo? Confirma tu pedido.', good: '¿Lo recoges en la tienda o prefieres domicilio?' },
  { name: 'Question matches product buttons and quantity pending', facts: { nextAction: 'ask_clarification',
    replyInteraction: { kind: 'product_variant', options: [{ sku: 'C65', name: 'Chocoramo', presentation: '65 g' }] },
    missingFields: ['quantity:chocoramo'] },
    bad: '¿Cuántos quieres? Elige con el botón.', good: 'Puedes elegir Chocoramo de 65 g con el botón. Dime también cuántos quieres.' },
  { name: 'Presentation priority cannot hide missing quantity from the reviewer', facts: { nextAction: 'ask_clarification',
    replyInteraction: { kind: 'product_variant', options: [{ sku: 'W600', name: 'Agua Cristal', presentation: '600 ml' }] },
    missingFields: ['presentation:water'], orderItems: [{ rawItemId: 'water', quantity: null, saleMode: 'units' }] },
    bad: '¿Cuántas botellas? Elige con el botón.', good: 'El botón corresponde al agua Cristal de 600 ml. Dime por texto cuántas botellas quieres.' },
];
const oldFetch = global.fetch;
global.fetch = () => { throw new Error('No network permitted'); };
try {
  for (const scenario of scenarios) {
    const prompts = [];
    const facts = { ...base, ...scenario.facts };
    const composer = new LlmReplyComposer({ config: { llmGroundingEnabled: true, llmResponseComposerEnabled: true },
      store: { getState: () => ({ platformSettings: { llm: { provider: 'deepseek', simulator: null } } }) },
      getTenant: async () => ({ config: {} }), events: { emit() {} },
      gateway: { async request({ prompt }) {
        prompts.push(JSON.parse(prompt.split('\n').at(-1)));
        return { plan: prompts.length === 1
          ? { reply: scenario.bad, commercialClaims: [], requestsConfirmation: false }
          : { decision: 'revised', reason: 'Align meaning with authoritative action and interaction',
              reply: scenario.good, commercialClaims: [], requestsConfirmation: false } };
      } } });
    const response = await composer.composeReply({ tenantId: 'a', conversationId: 'c', facts, fallbackText: 'safe' });
    assert.equal(prompts.length, 2, scenario.name);
    assert.equal(prompts[1].orderCreated, false);
    assert.deepEqual(prompts[1].replyInteraction, facts.replyInteraction);
    assert.deepEqual(prompts[1].dataAudit, facts.dataAudit);
    assert.deepEqual(prompts[1].orderItems, facts.orderItems);
    assert.equal(response.text, scenario.good);
    assert.equal(response.executionMode, 'provider_api');
    console.log('PASS ' + scenario.name);
  }
  let calls = 0;
  const composer = new LlmReplyComposer({ config: { llmGroundingEnabled: true, llmResponseComposerEnabled: true },
    store: { getState: () => ({ platformSettings: { llm: { provider: 'deepseek', simulator: null } } }) },
    getTenant: async () => ({ config: {} }), events: { emit() {} },
    gateway: { async request() { calls++; return { plan: {
      reply: '{{commercial:subtotal}}. {{commercial:pricing.total}}. ¿Confirmas?',
      commercialClaims: [{ field: 'subtotal', amount: 7400 }, { field: 'pricing.total', amount: 7400 }],
      requestsConfirmation: true } }; } } });
  const response = await composer.composeReply({ tenantId: 'a', conversationId: 'c',
    facts: { ...base, canConfirm: true, nextAction: 'confirm_order', replyInteraction: { kind: 'confirmation' },
      dataAudit: { verdict: 'approve' } }, fallbackText: '' });
  assert.equal(calls, 1, 'Valid audited confirmation keeps its call count');
  assert.equal(response.executionMode, 'provider_api');
  console.log('PASS Valid audited confirmation does not add a second review');
  let invitationCalls = 0;
  const invitation = new LlmReplyComposer({ config: { llmGroundingEnabled: true, llmResponseComposerEnabled: true },
    store: { getState: () => ({ platformSettings: { llm: { provider: 'deepseek', simulator: null } } }) },
    getTenant: async () => ({ config: {} }), events: { emit() {} },
    gateway: { async request({ prompt }) {
      invitationCalls++;
      const input = JSON.parse(prompt.split('\n').at(-1));
      assert.equal(input.facts.nextAction, 'ask_more');
      assert.equal(input.facts.replyInteraction.kind, 'none');
      assert.match(prompt, /sin sustituir esa invitación por elegir pago/);
      return { plan: { reply: '¿Deseas agregar algo más o ajustar el pedido?', commercialClaims: [], requestsConfirmation: false } };
    } } });
  assert.equal((await invitation.composeReply({ tenantId: 'a', conversationId: 'c', facts: { ...base, nextAction: 'ask_more' }, fallbackText: '' })).executionMode, 'provider_api');
  assert.equal(invitationCalls, 1, 'Do not re-decide ordinary add-items invitations in another LLM call');
  console.log('PASS Invitation preserves decision context without another interpretation');
} finally { global.fetch = oldFetch; }
