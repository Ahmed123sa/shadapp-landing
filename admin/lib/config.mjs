// Settings for the landing admin. Everything comes from environment variables
// (or a .env file in the project root, never committed).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function loadConfig(env = process.env) {
  loadDotEnv(resolve(root, '.env'));
  const e = env;
  const basePath = (e.BASE_PATH ?? '/shad-app').replace(/\/+$/, '');
  return {
    root,
    port: Number(e.PORT || 3100),
    host: e.HOST || '127.0.0.1',
    basePath,
    dataDir: resolve(e.DATA_DIR || resolve(root, 'data')),
    adminEmail: String(e.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPasswordHash: String(e.ADMIN_PASSWORD_HASH || '').trim(),
    sessionSecret: String(e.SESSION_SECRET || ''),
    sessionHours: Number(e.SESSION_HOURS || 8),
    trustProxy: e.TRUST_PROXY === '1',
    // Serve site/ from this process too. On the server nginx serves it; locally this makes /shad-app/ work.
    serveSite: e.SERVE_SITE !== '0',
  };
}

export function assertConfig(c) {
  const problems = [];
  if (!c.adminEmail) problems.push('ADMIN_EMAIL is not set');
  if (!c.sessionSecret || c.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  if (problems.length) throw new Error('Admin is not configured: ' + problems.join('; ') + '. See .env.example');
}
