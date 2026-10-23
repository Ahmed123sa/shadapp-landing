// Checks content before it is saved or published. The seed (content/content.json)
// defines which keys exist and how long each text may be, so an edit can never
// remove a text the page needs or grow one past what the design holds.
import { safeUrl, whatsappUrl, IMAGE_SLOTS, MEDIA_FILE, canonImages } from '../../tools/render.mjs';

const LINK_KEYS = ['client_login', 'team_login', 'play', 'apple'];
const REQUIRED_LINKS = new Set(['client_login', 'team_login']);
const EMAIL_KEYS = ['official', 'support'];
const MAX_SOCIAL = 12;

export function textLimit(seedValue) {
  return Math.max(40, Math.ceil(String(seedValue ?? '').length * 1.8));
}

export function limitsFor(seed) {
  const text = {}, meta = {};
  for (const [k, v] of Object.entries(seed.text)) text[k] = { ar: textLimit(v.ar), en: textLimit(v.en) };
  for (const [k, v] of Object.entries(seed.meta)) meta[k] = { ar: Math.max(80, textLimit(v.ar)), en: Math.max(80, textLimit(v.en)) };
  return { text, meta };
}

const BAD_CHARS = /[\u0000-\u001f\u007f]/;
const BAD_TOKEN = /\{(?!dot\}|pulse\})/;

function checkString(value, limit, path, errors, { required = true, token = true } = {}) {
  if (typeof value !== 'string') { errors.push({ path, message: 'لازم يكون نص' }); return ''; }
  const v = value.trim();
  if (!v && required) errors.push({ path, message: 'الخانة دي مطلوبة' });
  if (v.length > limit) errors.push({ path, message: `أطول من الحد (${v.length} من ${limit} حرف)` });
  if (BAD_CHARS.test(v)) errors.push({ path, message: 'فيها رموز تحكم أو سطر جديد' });
  if (token && BAD_TOKEN.test(v)) errors.push({ path, message: 'القوس { مسموح بس في {dot} و {pulse}' });
  return v;
}

export function validateContent(input, seed, platforms, { mediaExists } = {}) {
  const errors = [];
  const limits = limitsFor(seed);
  const out = { version: 1, meta: {}, links: {}, emails: {}, social: [], sections: seed.sections, images: {}, text: {} };
  const src = input && typeof input === 'object' ? input : {};

  for (const key of Object.keys(seed.meta)) {
    out.meta[key] = {};
    for (const lang of ['ar', 'en']) out.meta[key][lang] = checkString(src.meta?.[key]?.[lang], limits.meta[key][lang], `meta.${key}.${lang}`, errors, { token: false });
  }
  for (const key of Object.keys(seed.text)) {
    out.text[key] = {};
    for (const lang of ['ar', 'en']) out.text[key][lang] = checkString(src.text?.[key]?.[lang], limits.text[key][lang], `text.${key}.${lang}`, errors);
  }
  for (const key of LINK_KEYS) {
    const raw = typeof src.links?.[key] === 'string' ? src.links[key].trim() : '';
    if (!raw) {
      if (REQUIRED_LINKS.has(key)) errors.push({ path: `links.${key}`, message: 'الرابط ده مطلوب' });
      out.links[key] = '';
      continue;
    }
    const url = safeUrl(raw);
    if (!url || (REQUIRED_LINKS.has(key) && !/^https:\/\//i.test(url))) errors.push({ path: `links.${key}`, message: 'لازم رابط كامل يبدأ بـ https://' });
    if (raw.length > 300) errors.push({ path: `links.${key}`, message: 'الرابط طويل جدًا' });
    out.links[key] = raw;
  }
  for (const key of EMAIL_KEYS) {
    const raw = typeof src.emails?.[key] === 'string' ? src.emails[key].trim() : '';
    if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(raw) || raw.length > 120) errors.push({ path: `emails.${key}`, message: 'إيميل غير صحيح' });
    out.emails[key] = raw;
  }

  const byId = Object.fromEntries(platforms.map((p) => [p.id, p]));
  const list = Array.isArray(src.social) ? src.social : [];
  if (list.length > MAX_SOCIAL) errors.push({ path: 'social', message: `الحد الأقصى ${MAX_SOCIAL} حساب` });
  list.slice(0, MAX_SOCIAL).forEach((e, i) => {
    const p = byId[e?.platform];
    const base = `social.${i}`;
    if (!p) { errors.push({ path: base, message: 'منصة غير معروفة' }); return; }
    const entry = { platform: p.id };
    if (p.kind === 'phone') {
      const num = typeof e.number === 'string' ? e.number.trim() : '';
      if (num && !whatsappUrl(num)) errors.push({ path: `${base}.number`, message: 'الرقم لازم يكون من 8 إلى 15 رقم بالكود الدولي' });
      entry.number = num;
    } else {
      const url = typeof e.url === 'string' ? e.url.trim() : '';
      if (url && (!safeUrl(url) || url.length > 300)) errors.push({ path: `${base}.url`, message: 'لازم رابط كامل يبدأ بـ https://' });
      entry.url = url;
    }
    if (p.id === 'other') {
      entry.label = checkString(e.label ?? '', 30, `${base}.label`, errors, { required: !!entry.url, token: false });
    }
    out.social.push(entry);
  });

  const rawImages = src.images && typeof src.images === 'object' ? src.images : {};
  for (const slot of Object.keys(IMAGE_SLOTS)) {
    const e = rawImages[slot] || {};
    const file = typeof e.file === 'string' ? e.file.trim() : '';
    const base = `images.${slot}`;
    if (file) {
      if (!MEDIA_FILE.test(file)) errors.push({ path: `${base}.file`, message: 'اسم الملف غير صحيح' });
      else if (mediaExists && !mediaExists(file)) errors.push({ path: `${base}.file`, message: 'الصورة مش موجودة على السيرفر، ارفعها تاني' });
      for (const lang of ['ar', 'en']) {
        const alt = checkString(e.alt?.[lang] ?? '', 140, `${base}.alt.${lang}`, errors, { required: true, token: false });
        if (e.alt && typeof e.alt[lang] === 'string') e.alt[lang] = alt;
      }
    }
    const w = Number(e.w), h = Number(e.h);
    if (file && !(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 10000 && h <= 10000)) errors.push({ path: `${base}.file`, message: 'مقاس الصورة غير معروف، ارفعها تاني' });
  }
  out.images = canonImages(rawImages);
  return { ok: errors.length === 0, errors, value: out };
}
