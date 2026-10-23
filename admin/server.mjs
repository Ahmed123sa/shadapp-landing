#!/usr/bin/env node
// The landing admin: one small Node server, no dependencies.
//   /shad-app/admin/      the editor (login first)
//   /shad-app/api/*       JSON API used by the editor
//   /shad-app/preview/    the draft rendered as the real page
// Behind nginx only these three prefixes are proxied here; nginx serves site/ itself.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, assertConfig, root } from './lib/config.mjs';
import { createStore } from './lib/store.mjs';
import { validateContent, limitsFor } from './lib/validate.mjs';
import { inspectImage } from './lib/image.mjs';
import { IMAGE_SLOTS } from '../tools/render.mjs';
import { hashPassword, verifyPassword, createToken, readToken, csrfFor, checkCsrf, RateLimiter } from './lib/auth.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const PREVIEW_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'self'";
const MAX_BODY = 1_000_000;
const MAX_IMAGE = 4_000_000;
const MAX_SIDE = 6000;

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

export function createApp(config, { store = createStore({ root, dataDir: config.dataDir }) } = {}) {
  const BASE = config.basePath;
  const limiter = new RateLimiter({ max: 5, windowMs: 15 * 60_000 });
  const adminPublic = resolve(root, 'admin/public');
  const siteDir = resolve(root, 'site');

  const securityHeaders = (csp) => ({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': csp.includes("frame-ancestors 'self'") ? 'SAMEORIGIN' : 'DENY',
    'Cache-Control': 'no-store',
  });

  const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { ...securityHeaders(ADMIN_CSP), 'Content-Type': 'application/json; charset=utf-8' });

  const clientIp = (req) => {
    if (config.trustProxy) { const f = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
    return req.socket.remoteAddress || 'unknown';
  };
  const isHttps = (req) => config.trustProxy ? String(req.headers['x-forwarded-proto'] || '') === 'https' : !!req.socket.encrypted;

  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0]));

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'الطلب كبير جدًا'); chunks.push(c); }
    if (!chunks.length) return {};
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON only');
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON غير صالح'); }
  }

  async function readRaw(req, limit) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, `الصورة أكبر من ${Math.round(limit / 1e6)} ميجا`); chunks.push(c); }
    return Buffer.concat(chunks);
  }

  async function currentHash() { const a = await store.readAdmin(); return a.passwordHash || config.adminPasswordHash; }
  async function currentSv() { return (await store.readAdmin()).sv || 1; }

  async function session(req) {
    const token = cookies(req).shad_admin;
    const data = readToken(config.sessionSecret, token);
    if (!data || data.email !== config.adminEmail || data.sv !== (await currentSv())) return null;
    return { ...data, token, csrf: csrfFor(config.sessionSecret, token) };
  }

  async function mustBeSignedIn(req, { change = false } = {}) {
    const s = await session(req);
    if (!s) throw new HttpError(401, 'سجّل الدخول');
    if (change && !checkCsrf(config.sessionSecret, s.token, req.headers['x-csrf-token'])) throw new HttpError(403, 'الطلب مرفوض، حدّث الصفحة وجرّب تاني');
    return s;
  }

  function setCookie(req, res, token, maxAgeSec) {
    const parts = [`shad_admin=${token}`, `Path=${BASE}`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
    if (isHttps(req)) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  async function serveFile(res, dir, rel, { headers = {}, transform } = {}) {
    const file = resolve(dir, '.' + sep + decodeURIComponent(rel).replace(/^\/+/, ''));
    if (file !== dir && !file.startsWith(dir + sep)) throw new HttpError(404, 'Not found');
    let target = file;
    try { if ((await stat(file)).isDirectory()) target = resolve(file, 'index.html'); } catch { throw new HttpError(404, 'Not found'); }
    let data;
    try { data = await readFile(target); } catch { throw new HttpError(404, 'Not found'); }
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    if (transform && /\.(html|css|js)$/.test(target)) data = Buffer.from(transform(data.toString('utf8')), 'utf8');
    send(res, 200, data, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...headers });
  }

  const withBase = (text) => text.replaceAll('__BASE__', BASE);

  async function contentPayload() {
    const [seed, published, draft] = await Promise.all([store.seed(), store.published(), store.draft()]);
    const platforms = store.platforms().map(({ id, label, kind }) => ({ id, label, kind }));
    return {
      published, draft, hasDraft: !!draft,
      dirty: !!draft && JSON.stringify(draft) !== JSON.stringify(published),
      limits: limitsFor(seed), platforms,
      imageSlots: Object.entries(IMAGE_SLOTS).map(([id, v]) => ({ id, ...v })),
      sections: seed.sections,
    };
  }

  async function api(req, res, rel, url) {
    const method = req.method;
    if (rel === '/api/login' && method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const ipKey = 'ip:' + clientIp(req), mailKey = 'mail:' + email;
      const wait = Math.max(limiter.blockedFor(ipKey), limiter.blockedFor(mailKey));
      if (wait) { res.setHeader('Retry-After', Math.ceil(wait / 1000)); throw new HttpError(429, `محاولات كتير غلط. جرّب تاني بعد ${Math.ceil(wait / 60000)} دقيقة`); }
      const hash = await currentHash();
      const okPass = hash ? await verifyPassword(String(body.password || ''), hash) : false;
      if (!(okPass && email === config.adminEmail)) {
        limiter.fail(ipKey); limiter.fail(mailKey);
        throw new HttpError(401, 'الإيميل أو كلمة المرور غير صحيحة');
      }
      limiter.clear(ipKey); limiter.clear(mailKey);
      const token = createToken(config.sessionSecret, { email, sv: await currentSv(), hours: config.sessionHours });
      setCookie(req, res, token, config.sessionHours * 3600);
      return sendJson(res, 200, { email, csrf: csrfFor(config.sessionSecret, token) });
    }
    if (rel === '/api/logout' && method === 'POST') {
      await mustBeSignedIn(req, { change: true });
      setCookie(req, res, '', 0);
      return sendJson(res, 200, { ok: true });
    }
    if (rel === '/api/me' && method === 'GET') {
      const s = await mustBeSignedIn(req);
      return sendJson(res, 200, { email: s.email, csrf: s.csrf });
    }
    if (rel === '/api/content' && method === 'GET') { await mustBeSignedIn(req); return sendJson(res, 200, await contentPayload()); }

    if (rel === '/api/draft' && method === 'PUT') {
      await mustBeSignedIn(req, { change: true });
      const body = await readBody(req);
      const v = validateContent(body.content, await store.seed(), store.platforms(), { mediaExists: store.mediaExists });
      if (!v.ok) return sendJson(res, 422, { errors: v.errors });
      await store.saveDraft(v.value);
      const published = await store.published();
      return sendJson(res, 200, { ok: true, dirty: JSON.stringify(v.value) !== JSON.stringify(published) });
    }
    if (rel === '/api/draft' && method === 'DELETE') {
      await mustBeSignedIn(req, { change: true });
      await store.discardDraft();
      return sendJson(res, 200, { ok: true });
    }
    if (rel === '/api/publish' && method === 'POST') {
      await mustBeSignedIn(req, { change: true });
      const draft = await store.draft();
      if (!draft) throw new HttpError(409, 'مفيش تعديلات محفوظة تتنشر');
      const v = validateContent(draft, await store.seed(), store.platforms(), { mediaExists: store.mediaExists });
      if (!v.ok) return sendJson(res, 422, { errors: v.errors });
      const { id } = await store.publish(v.value);
      return sendJson(res, 200, { ok: true, id });
    }
    if (rel === '/api/media' && method === 'POST') {
      await mustBeSignedIn(req, { change: true });
      const slot = url.searchParams.get('slot') || '';
      const spec = IMAGE_SLOTS[slot];
      if (!spec) throw new HttpError(422, 'مكان الصورة غير معروف');
      if (!/^image\/(png|jpeg|webp)$/.test(String(req.headers['content-type'] || ''))) throw new HttpError(415, 'الصور المقبولة: PNG أو JPG أو WebP');
      const buf = await readRaw(req, MAX_IMAGE);
      const info = inspectImage(buf);
      if (!info) throw new HttpError(415, 'الملف ده مش صورة PNG أو JPG أو WebP سليمة');
      if (info.width > MAX_SIDE || info.height > MAX_SIDE) throw new HttpError(422, `الصورة كبيرة (${info.width}×${info.height}). الحد الأقصى ${MAX_SIDE} بكسل في أي اتجاه`);
      if (info.width < spec.minWidth) throw new HttpError(422, `الصورة صغيرة (${info.width} بكسل عرض). المطلوب ${spec.minWidth} على الأقل، والأفضل ${spec.rec}`);
      if (spec.shape === 'landscape' && info.width <= info.height) throw new HttpError(422, 'الصورة دي لازم تكون عريضة (الطول أصغر من العرض)');
      if (spec.shape === 'portrait' && info.height <= info.width) throw new HttpError(422, 'الصورة دي لازم تكون طولية (الطول أكبر من العرض)');
      const file = await store.saveMedia(buf, info.ext);
      return sendJson(res, 200, { file, w: info.width, h: info.height });
    }
    if (rel === '/api/versions' && method === 'GET') { await mustBeSignedIn(req); return sendJson(res, 200, { versions: await store.listVersions() }); }
    if (rel === '/api/versions/restore' && method === 'POST') {
      await mustBeSignedIn(req, { change: true });
      const body = await readBody(req);
      const content = await store.getVersion(body.id);
      if (!content) throw new HttpError(404, 'النسخة مش موجودة');
      const v = validateContent(content, await store.seed(), store.platforms(), { mediaExists: store.mediaExists });
      if (!v.ok) return sendJson(res, 422, { errors: v.errors });
      await store.saveDraft(v.value);
      return sendJson(res, 200, { ok: true });
    }
    if (rel === '/api/password' && method === 'POST') {
      await mustBeSignedIn(req, { change: true });
      const body = await readBody(req);
      const next = String(body.next || '');
      if (!(await verifyPassword(String(body.current || ''), await currentHash()))) throw new HttpError(403, 'كلمة المرور الحالية غلط');
      if (next.length < 10) throw new HttpError(422, 'كلمة المرور الجديدة لازم تكون 10 حروف على الأقل');
      const a = await store.readAdmin();
      await store.writeAdmin({ ...a, passwordHash: await hashPassword(next), sv: (a.sv || 1) + 1 });
      setCookie(req, res, '', 0); // every session, including this one, ends
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, 'Not found');
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (path !== BASE && !path.startsWith(BASE + '/')) throw new HttpError(404, 'Not found');
    const rel = path.slice(BASE.length) || '/';

    if (rel.startsWith('/api/')) return api(req, res, rel, url);

    if (rel === '/admin') return send(res, 301, '', { Location: `${BASE}/admin/` });
    if (rel === '/admin/' ) return serveFile(res, adminPublic, 'index.html', { headers: securityHeaders(ADMIN_CSP), transform: withBase });
    if (rel.startsWith('/admin/assets/')) return serveFile(res, adminPublic, rel.slice('/admin/'.length), { headers: { 'Cache-Control': 'no-cache' }, transform: withBase });

    if (rel === '/preview') return send(res, 301, '', { Location: `${BASE}/preview/` });
    if (rel.startsWith('/preview/')) {
      await mustBeSignedIn(req);
      if (rel === '/preview/') {
        const content = (await store.draft()) ?? (await store.published());
        return send(res, 200, await store.renderHtml(content), { ...securityHeaders(PREVIEW_CSP), 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' });
      }
      if (rel.startsWith('/preview/media/')) {
        const name = rel.slice('/preview/media/'.length);
        const dir = existsSync(resolve(store.paths.media, name)) ? store.paths.media : store.paths.seedMedia;
        return serveFile(res, dir, name, { headers: { 'Cache-Control': 'private, max-age=300' } });
      }
      return serveFile(res, siteDir, rel.slice('/preview/'.length), { headers: { 'Cache-Control': 'no-cache' } });
    }

    if (config.serveSite && (req.method === 'GET' || req.method === 'HEAD')) {
      return serveFile(res, siteDir, rel === '/' ? 'index.html' : rel.replace(/^\//, ''), { headers: { 'Cache-Control': 'no-cache' } });
    }
    throw new HttpError(404, 'Not found');
  }

  return createServer((req, res) => {
    handler(req, res).catch((e) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...e.extra });
      console.error('[admin]', e);
      sendJson(res, 500, { error: 'حصل خطأ في السيرفر' });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  assertConfig(config);
  createApp(config).listen(config.port, config.host, () => console.log(`Landing admin on http://${config.host}:${config.port}${config.basePath}/admin/`));
}
