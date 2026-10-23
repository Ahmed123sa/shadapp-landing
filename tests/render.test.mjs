import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, safeUrl, whatsappUrl, paths } from '../tools/render.mjs';

const seed = () => JSON.parse(readFileSync(paths.content, 'utf8'));

test('the seed renders a complete page with no leftover placeholders', () => {
  const html = render(seed());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.equal(/\{\{(t|meta|link|email|social|config)\b/.test(html), false);
  assert.ok(html.includes('window.SHAD='));
});

test('text is escaped, and only {dot} / {pulse} turn into markup', () => {
  const c = seed();
  c.text['hero.01'] = { ar: '<script>alert(1)</script> {dot}', en: 'a & b {pulse}' };
  const html = render(c);
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; <i class="dot-mark" aria-hidden="true"></i>'));
  assert.ok(html.includes('a &amp; b <i class="dot-mark dot-mark--pulse"'));
});

test('only http(s) URLs are ever written into the page', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl('https://a.com/x?y=1'), 'https://a.com/x?y=1');
  assert.equal(safeUrl('https://a.com/"onmouseover="x'), '');
  const c = seed();
  c.links.client_login = 'javascript:alert(1)';
  const html = render(c);
  assert.ok(!html.includes('javascript:'));
});

test('social: empty entries are hidden, WhatsApp becomes wa.me, bad links are dropped', () => {
  const c = seed();
  c.social = [
    { platform: 'facebook', url: '' },
    { platform: 'instagram', url: 'https://instagram.com/x' },
    { platform: 'whatsapp', number: '+20 100 123 4567' },
    { platform: 'tiktok', url: 'javascript:alert(1)' },
    { platform: 'other', url: 'https://example.com', label: 'Site <b>' },
    { platform: 'nope', url: 'https://x.com' },
  ];
  const html = render(c);
  // instagram, whatsapp and "other" are valid; each shows in the contact block and in the footer
  assert.equal((html.match(/class="social__a"/g) || []).length, 6);
  assert.ok(html.includes('https://wa.me/201001234567'));
  assert.ok(html.includes('https://instagram.com/x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('Site &lt;b&gt;'));
});

test('with no social accounts nothing is rendered for them', () => {
  const c = seed(); c.social = [];
  const html = render(c);
  assert.ok(!html.includes('class="social'));
  assert.ok(!html.includes('{{social'));
});

test('a missing text key is an error, not a blank', () => {
  const c = seed(); delete c.text['hero.01'];
  assert.throws(() => render(c), /hero\.01/);
});

test('the config script cannot be closed early by content', () => {
  const c = seed();
  c.meta.title.en = '</script><b>x';
  const html = render(c);
  const cfg = html.match(/window\.SHAD=(.*?);<\/script>/s)[1];
  assert.ok(!cfg.includes('</script>'));
  assert.equal(JSON.parse(cfg).titles.en, '</script><b>x');
});

test('whatsapp numbers need 8 to 15 digits', () => {
  assert.equal(whatsappUrl('123'), '');
  assert.equal(whatsappUrl('201001234567'), 'https://wa.me/201001234567');
  assert.equal(whatsappUrl('1'.repeat(16)), '');
});
