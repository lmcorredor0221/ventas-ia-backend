import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , envFile, ...tokens] = process.argv;
const overrides = {};

while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
  const token = tokens.shift();
  const index = token.indexOf('=');
  overrides[token.slice(0, index)] = token.slice(index + 1);
}

const [command, ...args] = tokens;

if (!envFile || !command) {
  console.error('Usage: node scripts/run-with-env.mjs <env-file> [KEY=value ...] <command> [...args]');
  process.exit(1);
}

const envPath = path.resolve(process.cwd(), envFile);
const fileEnv = parseEnvFile(envPath);
const childEnv = { ...process.env, ...fileEnv, ...overrides };

if (!childEnv.VITE_GOOGLE_CLIENT_ID && childEnv.GOOGLE_CLIENT_ID) {
  childEnv.VITE_GOOGLE_CLIENT_ID = childEnv.GOOGLE_CLIENT_ID;
}

const child = spawn(resolveCommand(command, childEnv), args, {
  env: childEnv,
  shell: false,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    env[key] = stripQuotes(value);
  }
  return env;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveCommand(command, env) {
  if (process.platform !== 'win32' || path.extname(command)) return command;
  const paths = String(env.PATH ?? env.Path ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const directory of paths) {
    for (const extension of ['.cmd', '.exe', '.bat', '']) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return command;
}
