import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { root, loadConfig } from '../admin/lib/config.mjs';
import { createStore } from '../admin/lib/store.mjs';
import { validateContent } from '../admin/lib/validate.mjs';
import { inspectImage } from '../admin/lib/image.mjs';
import { hashPassword } from '../admin/lib/auth.mjs';
import { createApp } from '../admin/server.mjs';
import { loadPlatforms, render } from '../tools/render.mjs';

/* Synthetic headers: the inspector only reads headers, so these are enough. */
const png = (w, h) => { const b = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => { const b = Buffer.alloc(40); b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0); b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9); return b; };
const webp = (w, h) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(32, 4); b.write('WEBPVP8X', 8, 'latin1'); b.writeUInt32LE(10, 16); const w1 = w - 1, h1 = h - 1; b.set([w1 & 255, (w1 >> 8) & 255, (w1 >> 16) & 255, h1 & 255, (h1 >> 8) & 255, (h1 >> 16) & 255], 24); return b; };

test('inspectImage reads real type and size, and refuses everything else', () => {
  assert.deepEqual(inspectImage(png(1200, 630)), { type: 'png', ext: 'png', width: 1200, height: 630 });
  assert.deepEqual(inspectImage(jpg(800, 1600)), { type: 'jpeg', ext: 'jpg', height: 1600, width: 800 });
  assert.deepEqual(inspectImage(webp(1200, 630)), { type: 'webp', ext: 'webp', width: 1200, height: 630 });
  assert.equal(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(inspectImage(Buffer.from('GIF89a' + 'x'.repeat(40))), null);
  assert.equal(inspectImage(Buffer.from('<?php echo 1; ?>' + ' '.repeat(40))), null);
  assert.equal(inspectImage(Buffer.alloc(0)), null);
});

let tmp, store, seed, platforms, server, base, cookie = '', csrf = '';
const EMAIL = 'admin@example.com', PASS = 'correct-horse-battery';
before(async () => {
  tmp = await mkdtemp(resolve(tmpdir(), 'shad-media-'));
  await cp(resolve(root, 'content'), resolve(tmp, 'content'), { recursive: true });
  await cp(resolve(root, 'template'), resolve(tmp, 'template'), { recursive: true });
  await mkdir(resolve(tmp, 'site'), { recursive: true });
  const dataDir = resolve(tmp, 'data');
  store = createStore({ root: tmp, dataDir });
  seed = await store.seed(); platforms = loadPlatforms();
  const config = { ...loadConfig({}), basePath: '/shad-app', dataDir, adminEmail: EMAIL, adminPasswordHash: await hashPassword(PASS), sessionSecret: 'k'.repeat(48), sessionHours: 1, trustProxy: false, serveSite: false };
  server = createApp(config, { store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/shad-app`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
  cookie = r.headers.get('set-cookie').split(';')[0]; csrf = (await r.json()).csrf;
});
after(async () => { server.close(); await rm(tmp, { recursive: true, force: true }); });

const upload = (slot, buf, { type = 'image/png', token = csrf, auth = true } = {}) =>
  fetch(`${base}/api/media?slot=${slot}`, { method: 'POST', headers: { 'Content-Type': type, ...(auth ? { Cookie: cookie } : {}), 'X-CSRF-Token': token }, body: buf });

test('upload: needs a session and CSRF, takes only real PNG/JPG/WebP of the right shape', async () => {
  assert.equal((await upload('og', png(1200, 630), { auth: false })).status, 401);
  assert.equal((await upload('og', png(1200, 630), { token: '' })).status, 403);
  assert.equal((await upload('nope', png(1200, 630))).status, 422);
  assert.equal((await upload('og', png(1200, 630), { type: 'image/svg+xml' })).status, 415);
  assert.equal((await upload('og', Buffer.from('<svg onload=alert(1)>'.padEnd(60, ' ')))).status, 415, 'a script labelled as png');
  assert.equal((await upload('og', png(300, 200))).status, 422, 'too small');
  assert.equal((await upload('og', png(630, 1200))).status, 422, 'og must be landscape');
  assert.equal((await upload('app_screen', png(1200, 630))).status, 422, 'app screen must be portrait');
  assert.equal((await upload('og', png(9000, 5000))).status, 422, 'too many pixels');
  // the server may close the socket as soon as it sees the limit, so a reset also counts as refused
  const big = await upload('og', Buffer.alloc(4_100_000, 1)).then((r) => r.status, () => 413);
  assert.equal(big, 413, 'too big');
  const ok = await upload('og', png(1200, 630));
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.match(j.file, /^[a-f0-9]{16}\.png$/); assert.equal(j.w, 1200); assert.equal(j.h, 630);
  assert.equal((await upload('app_screen', webp(1080, 2200), { type: 'image/webp' })).status, 200);
  assert.equal((await upload('app_screen', jpg(1080, 2200), { type: 'image/jpeg' })).status, 200);
});

test('an image needs a description, a real file, and shows only after publishing', async () => {
  const j = await (await upload('og', png(1200, 631))).json();
  const c = JSON.parse(JSON.stringify(await store.published()));
  c.images.og = { file: j.file, alt: { ar: '', en: '' }, w: j.w, h: j.h };
  const noAlt = validateContent(c, seed, platforms, { mediaExists: store.mediaExists });
  assert.ok(noAlt.errors.some((e) => e.path === 'images.og.alt.ar') && noAlt.errors.some((e) => e.path === 'images.og.alt.en'));
  c.images.og.alt = { ar: 'صورة المشاركة', en: 'Share image' };
  c.images.app_screen = { file: 'aaaaaaaaaaaaaaaa.png', alt: { ar: 'x', en: 'y' }, w: 10, h: 20 };
  assert.ok(validateContent(c, seed, platforms, { mediaExists: store.mediaExists }).errors.some((e) => e.path === 'images.app_screen.file'), 'file that was never uploaded');
  c.images.app_screen.file = '../../x.png';
  assert.ok(validateContent(c, seed, platforms, { mediaExists: store.mediaExists }).errors.some((e) => e.path === 'images.app_screen.file'), 'path in file name');
  c.images.app_screen = { file: '', alt: { ar: '', en: '' }, w: 0, h: 0 };

  const put = await fetch(base + '/api/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf }, body: JSON.stringify({ content: c }) });
  assert.equal(put.status, 200);
  assert.ok(!(await readFile(resolve(tmp, 'site/index.html'), 'utf8').catch(() => '')).includes(j.file), 'draft must not touch the live page');

  const prev = await fetch(`${base}/preview/`, { headers: { Cookie: cookie } });
  const html = await prev.text();
  assert.ok(html.includes(`content="https://shadmanagement.co/shad-app/media/${j.file}"`), 'og:image in preview');
  const img = await fetch(`${base}/preview/media/${j.file}`, { headers: { Cookie: cookie } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/preview/media/${j.file}`)).status, 401, 'media preview is private');

  const pub = await fetch(base + '/api/publish', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf } });
  assert.equal(pub.status, 200);
  assert.ok((await readFile(resolve(tmp, 'site/index.html'), 'utf8')).includes('og:image'));
  await access(resolve(tmp, 'site/media', j.file)); // copied where nginx serves it
});

test('render: no image keeps the page exactly as before; app screenshot replaces the drawn phone', async () => {
  const base0 = JSON.parse(JSON.stringify(await store.published()));
  base0.images = {};
  const plain = render(base0, { template: await readFile(resolve(tmp, 'template/index.tpl.html'), 'utf8') });
  assert.ok(!plain.includes('og:image') && !plain.includes('twitter:card') && !plain.includes('<!--shot'));
  assert.ok(plain.includes('class="phone-wrap" aria-hidden="true"'));
  const withShot = JSON.parse(JSON.stringify(base0));
  withShot.images = { app_screen: { file: 'abcdef0123456789.webp', alt: { ar: 'شاشة "الإشعارات"', en: 'Notifications <screen>' }, w: 1080, h: 2200 } };
  const html = render(withShot, { template: await readFile(resolve(tmp, 'template/index.tpl.html'), 'utf8') });
  assert.ok(html.includes('src="media/abcdef0123456789.webp"') && html.includes('width="1080" height="2200"'));
  assert.ok(html.includes('alt="شاشة &quot;الإشعارات&quot;"') && html.includes('alt="Notifications &lt;screen&gt;"'), 'alt text is escaped');
  assert.ok(!html.includes('class="notifs"'), 'drawn phone is gone');
  assert.ok(!html.includes('aria-hidden="true"><div class="phone phone--shot"'), 'a real picture is not hidden from screen readers');
});
