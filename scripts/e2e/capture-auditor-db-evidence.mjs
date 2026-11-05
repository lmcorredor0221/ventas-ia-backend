// Reads only the completed campaign's disposable local clone.
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
const directory = path.resolve(process.argv[2] ?? '');
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'run-manifest.json'), 'utf8'));
const clone = JSON.parse(await fs.readFile(path.join(directory, 'baseline-clone.json'), 'utf8'));
const source = (await fs.readFile('.env.example', 'utf8')).match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const url = new URL(source);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  || clone.targetDatabase !== `ventas_ia_e2e_${manifest.runId}`
  || manifest.shadow.tenantId !== `e2e_${manifest.runId}`) throw new Error('Only the exact local E2E clone is permitted');
url.pathname = `/${clone.targetDatabase}`;
const pool = new pg.Pool({ connectionString: url.toString(), ssl: false, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN READ ONLY');
  const counters = (await client.query('SELECT metric, value FROM usage_counters WHERE tenant_id=$1 ORDER BY metric', [manifest.shadow.tenantId])).rows;
  const outbox = (await client.query('SELECT kind,status,attempts,created_at,locked_at,processed_at,last_error FROM integration_outbox WHERE tenant_id=$1 ORDER BY created_at', [manifest.shadow.tenantId])).rows;
  const rowCounts = (await client.query('SELECT (SELECT count(*)::int FROM orders WHERE tenant_id=$1) AS orders, (SELECT count(*)::int FROM events WHERE tenant_id=$1) AS events', [manifest.shadow.tenantId])).rows[0];
  await client.query('COMMIT');
  await fs.writeFile(path.join(directory, 'runtime-db-evidence.json'), JSON.stringify({
    readAt: new Date().toISOString(), database: clone.targetDatabase, tenantId: manifest.shadow.tenantId,
    readOnlyTransaction: true, counters, outbox, rowCounts }, null, 2));
  console.log(JSON.stringify({ counters: counters.length, outboxEntries: outbox.length, ...rowCounts }));
} finally { client.release(); await pool.end(); }
