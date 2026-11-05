// Local-only launcher: credentials stay in the child environment, never in evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const destination = path.resolve(process.env.E2E_RESULT_DIR ?? 'test-results/contextual50-auditor-corregido-20261105');
await fs.mkdir(destination, { recursive: true });
const secret = (await fs.readFile('APIKEYTEST.txt', 'utf8')).match(/sk-[A-Za-z0-9_-]+/)?.[0];
if (!secret) throw new Error('Missing local DeepSeek credential');
const database = (await fs.readFile('.env.example', 'utf8')).match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!database || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)) throw new Error('Local PostgreSQL required');
const files = (await fs.readdir('server', { recursive: true })).filter(f => /\.(js|mjs|md)$/.test(f)).sort();
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async f => [f,
  crypto.createHash('sha256').update(await fs.readFile(path.join('server', f))).digest('hex')])));
const before = await hashes();
const env = { ...process.env, DEEPSEEK_API_KEY: secret, E2E_SOURCE_DATABASE_URL: database,
  LLM_GROUNDING_ENABLED: 'true', LLM_ORDER_AUDIT_ENABLED: 'true', LLM_ORDER_AUDIT_TIMEOUT_MS: '5000',
  LLM_RESPONSE_COMPOSER_ENABLED: 'true', LLM_REQUEST_TIMEOUT_MS: '30000',
  DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-chat', DATABASE_SSL: 'disable',
  E2E_RESULT_DIR: path.relative(root, destination), E2E_MAX_DEEPSEEK_CALLS: '1200',
  E2E_RESPONSE_TARGET_MS: '8000', E2E_CASE_IDS: process.env.E2E_CASE_IDS ?? '' };
delete env.LLM_SIMULATOR;
const manifest = { startedAt: new Date().toISOString(), auditorEnabled: true, groundingEnabled: true,
  auditTimeoutMs: 5000, interpretationTimeoutMs: 30000, responseTargetMs: 8000,
  caseIds: env.E2E_CASE_IDS || 'all50', before };
await fs.writeFile(path.join(destination, 'execution-source-hashes.json'), JSON.stringify(manifest, null, 2));
const log = await fs.open(path.join(destination, 'campaign.log'), 'w');
console.log(`Starting local cases (${env.E2E_CASE_IDS || 'all 50'}); progress: ${path.relative(root, destination)}/campaign.log`);
const child = spawn(process.execPath, ['server/tests/run-contextual-e2e.mjs'], { cwd: root, env,
  stdio: ['ignore', log.fd, log.fd], windowsHide: true });
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
await log.close();
manifest.after = await hashes();
manifest.sourcesUnchanged = JSON.stringify(before) === JSON.stringify(manifest.after);
manifest.finishedAt = new Date().toISOString();
manifest.exitCode = code;
await fs.writeFile(path.join(destination, 'execution-source-hashes.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ exitCode: code, sourcesUnchanged: manifest.sourcesUnchanged }));
process.exitCode = code ?? 1;
