import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { root, loadConfig } from '../admin/lib/config.mjs';
import { createStore } from '../admin/lib/store.mjs';
import { validateContent, limitsFor } from '../admin/lib/validate.mjs';
import { hashPassword, verifyPassword, createToken, readToken, csrfFor, checkCsrf, RateLimiter } from '../admin/lib/auth.mjs';
import { createApp } from '../admin/server.mjs';
import { loadPlatforms } from '../tools/render.mjs';

let tmp, store, seed, platforms;
before(async () => {
  tmp = await mkdtemp(resolve(tmpdir(), 'shad-landing-'));
  await cp(resolve(root, 'content'), resolve(tmp, 'content'), { recursive: true });
  await cp(resolve(root, 'template'), resolve(tmp, 'template'), { recursive: true });
  await mkdir(resolve(tmp, 'site'), { recursive: true });
  store = createStore({ root: tmp, dataDir: resolve(tmp, 'data') });
  seed = await store.seed();
  platforms = loadPlatforms();
});
after(() => rm(tmp, { recursive: true, force: true }));

const fresh = () => JSON.parse(JSON.stringify(seed));

/* ---------------------------------------------------------------- validate */
test('the seed is valid as shipped', () => {
  const r = validateContent(fresh(), seed, platforms);
  assert.deepEqual(r.errors, []);
});

test('a missing text, an over-long text and a stray brace are all refused', () => {
  const c = fresh();
  delete c.text['hero.01'];
  c.text['hero.02'].ar = 'ا'.repeat(500);
  c.text['hero.03'].en = 'bad {script} here';
  const r = validateContent(c, seed, platforms);
  const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('text.hero.01.ar') && paths.includes('text.hero.01.en'));
  assert.ok(paths.includes('text.hero.02.ar'));
  assert.ok(paths.includes('text.hero.03.en'));
});

test('links, e-mails and social entries are checked', () => {
  const c = fresh();
  c.links.client_login = 'http://insecure.example';
  c.links.play = 'not a url';
  c.emails.support = 'nope';
  c.social = [{ platform: 'facebook', url: 'javascript:alert(1)' }, { platform: 'myspace', url: 'https://x.com' }, { platform: 'whatsapp', number: '12' }, { platform: 'other', url: 'https://x.com', label: '' }];
  const paths = validateContent(c, seed, platforms).errors.map((e) => e.path);
  for (const p of ['links.client_login', 'links.play', 'emails.support', 'social.0.url', 'social.1', 'social.2.number', 'social.3.label']) assert.ok(paths.includes(p), p);
});

test('unknown keys are dropped, not saved', () => {
  const c = fresh(); c.text['evil.key'] = { ar: 'x', en: 'y' }; c.extra = 1;
  const r = validateContent(c, seed, platforms);
  assert.equal(r.value.text['evil.key'], undefined);
  assert.equal(r.value.extra, undefined);
});

test('limits come from the seed length, never below 40', () => {
  const l = limitsFor(seed);
  assert.ok(Object.values(l.text).every((v) => v.ar >= 40 && v.en >= 40));
});

/* ---------------------------------------------------------------- auth */
test('passwords: right one passes, wrong one fails, hashes are salted', async () => {
  const h1 = await hashPassword('correct-horse-battery'), h2 = await hashPassword('correct-horse-battery');
  assert.notEqual(h1, h2);
  assert.equal(await verifyPassword('correct-horse-battery', h1), true);
  assert.equal(await verifyPassword('wrong', h1), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('tokens: expire, cannot be tampered with, and carry a CSRF token that matches only them', () => {
  const secret = 's'.repeat(40), now = 1_000_000;
  const t = createToken(secret, { email: 'a@b.c', sv: 1, hours: 1 }, now);
  assert.equal(readToken(secret, t, now + 1000).email, 'a@b.c');
  assert.equal(readToken(secret, t, now + 2 * 3600_000), null);
  assert.equal(readToken(secret, t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), now), null);
  assert.equal(readToken('x'.repeat(40), t, now), null);
  assert.equal(checkCsrf(secret, t, csrfFor(secret, t)), true);
  assert.equal(checkCsrf(secret, t, csrfFor(secret, t + 'x')), false);
  assert.equal(checkCsrf(secret, t, ''), false);
});

test('rate limiter blocks after the limit and forgets after the window', () => {
  const r = new RateLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) { assert.equal(r.blockedFor('k', 0), 0); r.fail('k', 0); }
  assert.ok(r.blockedFor('k', 10) > 0);
  assert.equal(r.blockedFor('k', 2000), 0);
});

/* ---------------------------------------------------------------- store */
test('publish writes the page, the live content and a version; a bad render writes nothing', async () => {
  const c = fresh(); c.text['hero.01'].ar = 'نص جديد';
  const { id } = await store.publish(validateContent(c, seed, platforms).value);
  assert.ok((await readFile(store.paths.site, 'utf8')).includes('نص جديد'));
  assert.equal((await store.published()).text['hero.01'].ar, 'نص جديد');
  assert.equal((await store.listVersions())[0].id, id);
  assert.equal((await store.getVersion(id)).text['hero.01'].ar, 'نص جديد');
  assert.equal(await store.getVersion('../../etc/passwd'), null);

  const before = await readFile(store.paths.site, 'utf8');
  const broken = fresh(); delete broken.text['hero.01'];
  await assert.rejects(store.publish(broken));
  assert.equal(await readFile(store.paths.site, 'utf8'), before);
  assert.equal((await readdir(store.paths.versions)).length, 1);
});

/* ---------------------------------------------------------------- server */
let server, base, dataDir2, cookie = '', csrf = '';
const EMAIL = 'admin@example.com', PASS = 'correct-horse-battery';

async function call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...(auth && csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.clone().json(); } catch { /* not json */ }
  return { res, status: res.status, json };
}

test('server: sign-in, session, CSRF, validation, publish, rate limit, password change', async (t) => {
  dataDir2 = resolve(tmp, 'data2');
  const config = { ...loadConfig({}), basePath: '/shad-app', dataDir: dataDir2, adminEmail: EMAIL, adminPasswordHash: await hashPassword(PASS), sessionSecret: 'k'.repeat(48), sessionHours: 1, trustProxy: false, serveSite: false };
  server = createApp(config, { store: createStore({ root: tmp, dataDir: dataDir2 }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/shad-app`;
  t.after(() => server.close());

  await t.test('nothing works without a session', async () => {
    for (const p of ['/api/me', '/api/content', '/api/versions', '/preview/']) assert.equal((await call(p, { auth: false })).status, 401, p);
    assert.equal((await call('/api/draft', { method: 'PUT', body: {}, auth: false })).status, 401);
  });

  await t.test('security headers and the admin page', async () => {
    const r = await call('/admin/', { auth: false });
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(r.res.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await call('/admin', { auth: false })).status, 301);
  });

  await t.test('path traversal is refused', async () => {
    for (const p of ['/admin/assets/../../../.env', '/admin/assets/%2e%2e/%2e%2e/package.json', '/preview/..%2f..%2fpackage.json']) assert.ok([401, 404].includes((await call(p, { auth: false })).status), p);
  });

  await t.test('wrong password is refused with a clear message, right one sets a hardened cookie', async () => {
    const bad = await call('/api/login', { method: 'POST', body: { email: EMAIL, password: 'nope' }, auth: false });
    assert.equal(bad.status, 401); assert.ok(bad.json.error);
    const ok = await call('/api/login', { method: 'POST', body: { email: EMAIL.toUpperCase(), password: PASS }, auth: false });
    assert.equal(ok.status, 200);
    const sc = ok.res.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Path=\/shad-app/);
    cookie = sc.split(';')[0]; csrf = ok.json.csrf;
    assert.equal((await call('/api/me')).json.email, EMAIL);
  });

  await t.test('a change without the CSRF header is refused', async () => {
    assert.equal((await call('/api/draft', { method: 'DELETE', headers: { 'X-CSRF-Token': '' } })).status, 403);
  });

  await t.test('draft: invalid is 422 with paths, valid is saved and kept out of the live page', async () => {
    const c = (await call('/api/content')).json.published;
    const bad = JSON.parse(JSON.stringify(c)); bad.text['hero.01'].ar = '';
    const r1 = await call('/api/draft', { method: 'PUT', body: { content: bad } });
    assert.equal(r1.status, 422); assert.ok(r1.json.errors.some((e) => e.path === 'text.hero.01.ar'));
    const good = JSON.parse(JSON.stringify(c)); good.text['hero.01'].ar = 'مسودة';
    const r2 = await call('/api/draft', { method: 'PUT', body: { content: good } });
    assert.equal(r2.status, 200); assert.equal(r2.json.dirty, true);
    assert.ok(!(await readFile(resolve(tmp, 'site/index.html'), 'utf8').catch(() => '')).includes('مسودة'));
    const pv = await call('/preview/');
    assert.equal(pv.status, 200); assert.ok((await pv.res.text()).includes('مسودة'));
  });

  await t.test('publish makes it live and lists a version; restore puts an old one back as a draft', async () => {
    const r = await call('/api/publish', { method: 'POST' });
    assert.equal(r.status, 200);
    assert.ok((await readFile(resolve(tmp, 'site/index.html'), 'utf8')).includes('مسودة'));
    const v = (await call('/api/versions')).json.versions;
    assert.ok(v.length >= 1);
    assert.equal((await call('/api/publish', { method: 'POST' })).status, 409); // nothing new to publish
    assert.equal((await call('/api/versions/restore', { method: 'POST', body: { id: '../x' } })).status, 404);
    assert.equal((await call('/api/versions/restore', { method: 'POST', body: { id: v[v.length - 1].id } })).status, 200);
  });

  await t.test('password change needs the current one, ends every session, and the new one works', async () => {
    assert.equal((await call('/api/password', { method: 'POST', body: { current: 'wrong', next: 'a-new-long-password' } })).status, 403);
    assert.equal((await call('/api/password', { method: 'POST', body: { current: PASS, next: 'short' } })).status, 422);
    assert.equal((await call('/api/password', { method: 'POST', body: { current: PASS, next: 'a-new-long-password' } })).status, 200);
    assert.equal((await call('/api/me')).status, 401);
    assert.equal((await call('/api/login', { method: 'POST', body: { email: EMAIL, password: PASS }, auth: false })).status, 401);
    assert.equal((await call('/api/login', { method: 'POST', body: { email: EMAIL, password: 'a-new-long-password' }, auth: false })).status, 200);
  });

  await t.test('after five wrong attempts the sixth is blocked even with the right password', async () => {
    let last;
    for (let i = 0; i < 5; i++) last = await call('/api/login', { method: 'POST', body: { email: EMAIL, password: 'bad' + i }, auth: false });
    assert.equal(last.status, 401);
    const blocked = await call('/api/login', { method: 'POST', body: { email: EMAIL, password: 'a-new-long-password' }, auth: false });
    assert.equal(blocked.status, 429); assert.ok(blocked.res.headers.get('retry-after'));
  });
});
