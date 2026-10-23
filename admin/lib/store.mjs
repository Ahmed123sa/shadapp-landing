// Where the content lives:
//   content/content.json        the seed shipped with the code (git)
//   data/content.json           what is published now (written by the admin, not in git)
//   data/draft.json             the working copy being edited
//   data/versions/<id>.json     every publish, newest first, for rolling back
//   site/index.html             generated from template + published content
import { readFile, writeFile, rename, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { render, loadPlatforms } from '../../tools/render.mjs';

const VERSION_ID = /^\d{8}T\d{9}Z$/;
const KEEP_VERSIONS = 100;

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, file);
}

export const versionId = (d = new Date()) => d.toISOString().replace(/[-:.]/g, '').replace(/^(\d{8}T\d{6})(\d{3})Z$/, '$1$2Z');

export function createStore({ root, dataDir }) {
  const p = {
    seed: resolve(root, 'content/content.json'),
    template: resolve(root, 'template/index.tpl.html'),
    site: resolve(root, 'site/index.html'),
    published: resolve(dataDir, 'content.json'),
    draft: resolve(dataDir, 'draft.json'),
    versions: resolve(dataDir, 'versions'),
  };
  let chain = Promise.resolve();
  const locked = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const json = (o) => JSON.stringify(o, null, 2) + '\n';

  const store = {
    paths: p,
    platforms: () => loadPlatforms(),
    async seed() { return readJson(p.seed); },
    async published() { return (await readJson(p.published)) ?? (await readJson(p.seed)); },
    async draft() { return readJson(p.draft); },
    async saveDraft(content) { await mkdir(dataDir, { recursive: true }); await atomicWrite(p.draft, json(content)); },
    async discardDraft() { await rm(p.draft, { force: true }); },
    async renderHtml(content) { return render(content, { template: await readFile(p.template, 'utf8') }); },

    publish(content) {
      return locked(async () => {
        const html = await store.renderHtml(content); // throws before anything is written
        await mkdir(p.versions, { recursive: true });
        const id = versionId();
        await atomicWrite(resolve(p.versions, `${id}.json`), json({ id, content }));
        await atomicWrite(p.published, json(content));
        await atomicWrite(p.site, html);
        await rm(p.draft, { force: true });
        const all = (await readdir(p.versions)).filter((f) => f.endsWith('.json')).sort().reverse();
        for (const old of all.slice(KEEP_VERSIONS)) await rm(resolve(p.versions, old), { force: true });
        return { id };
      });
    },

    async listVersions() {
      let files = [];
      try { files = await readdir(p.versions); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      return files.filter((f) => VERSION_ID.test(f.replace(/\.json$/, ''))).map((f) => f.replace(/\.json$/, '')).sort().reverse().map((id) => ({
        id,
        at: `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}.${id.slice(15, 18)}Z`,
      }));
    },
    async getVersion(id) {
      if (!VERSION_ID.test(String(id))) return null;
      const v = await readJson(resolve(p.versions, `${id}.json`));
      return v?.content ?? null;
    },
    async readAdmin() { return (await readJson(resolve(dataDir, 'admin.json'))) ?? {}; },
    async writeAdmin(obj) { await mkdir(dataDir, { recursive: true }); await atomicWrite(resolve(dataDir, 'admin.json'), json(obj)); },
  };
  return store;
}
