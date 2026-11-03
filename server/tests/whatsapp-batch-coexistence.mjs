import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
import { normalizeWhatsAppEvents } from '../routes/whatsapp.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'via-coex-contract-'));
const secret = process.env.WHATSAPP_APP_SECRET;
process.env.WHATSAPP_APP_SECRET = 'local-signature-contract';
const { app, store, runtime, planner, tools, controlPlane } = await createAppAsync({ dataFile: path.join(dir,'state.json'), storageDriver:'json', asyncInboundEnabled:true, integrationOutboxEnabled:true, backgroundWorkersEnabled:false });
const server = app.listen(0,'127.0.0.1');
await new Promise(r => server.once('listening',r));
const base = `http://127.0.0.1:${server.address().port}`;
const msg = (id,from='buyer',text='Pedido antiguo') => ({ id,from,type:'text',timestamp:'1700000000',text:{body:text} });
const change = (field,value,phone='phone-a') => ({ field,value:{metadata:{phone_number_id:phone,display_phone_number:'store'},...value} });
const envelope = (...changes) => ({ object:'whatsapp_business_account',entry:[{id:'waba-a',changes}] });
try {
  store.mutate(s => {
    for (const t of s.tenants) t.config.whatsapp.phoneNumberId = null;
    for (const [id,phone,waba] of [['andina','phone-a','waba-a'],['norte','phone-b','waba-b']]) Object.assign(s.tenants.find(t=>t.id===id).config.whatsapp,{phoneNumberId:phone,wabaId:waba,coexistence:true,businessId:'business-a'});
  });
  controlPlane.mockActivateSubscription('andina'); controlPlane.mockActivateSubscription('norte');
  const batch = envelope(change('messages',{messages:[msg('m1'),msg('m2','buyer2')],contacts:[{wa_id:'buyer2',profile:{name:'Comprador dos'}},{wa_id:'buyer',profile:{name:'Comprador uno'}}],statuses:[{id:'out1',status:'delivered',recipient_id:'buyer'}]}));
  batch.entry.push({id:'waba-b',changes:[change('messages',{messages:[msg('m3')]},'phone-b')]});
  const response = await post(batch);
  assert.equal(response.status,200); assert.equal((await response.json()).results.length,4);
  assert.equal(store.getInboundMessage('m1').payload.profileName,'Comprador uno');
  assert.equal(store.getInboundMessage('m2').payload.profileName,'Comprador dos');
  assert.equal(store.getInboundMessage('m3').payload.tenantId,'norte');
  await post(batch);
  assert.equal(Object.keys(store.getState().inboundMessagesById).filter(id=>/^m[123]$/.test(id)).length,3);
  assert.equal((await post(batch,'sha256=wrong')).status,403);
  const conflicting = structuredClone(store.getState());
  conflicting.tenants.find(t=>t.id==='norte').config.whatsapp.phoneNumberId='phone-a';
  assert.throws(()=>normalizeWhatsAppEvents(batch,conflicting),e=>e.code==='whatsapp_phone_ownership_conflict');
  planner.plan = async () => { throw new Error('Coexistence must not call LLM'); };
  const before = (store.getState().ordersByTenant.andina??[]).length;
  async function importEvent(field,value) {
    const normalized = normalizeWhatsAppEvents(envelope(change(field,value)),store.getState())[0];
    await runtime.processInbound(normalized); return normalized;
  }
  await importEvent('smb_app_state_sync',{state_sync:[{type:'contact',contact:{phone_number:'buyer',full_name:'Cliente sincronizado'},action:'add',metadata:{timestamp:'1700000001'}}]});
  const history = {history:[{metadata:{progress:100,phase:2,chunk_order:1},threads:[{id:'buyer',messages:[msg('old-user'),{...msg('old-human','store'),to:'buyer'}, {...msg('old-media'),type:'media_placeholder'}]}]}]};
  await importEvent('history',history); await importEvent('history',history);
  const archived = store.getState().conversations.find(c=>c.tenantId==='andina'&&c.closeReason==='imported_history');
  assert.equal(archived.messages.length,3); assert.equal(archived.status,'completed');
  assert.equal(archived.messages.find(m=>m.providerMessageId==='old-human').role,'human');
  await importEvent('history',{messages:[{...msg('old-media'),type:'image',image:{id:'media1',caption:'Foto histórica'}}]});
  assert.equal(archived.messages.length,3); assert.equal(archived.messages.find(m=>m.providerMessageId==='old-media').text,'Foto histórica');
  await importEvent('history',{messages:[{...msg('early-media','store'),type:'image',image:{id:'media2',caption:'Entrega antigua'}}]});
  assert.equal(store.getState().conversations.some(c=>c.tenantId==='andina'&&c.waId==='store'),false,'outgoing media must not invent a customer');
  await importEvent('history',{history:[{threads:[{id:'buyer',messages:[{...msg('early-media','store'),type:'media_placeholder'}]}]}]});
  assert.equal(archived.messages.find(m=>m.providerMessageId==='early-media').text,'Entrega antigua');
  assert.equal(archived.messages.find(m=>m.providerMessageId==='early-media').role,'human');
  assert.equal(store.getState().whatsappOnboardingByTenant.andina.pendingHistoryMedia['early-media'],undefined);
  const echo = {message_echoes:[{...msg('echo1','store','Ya te atiendo'),to:'buyer'}]};
  await importEvent('smb_message_echoes',echo); await importEvent('smb_message_echoes',echo);
  const manual = store.getState().conversations.find(c=>c.tenantId==='andina'&&c.status==='manual_active'&&c.waId==='buyer');
  assert.equal(manual.messages.filter(m=>m.providerMessageId==='echo1').length,1); assert.equal(manual.messages.find(m=>m.providerMessageId==='echo1').role,'human');
  assert.equal((store.getState().ordersByTenant.andina??[]).length,before);
  await importEvent('history',{history:[{errors:[{code:2593109}]}]});
  assert.equal(controlPlane.getWhatsAppOnboarding('andina').sync.history,'not_shared');
  const revoked = {object:'whatsapp_business_account',entry:[{id:'provider',time:1800000000,changes:[{field:'account_update',value:{event:'PARTNER_REMOVED',waba_info:{waba_id:'waba-a',owner_business_id:'business-a'}}}]}]};
  await runtime.processInbound(normalizeWhatsAppEvents(revoked,store.getState())[0]);
  assert.equal(controlPlane.getWhatsAppOnboarding('andina').channelStatus,'revoked');
  assert.notEqual(controlPlane.getWhatsAppOnboarding('norte').channelStatus,'revoked');
  await assert.rejects(tools.sendLiveWhatsAppMessage({tenant:store.getState().tenants.find(t=>t.id==='andina'),payload:{}}),e=>e.code==='whatsapp_access_revoked');
  console.log('PASS batch routing/ACK, signature, deduplication, contact matching, conflict rejection, history/media, human echoes, consent and revocation');
} finally {
  await new Promise(r=>server.close(r)); await store.close?.();
  if(secret===undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET=secret;
  fs.rmSync(dir,{recursive:true,force:true});
}
function post(payload,signature) { const body=JSON.stringify(payload); return fetch(`${base}/webhooks/whatsapp`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature??`sha256=${crypto.createHmac('sha256','local-signature-contract').update(body).digest('hex')}`},body}); }
