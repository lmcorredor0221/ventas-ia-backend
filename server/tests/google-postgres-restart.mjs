import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import {PostgresStore} from '../store/postgresStore.js';
import {SecretVault} from '../services/secretVault.js';

const url = new URL(process.env.POSTGRES_TEST_DATABASE_URL ?? fs.readFileSync('.env.example','utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim());
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/ventas_ia_dev') throw new Error('Local development database only');
const schema = `via_google_test_${crypto.randomBytes(8).toString('hex')}`;
const admin = new pg.Pool({connectionString:url.href,ssl:false});
const stores=[];
try {
  const before=(await admin.query("SELECT md5(document::text) AS hash FROM public.app_state WHERE id='runtime'")).rows;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set('options',`-c search_path=${schema}`);
  const open=async()=>{const s=new PostgresStore({databaseUrl:url.href,ssl:'disable'});stores.push(s);await s.load();return s;};
  const old=await open();
  const fresh=await open();
  const vault=new SecretVault({store:fresh,encryptionKey:'local-google-restart-contract'});
  const ref=vault.saveSecret({tenantId:'andina',name:'google_refresh_token',value:'new-contract-grant'});
  const connection={tenantId:'andina',status:'connected',mode:'live',accountEmail:'contract@example.test',refreshTokenRef:ref,connectedAt:'2026-11-03T18:00:00.000Z'};
  fresh.mutate(s=>{s.googleConnectionsByTenant.andina=connection;});
  await fresh.persistTenantCritical('andina');
  // No full snapshot was needed to persist the encrypted OAuth credential.
  let db=(await fresh.pool.query("SELECT document FROM app_state WHERE id='runtime'")).rows[0].document;
  assert.equal(db.googleConnectionsByTenant.andina.connectedAt,connection.connectedAt);
  assert.ok(db.secretsByRef[ref]);
  assert.equal(JSON.stringify(db).includes('new-contract-grant'),false);
  // Simulates a previous instance writing after OAuth succeeded on another.
  await old.save();
  const reloaded=await open();
  assert.equal(reloaded.getState().googleConnectionsByTenant.andina.connectedAt,connection.connectedAt);
  assert.equal(new SecretVault({store:reloaded,encryptionKey:'local-google-restart-contract'}).readSecret(ref),'new-contract-grant');
  assert.equal((await reloaded.pool.query("SELECT payload FROM google_connections WHERE tenant_id='andina'")).rows[0].payload.connectedAt,connection.connectedAt);
  // A newer revocation must not be undone by a snapshot from before it.
  fresh.mutate(s=>Object.assign(s.googleConnectionsByTenant.andina,{status:'reconnect_required',lastErrorAt:'2026-11-03T18:05:00.000Z'}));
  await fresh.persistTenantCritical('andina');
  await old.persistTenantCritical('andina');
  await reloaded.save();
  db=(await fresh.pool.query("SELECT document FROM app_state WHERE id='runtime'")).rows[0].document;
  assert.equal(db.googleConnectionsByTenant.andina.status,'reconnect_required');
  const hash=(await fresh.pool.query("SELECT md5(document::text) AS hash FROM app_state WHERE id='runtime'")).rows[0].hash;
  await open();
  assert.equal((await fresh.pool.query("SELECT md5(document::text) AS hash FROM app_state WHERE id='runtime'")).rows[0].hash,hash,'existing runtime load must be read-only');
  assert.deepEqual((await admin.query("SELECT md5(document::text) AS hash FROM public.app_state WHERE id='runtime'")).rows,before);
  console.log('Google PostgreSQL restart/race contract passed; public runtime unchanged');
} finally {
  for(const s of stores) await s.close();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
