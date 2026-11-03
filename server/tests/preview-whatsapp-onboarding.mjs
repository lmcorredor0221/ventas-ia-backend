// Local visual fixture only. No provider credentials, persistent DB or background workers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppAsync } from '../index.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'via-onboarding-preview-'));
Object.assign(process.env,{META_APP_ID:'local-preview',META_APP_SECRET:'local-preview',META_WHATSAPP_ADVANCED_ACCESS_APPROVED:'true',META_FACEBOOK_LOGIN_ADVANCED_ACCESS_APPROVED:'true',WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID:'local-preview',WHATSAPP_WEBHOOK_VERIFY_TOKEN:'local-preview',WHATSAPP_WEBHOOK_PUBLIC_URL:'https://example.test/webhooks/whatsapp'});
const {app,store,controlPlane}=await createAppAsync({storageDriver:'json',dataFile:path.join(dir,'state.json'),authRequired:false,csrfRequired:false,corsAllowedOrigins:['http://127.0.0.1:5179'],backgroundWorkersEnabled:false});
store.mutate(s=>{for(const t of s.tenants)t.config.whatsapp.phoneNumberId=null;});
controlPlane.mockActivateSubscription('andina');
controlPlane.saveWhatsAppOnboardingIntent('andina',{setupPath:'business_app_existing'});
const server=app.listen(3001,'127.0.0.1',()=>console.log('Local visual fixture http://127.0.0.1:3001; synthetic Meta settings; no messages'));
async function stop(){await new Promise(r=>server.close(r));await store.close?.();fs.rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
