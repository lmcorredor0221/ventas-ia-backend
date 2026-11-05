import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { LlmReplyComposer } from '../../server/services/llmReplyComposer.js';
process.env.DEEPSEEK_API_KEY = (await fs.readFile('APIKEYTEST.txt', 'utf8')).match(/sk-[A-Za-z0-9_-]+/)[0];
const config = { provider:'deepseek',model:'deepseek-chat',apiKeyRef:'DEEPSEEK_API_KEY',timeoutMs:8000,maxTokens:500 };
const usage = [], events = [], results = [];
const choco={sku:'C65',name:'Chocoramo',presentation:'65 g',price:2800};
const water={sku:'W600',name:'Agua Cristal',presentation:'600 ml',price:2200};
const commonFacts={kind:'order_quote',orderCreated:false,canConfirm:false,missingFields:[],
  orderItems:[{product:choco,quantity:1,lineTotal:2800}],
  pricing:{delivery:false,deliveryFee:0,subtotal:2800,total:2800,status:'not_applicable'},
  deliveryPolicy:{deliveryFee:3000,deliveryMinimumSubtotal:0}};
const commercialFacts=[{field:'subtotal',amount:2800,text:'Subtotal de productos: $ 2.800'},
  {field:'pricing.total',amount:2800,text:'Total: $ 2.800'},
  {field:'deliveryPolicy.deliveryFee',amount:3000,text:'Domicilio: $ 3.000'}];
const composer = new LlmReplyComposer({ config:{ llmGroundingEnabled:true,llmResponseComposerEnabled:true },
  store:{ getState:()=>({ platformSettings:{ llm:{ ...config,simulator:null } } }) }, getTenant:async()=>({config:{}}),
  usage:{recordLlmPlan:(_id,e)=>usage.push(e)},events:{emit:e=>events.push(e)} });
const scenarios = [
  { id:'quote_not_created', text:'Le confirmo el pedido. Gracias por su compra.',
    facts:{ nextAction:'answer_question', customerMessage:'¿Cómo va el domicilio y el total?', replyInteraction:{kind:'none'} } },
  { id:'audit_clarification_no_payment', text:'Elige efectivo o tarjeta y confirma el pedido.',
    facts:{ nextAction:'ask_clarification', customerMessage:'Efectivo', replyInteraction:{kind:'none'},
      dataAudit:{verdict:'clarify',reason:'No consta si quiere recoger o recibir domicilio'},missingFields:['order_data_review'] } },
  { id:'buttons_are_not_quantities',text:'¿Cuántos quieres? Elige la cantidad en el botón.',
    facts:{ nextAction:'ask_clarification',customerMessage:'Un chocoramo y agua',missingFields:['quantity:agua'],
      orderItems:[{product:choco,quantity:1,lineTotal:2800},{rawItemId:'water',quantity:null,presentationOptions:[water]}],
      replyInteraction:{kind:'product_variant',options:[{sku:'W600',name:'Agua Cristal',presentation:'600 ml'}]} } },
];
for (const s of scenarios) {
  const started = Date.now();
  const output = await composer.reviewCatalogReply({tenantId:'local',conversationId:s.id,
    output:{reply:s.text,commercialClaims:[],requestsConfirmation:false},
    facts:{...commonFacts,...s.facts}, commercialFacts,confirmationAllowed:false,config,remainingMs:8000});
  assert.equal(output.decision,'revised',s.id);
  assert.equal(output.requestsConfirmation,false,s.id);
  results.push({id:s.id,ms:Date.now()-started,output});
}
const started = Date.now(), before = usage.length;
const invitation = await composer.composeReply({tenantId:'local',conversationId:'add_without_redeciding',facts:{
  kind:'order_quote',orderCreated:false,nextAction:'ask_more',canConfirm:false,replyInteraction:{kind:'none'},missingFields:[],
  customerMessage:'Me regalas dos paquetes de arepas boyacenses de cinco unidades para domicilio',
  orderItems:[{product:{sku:'A5',name:'Arepa boyacense',presentation:'5 und',price:6500},quantity:2,lineTotal:13000}],
  subtotal:13000,pricing:{delivery:true,deliveryFee:0,minimumSubtotal:0,total:13000,status:'eligible',canConfirm:true},
  paymentMethods:[{id:'cash',label:'Efectivo'}] },fallbackText:''});
assert.equal(invitation.executionMode,'provider_api');
assert.equal(usage.length-before,1,'Invitation must not be reinterpreted by another reviewer');
results.push({id:'add_without_redeciding',ms:Date.now()-started,output:invitation});
const dir='test-results/reply-coherence-live/'+new Date().toISOString().replace(/[:.]/g,'-');
await fs.mkdir(dir,{recursive:true});
await fs.writeFile(dir+'/report.json',JSON.stringify({results,usage,events},null,2));
console.log(JSON.stringify({dir,results},null,2));
