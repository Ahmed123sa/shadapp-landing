// Landing admin UI. Plain DOM, no framework. Every value from the server or the
// user goes in through textContent / .value, never innerHTML.
const BASE = document.querySelector('meta[name="base"]').content;
const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const RM = window.matchMedia('(prefers-reduced-motion: reduce)');

const S = {
  user: null, csrf: '', loaded: false,
  published: null, savedDraft: null, draft: null, limits: null, platforms: [], imageSlots: [], sections: {},
  view: 'meta', errors: {},
};

/* ------------------------------------------------------------ helpers */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const ICONS = {
  up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', out: '<path d="M9 21H5V3h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ico'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name]; // constant strings above, never user data
  return s;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('is-on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 3600);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': S.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { const e = new Error(data.error || 'حصل خطأ'); e.status = res.status; e.data = data; throw e; }
  return data;
}

/* The small line loader: loops, straightens, a dot drops. Same idea as the sign-in screens. */
const NS = 'http://www.w3.org/2000/svg';
const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const back = (t) => { t = Math.min(1, Math.max(0, t)); const k = 1.9; return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2); };
function loader() {
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'loader'); svg.setAttribute('viewBox', '0 0 52 20'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); const c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', '9'); c.setAttribute('cy', '10'); c.setAttribute('r', '2.8'); c.style.transformOrigin = 'center'; c.style.transformBox = 'fill-box';
  svg.append(p, c);
  const t0 = performance.now();
  function draw(now) {
    if (RM.matches) { p.setAttribute('d', 'M48 10L16 10'); c.style.transform = 'scale(1)'; return; }
    const k = ((now - t0) % 1200) / 1200, r = 6 * (1 - ease((k - 0.25) / 0.4));
    let d = '';
    for (let i = 0; i < 40; i++) {
      const t = i / 39, a = Math.PI * 2 * 2.4 * t - now / 120, tp = Math.sin(Math.PI * t);
      d += (i ? 'L' : 'M') + (48 + (16 - 48) * t + r * Math.sin(a) * tp).toFixed(1) + ' ' + (10 + (r * Math.cos(a) - r) * tp * 0.9).toFixed(1);
    }
    p.setAttribute('d', d); p.style.opacity = String(1 - ease((k - 0.8) / 0.18));
    c.style.transform = `scale(${back((k - 0.62) / 0.2) * (1 - ease((k - 0.9) / 0.1))})`;
    if (svg.isConnected) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  return svg;
}
function busy(btn, on) {
  btn.toggleAttribute('data-busy', on);
  if (on) { btn.setAttribute('aria-busy', 'true'); btn.prepend(loader()); }
  else { btn.removeAttribute('aria-busy'); btn.querySelector('.loader')?.remove(); }
}

function confirmDialog({ title, text, ok, danger }) {
  return new Promise((resolve) => {
    const d = h('dialog', { 'aria-labelledby': 'dlg-t' }, h('h2', { id: 'dlg-t' }, title), h('p', {}, text),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => d.close('no') }, 'إلغاء'),
        h('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', onclick: () => d.close('yes') }, ok)));
    d.addEventListener('close', () => { const v = d.returnValue === 'yes'; d.remove(); resolve(v); });
    document.body.append(d); d.showModal();
  });
}

/* ------------------------------------------------------------ state */
const localDirty = () => S.draft && !same(S.draft, S.savedDraft ?? S.published);
const draftIsNew = () => S.savedDraft && !same(S.savedDraft, S.published);
function statusInfo() {
  if (localDirty()) return ['unsaved', 'تعديلات لسه ما اتحفظتش'];
  if (draftIsNew()) return ['draft', 'مسودة محفوظة، لسه ما اتنشرتش'];
  return ['live', 'كل التعديلات منشورة'];
}

async function loadContent() {
  const c = await api('/content');
  S.published = c.published; S.savedDraft = c.draft; S.draft = clone(c.draft ?? c.published);
  S.limits = c.limits; S.platforms = c.platforms; S.imageSlots = c.imageSlots || []; S.sections = c.sections; S.loaded = true;
}

function setErrors(list) { S.errors = {}; for (const e of list) S.errors[e.path] = e.message; }
function sectionOfPath(path) {
  const [a, b] = path.split('.');
  if (a === 'meta') return 'meta';
  if (a === 'links' || a === 'emails') return 'links';
  if (a === 'social') return 'social';
  if (a === 'images') return 'images';
  if (a === 'text') return b === 'social' ? 'social' : b;
  return 'meta';
}
const sectionErrors = (id) => Object.keys(S.errors).filter((p) => sectionOfPath(p) === id).length;

async function saveDraft({ quiet } = {}) {
  try {
    await api('/draft', { method: 'PUT', body: { content: S.draft } });
    S.errors = {}; S.savedDraft = clone(S.draft);
    if (!quiet) toast('اتحفظت المسودة');
    return true;
  } catch (e) {
    if (e.status === 422) {
      setErrors(e.data.errors || []);
      const first = e.data.errors?.[0]; if (first) S.view = sectionOfPath(first.path);
      toast(`فيه ${e.data.errors.length} خطأ. راجع الخانات المعلّمة.`); render(); return false;
    }
    if (e.status === 401) { await toLogin(); return false; }
    toast(e.message); return false;
  }
}

/* ------------------------------------------------------------ views */
function loginView(msg = '') {
  const email = h('input', { class: 'input', id: 'lg-email', type: 'email', dir: 'ltr', autocomplete: 'username' });
  const pass = h('input', { class: 'input', id: 'lg-pass', type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const err = h('p', { class: 'err err--box', role: 'alert', hidden: !msg }, msg);
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, h('span', {}, 'دخول'));
  const form = h('form', { class: 'login__card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (btn.hasAttribute('data-busy')) return;
    err.hidden = true;
    if (!email.value.trim() || !pass.value) { err.textContent = 'اكتب الإيميل وكلمة المرور'; err.hidden = false; return; }
    busy(btn, true); btn.lastElementChild.textContent = 'جاري الدخول...';
    try {
      const r = await api('/login', { method: 'POST', body: { email: email.value, password: pass.value } });
      S.user = r.email; S.csrf = r.csrf; S.view = 'meta'; await loadContent(); render();
    } catch (x) {
      err.textContent = x.message; err.hidden = false; pass.setAttribute('aria-invalid', 'true');
      busy(btn, false); btn.lastElementChild.textContent = 'دخول'; pass.focus();
    }
  } },
    h('p', { class: 'brandline', dir: 'ltr' }, 'Shad', h('i', { 'aria-hidden': 'true' })),
    h('h1', {}, 'لوحة اللاندينج'),
    err,
    h('div', { class: 'field' }, h('label', { for: 'lg-email' }, 'الإيميل'), email),
    h('div', { class: 'field' }, h('label', { for: 'lg-pass' }, 'كلمة المرور'), pass),
    btn);
  pass.addEventListener('input', () => pass.removeAttribute('aria-invalid'));
  return h('main', { class: 'login', id: 'main' }, form);
}

function textField(key, group) {
  const lim = (S.limits[group] || {})[key] || { ar: 200, en: 200 };
  const node = group === 'meta' ? S.draft.meta[key] : S.draft.text[key];
  const pair = ['ar', 'en'].map((lang) => {
    const id = `f-${group}-${key}-${lang}`.replace(/\./g, '-');
    const path = `${group}.${key}.${lang}`;
    const area = h('textarea', { class: 'area', id, rows: node[lang].length > 70 ? 3 : 1, dir: lang === 'ar' ? 'rtl' : 'ltr', lang, 'aria-describedby': `${id}-c ${id}-e`, 'aria-invalid': S.errors[path] ? 'true' : false }, node[lang]);
    const count = h('p', { class: 'count', id: `${id}-c` });
    const msg = h('p', { class: 'err', id: `${id}-e`, hidden: !S.errors[path] }, S.errors[path] || '');
    const upd = () => { node[lang] = area.value; const n = area.value.trim().length; count.textContent = `${n} / ${lim[lang]}`; count.classList.toggle('is-over', n > lim[lang]); };
    area.addEventListener('input', () => { upd(); area.removeAttribute('aria-invalid'); msg.hidden = true; delete S.errors[path]; refreshChrome(); });
    upd();
    return h('div', { class: 'field' }, h('label', { for: id }, lang === 'ar' ? 'العربي' : 'English'), area, count, msg);
  });
  return h('div', { class: 'card' }, h('p', { class: 'card__key' }, key), h('div', { class: 'pair' }, pair));
}

function simpleField({ id, label, hint, value, path, set, dir = 'ltr', type = 'text' }) {
  const input = h('input', { class: 'input', id, type, dir, value, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `${id}-h ${id}-e`, 'aria-invalid': S.errors[path] ? 'true' : false });
  const msg = h('p', { class: 'err', hidden: !S.errors[path], id: `${id}-e` }, S.errors[path] || '');
  input.addEventListener('input', () => { set(input.value); input.removeAttribute('aria-invalid'); msg.hidden = true; delete S.errors[path]; refreshChrome(); });
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint', id: `${id}-h` }, hint) : h('span', { id: `${id}-h` }), msg);
}

function metaPanel() {
  const names = { title: 'عنوان الصفحة (تبويب المتصفح ونتائج جوجل)', description: 'وصف الصفحة (نتائج جوجل)', og_title: 'عنوان المشاركة (واتساب وفيسبوك)', og_description: 'وصف المشاركة' };
  return [h('div', { class: 'cards' }, Object.keys(S.draft.meta).map((k) => h('section', { 'aria-label': names[k] || k, class: 'cards' }, h('h3', { class: 'hint' }, names[k] || k), textField(k, 'meta'))))];
}

function linksPanel() {
  const d = S.draft;
  const L = [['client_login', 'رابط دخول العملاء', 'لازم يبدأ بـ https://'], ['team_login', 'رابط دخول فريق شاد', 'لازم يبدأ بـ https://'], ['play', 'رابط Google Play', 'سيبه فاضي لحد ما التطبيق ينزل. الزرار هيظهر "قريبًا".'], ['apple', 'رابط App Store', 'سيبه فاضي لحد ما التطبيق ينزل.']];
  const E = [['official', 'إيميل التواصل'], ['support', 'إيميل الدعم الفني']];
  return [h('div', { class: 'cards' },
    h('div', { class: 'card' }, L.map(([k, label, hint]) => simpleField({ id: `l-${k}`, label, hint, value: d.links[k], path: `links.${k}`, set: (v) => { d.links[k] = v; } }))),
    h('div', { class: 'card' }, E.map(([k, label]) => simpleField({ id: `e-${k}`, label, value: d.emails[k], path: `emails.${k}`, type: 'email', set: (v) => { d.emails[k] = v; } }))))];
}

function socialPanel() {
  const d = S.draft, byId = Object.fromEntries(S.platforms.map((p) => [p.id, p]));
  const list = h('ul', { class: 'soc' });
  const draw = () => {
    list.replaceChildren(...(d.social.length ? d.social.map((e, i) => {
      const p = byId[e.platform], base = `social.${i}`, isPhone = p.kind === 'phone';
      const move = (dir) => { const j = i + dir; if (j < 0 || j >= d.social.length) return; [d.social[i], d.social[j]] = [d.social[j], d.social[i]]; S.errors = {}; draw(); refreshChrome(); toast('اتغيّر الترتيب'); };
      const fields = [simpleField({ id: `s-${i}-v`, label: isPhone ? 'رقم واتساب (بالكود الدولي)' : 'الرابط', hint: isPhone ? 'مثال: 201001234567' : 'لازم يبدأ بـ https://', value: (isPhone ? e.number : e.url) || '', path: `${base}.${isPhone ? 'number' : 'url'}`, set: (v) => { if (isPhone) e.number = v; else e.url = v; } })];
      if (p.id === 'other') fields.unshift(simpleField({ id: `s-${i}-l`, label: 'اسم الحساب', value: e.label || '', path: `${base}.label`, dir: 'auto', set: (v) => { e.label = v; } }));
      const empty = !(isPhone ? e.number : e.url);
      return h('li', { class: 'soc__row' },
        h('div', {}, h('p', { class: 'soc__name' }, p.label), empty && h('p', { class: 'hint' }, 'مش هيظهر في الصفحة لأن رابطه فاضي.')),
        h('div', { class: 'cards' }, fields),
        h('div', { class: 'soc__btns' },
          h('button', { class: 'btn btn--quiet btn--icon', type: 'button', 'aria-label': `نقل ${p.label} لفوق`, onclick: () => move(-1) }, icon('up')),
          h('button', { class: 'btn btn--quiet btn--icon', type: 'button', 'aria-label': `نقل ${p.label} لتحت`, onclick: () => move(1) }, icon('down')),
          h('button', { class: 'btn btn--quiet btn--icon', type: 'button', 'aria-label': `حذف ${p.label}`, onclick: async () => {
            if (!(await confirmDialog({ title: `حذف ${p.label}؟`, text: 'هيتشال من المسودة. مش هيتشال من الصفحة المنشورة غير لما تدوس نشر.', ok: 'حذف', danger: true }))) return;
            d.social.splice(i, 1); S.errors = {}; draw(); refreshChrome(); toast('اتحذف من المسودة');
          } }, icon('trash'))));
    }) : [h('li', { class: 'empty' }, 'مفيش حسابات. ضيف أول حساب من تحت.')]));
  };
  draw();
  const add = h('section', { class: 'add', 'aria-label': 'إضافة حساب' }, h('h3', { class: 'hint' }, 'إضافة حساب'),
    h('div', { class: 'add__list' }, S.platforms.map((p) => h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => {
      if (d.social.length >= 12) { toast('وصلت للحد الأقصى (12 حساب)'); return; }
      d.social.push(p.kind === 'phone' ? { platform: p.id, number: '' } : p.id === 'other' ? { platform: p.id, url: '', label: '' } : { platform: p.id, url: '' });
      draw(); refreshChrome(); toast(`اتضاف ${p.label}. اكتب رابطه.`);
      document.getElementById(`s-${d.social.length - 1}-${p.id === 'other' ? 'l' : 'v'}`)?.focus();
    } }, icon('plus'), p.label))));
  return [list, add, h('div', { class: 'cards' }, textField('social.follow', 'text'))];
}

async function uploadImage(slot, file) {
  const res = await fetch(`${BASE}/api/media?slot=${encodeURIComponent(slot)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-CSRF-Token': S.csrf }, body: file });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data.error || 'فشل رفع الصورة'); e.status = res.status; throw e; }
  return data;
}

function imagesPanel() {
  const d = S.draft;
  d.images = d.images || {};
  return [h('div', { class: 'cards' }, S.imageSlots.map((slot) => {
    const cur = d.images[slot.id] = d.images[slot.id] || { file: '', alt: { ar: '', en: '' }, w: 0, h: 0 };
    const box = h('div', { class: 'card img' });
    const draw = () => {
      const fileInput = h('input', { class: 'sr-only', id: `i-${slot.id}-f`, type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': slot.label, tabindex: '-1' });
      const pick = h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => fileInput.click() }, icon('plus'), h('span', {}, cur.file ? 'استبدال الصورة' : 'اختيار صورة'));
      const note = h('p', { class: 'err', role: 'alert', hidden: true });
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files[0]; if (!f) return;
        note.hidden = true;
        if (f.size > 4_000_000) { note.textContent = 'الصورة أكبر من 4 ميجا'; note.hidden = false; return; }
        busy(pick, true);
        try {
          const r = await uploadImage(slot.id, f);
          cur.file = r.file; cur.w = r.w; cur.h = r.h; delete S.errors[`images.${slot.id}.file`];
          draw(); refreshChrome(); toast('اتحطت الصورة في المسودة. اكتب الوصف بالعربي والإنجليزي.');
          document.getElementById(`i-${slot.id}-ar`)?.focus();
        } catch (e) {
          busy(pick, false);
          if (e.status === 401) { await toLogin(); return; }
          note.textContent = e.message; note.hidden = false;
        }
      });
      const altField = (lang) => simpleField({ id: `i-${slot.id}-${lang}`, label: lang === 'ar' ? 'وصف الصورة (عربي)' : 'Image description (English)', hint: lang === 'ar' ? 'بيقراه قارئ الشاشة، ومهم لو الصورة ما اتحملتش.' : undefined, value: cur.alt[lang], path: `images.${slot.id}.alt.${lang}`, dir: lang === 'ar' ? 'rtl' : 'ltr', set: (v) => { cur.alt[lang] = v; } });
      const kids = [h('div', {}, h('h3', { class: 'soc__name' }, slot.label), h('p', { class: 'hint' }, `${slot.hint} المقاس الأفضل ${slot.rec}. PNG أو JPG أو WebP، لحد 4 ميجا.`))];
      if (cur.file) {
        kids.push(h('img', { class: `img__prev img__prev--${slot.shape}`, src: `${BASE}/preview/media/${cur.file}`, alt: cur.alt.ar || slot.label, width: cur.w || false, height: cur.h || false }));
        kids.push(h('p', { class: 'hint' }, `${cur.w} × ${cur.h} بكسل`));
        if (S.errors[`images.${slot.id}.file`]) kids.push(h('p', { class: 'err' }, S.errors[`images.${slot.id}.file`]));
        kids.push(h('div', { class: 'pair' }, altField('ar'), altField('en')));
      } else kids.push(h('p', { class: 'empty' }, 'مفيش صورة. الصفحة شغالة من غيرها.'));
      kids.push(h('div', { class: 'img__btns' }, fileInput, pick,
        cur.file && h('button', { class: 'btn btn--quiet', type: 'button', onclick: async () => {
          if (!(await confirmDialog({ title: 'شيل الصورة؟', text: 'هتتشال من المسودة. الصفحة المنشورة مش هتتغير غير لما تدوس نشر.', ok: 'شيل', danger: true }))) return;
          cur.file = ''; cur.w = 0; cur.h = 0; cur.alt = { ar: '', en: '' }; draw(); refreshChrome(); toast('اتشالت من المسودة');
        } }, icon('trash'), h('span', {}, 'شيل الصورة'))), note);
      box.replaceChildren(...kids);
    };
    draw();
    return box;
  }))];
}

function textPanel(id) {
  const keys = Object.keys(S.draft.text).filter((k) => k.startsWith(id + '.'));
  return [h('div', { class: 'cards' }, keys.map((k) => textField(k, 'text')))];
}

const SPECIAL = {
  meta: ['عنوان الصفحة ووصفها', 'اللي بيظهر في تبويب المتصفح وفي نتائج جوجل وعند مشاركة الرابط.'],
  links: ['الروابط والإيميلات', 'روابط الدخول، روابط المتاجر، وإيميلات التواصل والدعم.'],
  images: ['الصور', 'الصور اللي بتظهر في الصفحة. الرفع بيحط الصورة في المسودة، ولازم تدوس نشر عشان تظهر للناس.'],
  social: ['السوشيال ميديا', 'الحسابات اللي بتظهر في الفوتر وقسم التواصل. الحساب اللي رابطه فاضي مش بيظهر.'],
};

function sectionList() {
  const order = Object.keys(S.sections).filter((k) => !['meta', 'social'].includes(k));
  return [['meta', SPECIAL.meta[0]], ['links', SPECIAL.links[0]], ['social', SPECIAL.social[0]], ['images', SPECIAL.images[0]], ...order.map((k) => [k, S.sections[k]])];
}

let chrome = {};
function refreshChrome() {
  if (!chrome.status) return;
  const [kind, text] = statusInfo();
  chrome.status.className = `status status--${kind}`; chrome.status.textContent = text;
  window.onbeforeunload = localDirty() ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
  for (const [id, btn] of chrome.nav || []) {
    const n = sectionErrors(id), dot = btn.querySelector('.bad');
    if (n && !dot) btn.append(h('span', { class: 'bad', 'aria-hidden': 'true' }));
    if (!n && dot) dot.remove();
  }
}

function editorView() {
  const [kind, text] = statusInfo();
  const status = h('p', { class: `status status--${kind}`, role: 'status' }, text);
  const sections = sectionList();
  const title = SPECIAL[S.view]?.[0] ?? S.sections[S.view] ?? S.view;
  const desc = SPECIAL[S.view]?.[1] ?? 'عدّل النص بالعربي والإنجليزي. فيه حد أقصى للحروف عشان التصميم ما يبوظش.';
  const body = S.view === 'meta' ? metaPanel() : S.view === 'links' ? linksPanel() : S.view === 'social' ? socialPanel() : S.view === 'images' ? imagesPanel() : textPanel(S.view);

  const nav = h('nav', { class: 'nav', 'aria-label': 'الأقسام' });
  chrome.nav = sections.map(([id, label]) => {
    const b = h('button', { type: 'button', 'aria-current': id === S.view ? 'page' : false, onclick: () => { S.view = id; render(); document.getElementById('main').focus(); window.scrollTo({ top: 0, behavior: RM.matches ? 'auto' : 'smooth' }); } }, label, sectionErrors(id) ? h('span', { class: 'bad', 'aria-hidden': 'true' }) : null);
    nav.append(b); return [id, b];
  });

  const publishBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: () => publish(publishBtn) }, h('span', {}, 'نشر'));
  const saveBtn = h('button', { class: 'btn btn--secondary', type: 'button', onclick: async () => { busy(saveBtn, true); await saveDraft(); busy(saveBtn, false); refreshChrome(); } }, h('span', {}, 'حفظ المسودة'));
  const previewBtn = h('button', { class: 'btn btn--secondary', type: 'button', onclick: async () => {
    if (localDirty()) { busy(previewBtn, true); const ok = await saveDraft({ quiet: true }); busy(previewBtn, false); if (!ok) return; refreshChrome(); }
    window.open(`${BASE}/preview/`, '_blank', 'noopener');
  } }, icon('eye'), h('span', {}, 'معاينة'));
  const discardBtn = h('button', { class: 'btn btn--quiet', type: 'button', onclick: discard }, 'تجاهل التعديلات');
  chrome.status = status;

  return h('div', {},
    topbar(),
    h('div', { class: 'actions' }, status, discardBtn, previewBtn, saveBtn, publishBtn),
    h('div', { class: 'layout' }, nav,
      h('main', { class: 'panel', id: 'main', tabindex: '-1' }, h('div', { class: 'panel__head' }, h('h2', {}, title), h('p', {}, desc)), body)));
}

async function discard() {
  if (!localDirty() && !draftIsNew()) { toast('مفيش تعديلات تتجاهل'); return; }
  if (!(await confirmDialog({ title: 'تجاهل كل التعديلات؟', text: 'هترجع للنسخة المنشورة دلوقتي وتتمسح المسودة.', ok: 'تجاهل', danger: true }))) return;
  try { await api('/draft', { method: 'DELETE' }); await loadContent(); S.errors = {}; render(); toast('رجعت للنسخة المنشورة'); } catch (e) { toast(e.message); }
}

async function publish(btn) {
  if (!localDirty() && !draftIsNew()) { toast('مفيش تعديلات جديدة تتنشر'); return; }
  busy(btn, true);
  const saved = await saveDraft({ quiet: true });
  busy(btn, false);
  if (!saved) return;
  if (!(await confirmDialog({ title: 'نشر التعديلات؟', text: 'التعديلات هتظهر على الصفحة فورًا. تقدر ترجع لأي نسخة قديمة من صفحة "النسخ".', ok: 'نشر' }))) { refreshChrome(); return; }
  busy(btn, true);
  try { await api('/publish', { method: 'POST' }); await loadContent(); S.errors = {}; window.onbeforeunload = null; render(); toast('اتنشرت. الصفحة اتحدّثت.'); }
  catch (e) { busy(btn, false); if (e.status === 422) { setErrors(e.data.errors || []); render(); } toast(e.message); }
}

function topbar() {
  return h('header', { class: 'top' }, h('div', { class: 'top__in' },
    h('p', { class: 'top__brand', dir: 'ltr' }, 'Shad', h('i', { 'aria-hidden': 'true' })), h('p', { class: 'top__title' }, 'لوحة اللاندينج'),
    h('div', { class: 'top__end' },
      h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => { S.view = 'meta'; render(); } }, 'المحتوى'),
      h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => { S.view = '@versions'; render(); } }, 'النسخ'),
      h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => { S.view = '@account'; render(); } }, 'الحساب'),
      h('button', { class: 'btn btn--quiet', type: 'button', onclick: logout }, icon('out'), 'خروج'))));
}

function versionsView() {
  const list = h('ul', { class: 'vers' }, h('li', { class: 'empty' }, 'جاري التحميل...'));
  api('/versions').then(({ versions }) => {
    const fmt = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Cairo' });
    list.replaceChildren(...(versions.length ? versions.map((v, i) => h('li', { class: 'vers__row' },
      h('b', {}, fmt.format(new Date(v.at))), i === 0 && h('span', { class: 'tag' }, 'الأحدث'),
      h('button', { class: 'btn btn--secondary', type: 'button', onclick: async () => {
        const ok = await confirmDialog({ title: 'استرجاع النسخة دي؟', text: 'هتتحط في المسودة وتراجعها، ومش هتظهر على الصفحة غير لما تدوس نشر.' + (localDirty() ? ' تعديلاتك اللي لسه ما اتحفظتش هتضيع.' : ''), ok: 'استرجاع' });
        if (!ok) return;
        try { await api('/versions/restore', { method: 'POST', body: { id: v.id } }); await loadContent(); S.view = 'meta'; S.errors = {}; render(); toast('اتحطت في المسودة. راجعها وانشرها.'); } catch (e) { toast(e.message); }
      } }, 'استرجاع كمسودة'))) : [h('li', { class: 'empty' }, 'لسه ما اتنشرش حاجة من اللوحة. أول نشر هيظهر هنا.')]));
  }).catch((e) => { if (e.status === 401) toLogin(); else list.replaceChildren(h('li', { class: 'err err--box' }, e.message)); });
  return h('div', {}, topbar(), h('div', { class: 'layout' }, h('span'), h('main', { class: 'panel', id: 'main', tabindex: '-1' }, h('div', { class: 'panel__head' }, h('h2', {}, 'النسخ المنشورة'), h('p', {}, 'كل مرة بتدوس نشر بتتحفظ نسخة. اختار نسخة قديمة وارجع لها.')), list)));
}

function accountView() {
  const cur = h('input', { class: 'input', id: 'pw-c', type: 'password', dir: 'ltr', autocomplete: 'current-password' });
  const nw = h('input', { class: 'input', id: 'pw-n', type: 'password', dir: 'ltr', autocomplete: 'new-password', 'aria-describedby': 'pw-n-h' });
  const cf = h('input', { class: 'input', id: 'pw-f', type: 'password', dir: 'ltr', autocomplete: 'new-password' });
  const err = h('p', { class: 'err err--box', role: 'alert', hidden: true });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, h('span', {}, 'تغيير كلمة المرور'));
  const form = h('form', { class: 'pw', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (btn.hasAttribute('data-busy')) return;
    if (nw.value.length < 10) return fail('كلمة المرور الجديدة لازم تكون 10 حروف على الأقل');
    if (nw.value !== cf.value) return fail('التأكيد مش زي كلمة المرور الجديدة');
    busy(btn, true);
    try { await api('/password', { method: 'POST', body: { current: cur.value, next: nw.value } }); window.onbeforeunload = null; S.user = null; app.replaceChildren(loginView('اتغيّرت كلمة المرور. سجّل الدخول بالجديدة.')); }
    catch (x) { fail(x.message); busy(btn, false); }
  } },
    err,
    h('div', { class: 'field' }, h('label', { for: 'pw-c' }, 'كلمة المرور الحالية'), cur),
    h('div', { class: 'field' }, h('label', { for: 'pw-n' }, 'كلمة المرور الجديدة'), nw, h('p', { class: 'hint', id: 'pw-n-h' }, '10 حروف على الأقل. بعد التغيير بتتسجّل خروج من كل الأجهزة.')),
    h('div', { class: 'field' }, h('label', { for: 'pw-f' }, 'تأكيد كلمة المرور الجديدة'), cf),
    btn);
  return h('div', {}, topbar(), h('div', { class: 'layout' }, h('span'), h('main', { class: 'panel', id: 'main', tabindex: '-1' }, h('div', { class: 'panel__head' }, h('h2', {}, 'الحساب'), h('p', {}, `داخل بـ ${S.user}`)), form)));
}

async function logout() {
  if (localDirty() && !(await confirmDialog({ title: 'فيه تعديلات لسه ما اتحفظتش', text: 'لو خرجت هتضيع. تخرج؟', ok: 'خروج', danger: true }))) return;
  try { await api('/logout', { method: 'POST' }); } catch { /* already out */ }
  window.onbeforeunload = null; await toLogin();
}
async function toLogin() { S.user = null; S.loaded = false; app.replaceChildren(loginView()); document.getElementById('lg-email')?.focus(); }

function render() {
  chrome = {};
  if (!S.user) { app.replaceChildren(loginView()); return; }
  if (S.view === '@versions') { app.replaceChildren(versionsView()); return; }
  if (S.view === '@account') { app.replaceChildren(accountView()); return; }
  app.replaceChildren(editorView());
}

(async function start() {
  try { const me = await api('/me'); S.user = me.email; S.csrf = me.csrf; await loadContent(); render(); }
  catch { app.replaceChildren(loginView()); }
})();
