import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../store/postgresStore.js';
import { SecretVault } from '../services/secretVault.js';

const configured = process.env.POSTGRES_TEST_DATABASE_URL ?? fs.readFileSync('.env.example','utf8').match(/^DATABASE_URL=(.+)$/m)?.[1].trim();
const url = new URL(configured);
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/ventas_ia_dev') throw new Error('This test only accepts the local ventas_ia_dev database');
const schema = `via_meta_test_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({connectionString:url.href,ssl:false});
let store;
try {
  const before = await admin.query("SELECT md5(document::text) AS digest FROM public.app_state WHERE id='runtime'");
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options',`-c search_path=${schema}`);
  store = new PostgresStore({databaseUrl:url.href,ssl:'disable'});
  await store.load();
  const results = await Promise.allSettled([store.claimWhatsAppPhone('andina','isolated-phone'),store.claimWhatsAppPhone('norte','isolated-phone')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'whatsapp_phone_already_bound');
  const winner = (await store.pool.query('SELECT tenant_id FROM whatsapp_phone_claims WHERE phone_number_id=$1',['isolated-phone'])).rows[0].tenant_id;
  const vault = new SecretVault({store,encryptionKey:'local-contract-key'});
  const ref = vault.saveSecret({tenantId:winner,name:'TEST_ATTEMPT',value:'never-log-this-contract-token'});
  store.mutate(s=>{
    s.whatsappOnboardingByTenant[winner]={tenantId:winner,attempt:{idHash:'contract-hash',actorId:'owner',status:'authorized',tokenRef:ref}};
    Object.assign(s.tenants.find(t=>t.id===winner).config.whatsapp,{phoneNumberId:'isolated-phone',wabaId:'isolated-waba',accessTokenRef:ref});
  });
  await store.persistWhatsAppOnboarding(winner);
  const saved = (await store.pool.query("SELECT document FROM app_state WHERE id='runtime'")).rows[0].document;
  assert.equal(saved.whatsappOnboardingByTenant[winner].attempt.status,'authorized');
  assert.equal(saved.tenants.find(t=>t.id===winner).config.whatsapp.phoneNumberId,'isolated-phone');
  assert.equal(JSON.stringify(saved).includes('never-log-this-contract-token'),false);
  await store.close(); store=new PostgresStore({databaseUrl:url.href,ssl:'disable'}); await store.load();
  assert.equal(new SecretVault({store,encryptionKey:'local-contract-key'}).readSecret(ref),'never-log-this-contract-token');
  await assert.rejects(store.claimWhatsAppPhone(winner==='andina'?'norte':'andina','isolated-phone'),e=>e.code==='whatsapp_phone_already_bound');
  // A duplicate must also be rejected at the binding table even without the application guard.
  await assert.rejects(store.pool.query('UPDATE whatsapp_bindings SET phone_number_id=$1 WHERE tenant_id=$2',['isolated-phone',winner==='andina'?'norte':'andina']),e=>e.code==='23505');
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP INDEX whatsapp_bindings_phone_unique');
    await client.query('UPDATE whatsapp_bindings SET phone_number_id=$1 WHERE tenant_id IN ($2,$3)',['legacy-conflict','andina','norte']);
    await assert.rejects(client.query(fs.readFileSync('server/db/migrations/014_whatsapp_phone_ownership.sql','utf8')),e=>e.code==='P0001');
  } finally { await client.query('ROLLBACK'); client.release(); }
  const after = await admin.query("SELECT md5(document::text) AS digest FROM public.app_state WHERE id='runtime'");
  assert.deepEqual(after.rows,before.rows,'existing local runtime must remain unchanged');
  console.log('PASS PostgreSQL real: migrations, competing claims, unique binding, encrypted resumable attempt across restart; public runtime unchanged');
} finally {
  await store?.close();
  if (!/^via_meta_test_[a-f0-9]{16}$/.test(schema)) throw new Error('Invalid disposable test schema');
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
