// Component controls, separate from the frozen 50-case campaign. Real DeepSeek.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { LlmReplyComposer } from '../../server/services/llmReplyComposer.js';
process.env.DEEPSEEK_API_KEY = (await fs.readFile('APIKEYTEST.txt', 'utf8')).match(/sk-[A-Za-z0-9_-]+/)[0];
const config = { provider:'deepseek', model:'deepseek-chat', apiKeyRef:'DEEPSEEK_API_KEY', timeoutMs:8000, maxTokens:500 };
const usage=[], events=[], results=[];
const composer = new LlmReplyComposer({ config:{llmGroundingEnabled:true,llmResponseComposerEnabled:true},
  store:{getState:()=>({platformSettings:{llm:{...config,simulator:null}}})}, getTenant:async()=>({config:{}}),
  usage:{recordLlmPlan:(_id,e)=>usage.push(e)},events:{emit:e=>events.push(e)} });
const scenarios = [
  {id:'free_tariff_with_no_delivery_selected', fee:0, minimum:0,
    bad:'La tienda debe confirmar cuánto cuesta el domicilio y cuál es el mínimo.',
    expected:['deliveryPolicy.deliveryFee','deliveryPolicy.deliveryMinimumSubtotal']},
  {id:'paid_tariff_with_no_delivery_selected', fee:3000, minimum:10000,
    bad:'El domicilio está incluido gratis porque el cargo del pedido es cero.',
    expected:['deliveryPolicy.deliveryFee','deliveryPolicy.deliveryMinimumSubtotal']},
  {id:'unknown_fee_known_zero_minimum',fee:null,minimum:0,
    bad:'El domicilio es gratis y el mínimo está por confirmar.',
    expected:['deliveryPolicy.deliveryFee','deliveryPolicy.deliveryMinimumSubtotal']},
  {id:'free_tariff_known_minimum',fee:0,minimum:15000,
    bad:'Como no has hecho un pedido todavía, tanto la tarifa como el mínimo los debe confirmar la tienda.',
    expected:['deliveryPolicy.deliveryFee','deliveryPolicy.deliveryMinimumSubtotal']},
  {id:'authorized_delivery_exception',fee:3000,minimum:10000,delivery:true,
    bad:'Tienes que pagar la tarifa general y cumplir el mínimo general, aunque la tienda aprobó la excepción.',
    expected:['pricing.deliveryFee','pricing.minimumSubtotal']},
];
for(const s of scenarios){
  const facts={kind:'order_quote',orderCreated:false,nextAction:'answer_question',canConfirm:false,
    customerMessage:s.delivery?'¿Qué domicilio y mínimo aplican con la excepción que aprobó la tienda?':'Solo estoy consultando: ¿cuánto cuesta el domicilio y hay pedido mínimo?',
    replyInteraction:{kind:'none'},missingFields:[],orderItems:[],
    deliveryPolicy:{deliveryFee:s.fee,deliveryMinimumSubtotal:s.minimum},
    pricing:{delivery:s.delivery===true,deliveryFee:0,minimumSubtotal:0,status:s.delivery?'exception_approved':'not_applicable',
      ...(s.delivery?{resolution:{authorized:true,deliveryFee:0,minimumSubtotal:0,minimumException:true}}:{})}};
  const commercialFacts=s.delivery
    ? [{field:'pricing.deliveryFee',amount:0,text:'Domicilio: $ 0'}, {field:'pricing.minimumSubtotal',amount:0,text:'Mínimo de productos para domicilio: $ 0'}]
    : [{field:'deliveryPolicy.deliveryFee',amount:s.fee,text:s.fee===null?'Domicilio: por confirmar':`Domicilio: $ ${s.fee.toLocaleString('es-CO')}`},
      {field:'deliveryPolicy.deliveryMinimumSubtotal',amount:s.minimum,text:`Mínimo de productos para domicilio: $ ${s.minimum.toLocaleString('es-CO')}`}];
  const started=Date.now();
  const output=await composer.reviewCatalogReply({tenantId:'local',conversationId:s.id,output:{reply:s.bad,commercialClaims:[],requestsConfirmation:false},
    facts,commercialFacts,confirmationAllowed:false,config,remainingMs:8000});
  const checks=[];
  try{
    assert.equal(output.decision,'revised');
    assert.equal(output.requestsConfirmation,false);
    for(const field of s.expected){
      assert(output.reply.includes(`{{commercial:${field}}}`),`Missing cited fact ${field}`);
      assert(output.commercialClaims.some(c=>c.field===field&&c.amount===commercialFacts.find(f=>f.field===field).amount),`Wrong claim ${field}`);
    }
    for(const c of output.commercialClaims) assert(commercialFacts.some(f=>f.field===c.field&&f.amount===c.amount));
    checks.push({passed:true});
  }catch(e){checks.push({passed:false,error:e.message});}
  results.push({id:s.id,ms:Date.now()-started,facts,commercialFacts,output,checks});
}
const dir='test-results/delivery-evidence-live/'+new Date().toISOString().replace(/[:.]/g,'-');
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(dir+'/report.json',JSON.stringify({results,usage,events},null,2));
console.log(JSON.stringify({dir,results},null,2));
if(results.some(r=>r.checks.some(c=>!c.passed)))process.exitCode=1;
