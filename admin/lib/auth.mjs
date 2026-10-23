// Password hashing (scrypt), signed session tokens, CSRF tokens, login rate limit.
// Uses node:crypto only, so there is nothing to install.
import { scrypt as scryptCb, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const want = Buffer.from(hashB64, 'base64');
  const got = await scrypt(String(password), salt, want.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');

/** A signed, expiring token: payload.signature. `sv` is bumped when the password changes, which ends every older session. */
export function createToken(secret, { email, sv, hours }, now = Date.now()) {
  const payload = b64u(JSON.stringify({ e: email, sv, exp: now + hours * 3600_000 }));
  return `${payload}.${sign(secret, payload)}`;
}

export function readToken(secret, token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = sign(secret, payload);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp < now) return null;
    return { email: data.e, sv: data.sv, exp: data.exp };
  } catch { return null; }
}

/** CSRF token bound to the session token; the UI sends it in a header on every change. */
export const csrfFor = (secret, token) => sign(secret, 'csrf:' + token);

export function checkCsrf(secret, token, header) {
  if (!token || !header) return false;
  const want = Buffer.from(csrfFor(secret, token)), got = Buffer.from(String(header));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Counts failed sign-ins per key (IP and e-mail) in a sliding window. */
export class RateLimiter {
  constructor({ max = 5, windowMs = 15 * 60_000 } = {}) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  _recent(key, now) {
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  blockedFor(key, now = Date.now()) {
    const list = this._recent(key, now);
    return list.length >= this.max ? this.windowMs - (now - list[0]) : 0;
  }
  fail(key, now = Date.now()) { const list = this._recent(key, now); list.push(now); this.hits.set(key, list); }
  clear(key) { this.hits.delete(key); }
}
