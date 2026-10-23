#!/usr/bin/env node
// Builds site/index.html from template/index.tpl.html + content/content.json.
//   node tools/render.mjs            writes site/index.html
//   import { render } from './render.mjs'   (the admin uses this for preview/publish)
//
// Placeholders in the template:
//   {{t:key}}            bilingual text from content.text[key]   ({dot} / {pulse} become the dot mark)
//   {{meta:name}}        Arabic meta text (head)
//   {{link:name}}        a URL from content.links (only http/https is ever written)
//   {{email:name}}       an address from content.emails
//   {{social:contact}}   the social icons block for the contact section, or nothing if there are none
//   {{social:foot}}      the same icons for the footer
//   {{og:image}} {{og:alt}} {{og:card}}   the share image (lines are dropped when there is none)
//   <!--shot:app_screen-->...<!--/shot-->   replaced by the uploaded app screenshot when there is one
//   {{config}}           window.SHAD = { titles, descriptions, stores }, read by site.js
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  template: resolve(root, 'template/index.tpl.html'),
  content: resolve(root, 'content/content.json'),
  platforms: resolve(root, 'tools/platforms.json'),
  out: resolve(root, 'site/index.html'),
};

/** Where uploaded pictures can go. `shape` is checked on upload; `w`/`h` are the recommended size. */
export const IMAGE_SLOTS = {
  og: { label: 'صورة المشاركة', shape: 'landscape', minWidth: 600, rec: '1200 × 630', hint: 'بتظهر لما حد يبعت رابط الصفحة على واتساب أو فيسبوك. عريضة (أفقية).' },
  app_screen: { label: 'صورة التطبيق', shape: 'portrait', minWidth: 300, rec: '1080 × 2200', hint: 'بتحل محل رسمة الموبايل في قسم التطبيق. لقطة شاشة طولية (رأسية).' },
};
export const MEDIA_FILE = /^[a-f0-9]{16}\.(png|jpg|webp)$/;
export const SITE_URL = (process.env.SITE_URL || 'https://shadmanagement.co/shad-app/').replace(/\/?$/, '/');

/** Every slot present, in a fixed shape, so equal content always compares equal. */
export function canonImages(raw) {
  const out = {};
  for (const slot of Object.keys(IMAGE_SLOTS)) {
    const e = raw?.[slot] || {};
    const file = typeof e.file === 'string' && MEDIA_FILE.test(e.file) ? e.file : '';
    out[slot] = {
      file,
      alt: { ar: file ? String(e.alt?.ar ?? '') : '', en: file ? String(e.alt?.en ?? '') : '' },
      w: file ? Number(e.w) || 0 : 0,
      h: file ? Number(e.h) || 0 : 0,
    };
  }
  return out;
}

/** Copies the pictures the content uses from the admin's media folder into site/media (what nginx serves). */
export function syncMedia(content, mediaDir, siteMediaDir = resolve(root, 'site/media')) {
  for (const e of Object.values(canonImages(content.images))) {
    if (!e.file) continue;
    const from = resolve(mediaDir, e.file);
    if (!existsSync(from)) continue;
    mkdirSync(siteMediaDir, { recursive: true });
    copyFileSync(from, resolve(siteMediaDir, e.file));
  }
}

export const loadPlatforms = () => JSON.parse(readFileSync(paths.platforms, 'utf8')).platforms;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only real web addresses are ever written into a page. */
export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\/[^\s"'<>]+$/i.test(s)) return '';
  try { new URL(s); } catch { return ''; }
  return s;
}

export function whatsappUrl(number) {
  const digits = String(number || '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : '';
}

const richText = (s) => esc(s).replace(/\{pulse\}/g, '<i class="dot-mark dot-mark--pulse" aria-hidden="true"></i>').replace(/\{dot\}/g, '<i class="dot-mark" aria-hidden="true"></i>');

function socialItems(content, platforms) {
  const byId = Object.fromEntries(platforms.map((p) => [p.id, p]));
  const items = [];
  for (const e of content.social || []) {
    const p = byId[e.platform];
    if (!p) continue;
    const url = p.kind === 'phone' ? whatsappUrl(e.number) : safeUrl(e.url);
    if (!url) continue;
    const label = p.id === 'other' ? String(e.label || '').trim() : p.label;
    if (!label) continue;
    items.push({ p, url, label });
  }
  return items;
}

function socialList(items, mod) {
  const li = items.map(({ p, url, label }) => {
    const svg = p.icon
      ? `<svg class="ico ico--social" viewBox="0 0 24 24" aria-hidden="true"><path d="${p.icon}"/></svg>`
      : `<svg class="ico ico--social ico--stroke" viewBox="0 0 24 24" aria-hidden="true">${p.stroke}</svg>`;
    return `<li><a class="social__a" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${svg}<span class="sr-only">${esc(label)}</span></a></li>`;
  }).join('');
  return `<ul class="social social--${mod}">${li}</ul>`;
}

export function render(content, { template, platforms } = {}) {
  const tpl = template ?? readFileSync(paths.template, 'utf8');
  const plat = platforms ?? loadPlatforms();
  const items = socialItems(content, plat);
  const pair = (k) => {
    const v = content.text?.[k];
    if (!v) throw new Error(`content.text is missing "${k}"`);
    return `<span class="ar">${richText(v.ar ?? '')}</span><span class="en" lang="en">${richText(v.en ?? '')}</span>`;
  };
  const config = () => {
    const stores = { play: safeUrl(content.links?.play), apple: safeUrl(content.links?.apple) };
    const titles = { ar: content.meta.title.ar, en: content.meta.title.en };
    const descriptions = { ar: content.meta.description.ar, en: content.meta.description.en };
    const json = JSON.stringify({ titles, descriptions, stores }).replace(/</g, '\\u003c');
    return `<script>window.SHAD=${json};</script>`;
  };
  const imgs = canonImages(content.images);
  const og = imgs.og;
  let source = items.length ? tpl : tpl.replace(/^[ \t]*\{\{social:\w+\}\}\r?\n/gm, '');
  if (!og.file) source = source.replace(/^[ \t]*<meta[^\n]*\{\{og:\w+\}\}[^\n]*\r?\n/gm, '');
  const shot = imgs.app_screen;
  source = source.replace(/<!--shot:app_screen-->([\s\S]*?)<!--\/shot-->/, (all, inner) => {
    if (!shot.file) return inner;
    const dims = shot.w && shot.h ? ` width="${shot.w}" height="${shot.h}"` : '';
    const img = (lang) => `<img class="${lang}"${lang === 'en' ? ' lang="en"' : ''} src="media/${shot.file}" alt="${esc(shot.alt[lang])}"${dims} loading="lazy" decoding="async">`;
    return `<div class="phone-wrap"><div class="phone phone--shot">${img('ar')}${img('en')}</div></div>`;
  });
  return source.replace(/\{\{(\w+):?([\w.]*)\}\}/g, (all, kind, name) => {
    switch (kind) {
      case 't': return pair(name);
      case 'meta': {
        const m = content.meta?.[name];
        if (!m) throw new Error(`content.meta is missing "${name}"`);
        return esc(m.ar);
      }
      case 'link': return esc(safeUrl(content.links?.[name]) || '#');
      case 'email': {
        const v = String(content.emails?.[name] || '').trim();
        if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v)) throw new Error(`content.emails.${name} is not a valid address`);
        return esc(v);
      }
      case 'social': {
        if (!items.length) return '';
        if (name === 'contact') return `<div class="social-block"><p class="label">${pair('social.follow')}</p>${socialList(items, 'contact')}</div>`;
        return socialList(items, 'foot');
      }
      case 'og': return name === 'image' ? esc(SITE_URL + 'media/' + og.file) : name === 'alt' ? esc(og.alt.ar) : 'summary_large_image';
      case 'config': return config();
      default: throw new Error(`unknown placeholder ${all}`);
    }
  });
}

/** The published content if the admin has published any, otherwise the seed that ships with the code. */
export function loadPublished() {
  const live = resolve(process.env.DATA_DIR || resolve(root, 'data'), 'content.json');
  return JSON.parse(readFileSync(existsSync(live) ? live : paths.content, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const content = loadPublished();
  syncMedia(content, resolve(process.env.DATA_DIR || resolve(root, 'data'), 'media'));
  writeFileSync(paths.out, render(content));
  console.log('site/index.html written');
}
