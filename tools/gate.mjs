#!/usr/bin/env node
// Runs the ux-ui-agent-skills gates against this landing page and prints N/N.
//   node tools/gate.mjs [path-to-ux-ui-agent-skills]
// Needs: npm install + npx playwright install chrome inside the kit folder.
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kit = resolve(process.argv[2] || process.env.UX_KIT || 'G:/coding/Skills/ux-ui-agent-skills/ux-ui-agent-skills');
const page = resolve(root, 'index.html');
const S = (f) => `"${resolve(kit, 'scripts', f)}"`;
const q = (f) => `"${f}"`;

const checks = [
  ['Tokens: valid DTCG, aliases resolve', `python3 ${S('validate_tokens.py')} ${q(resolve(root, 'tokens/design-tokens.json'))}`],
  ['Tokens: WCAG contrast pairs, light + dark', `python3 ${S('validate_contrast.py')} ${q(resolve(root, 'tokens/design-tokens.json'))}`],
  ['Token build: every alias resolves', `node ${S('build_tokens.mjs')} --check --in ${q(resolve(root, 'tokens/design-tokens.json'))}`],
  ['No hardcoded hex/px/ms/font in page code', `python3 ${S('lint_hardcodes.py')} ${q(resolve(root, 'index.html'))} ${q(resolve(root, 'assets/css/site.css'))} ${q(resolve(root, 'assets/js/site.js'))}`],
  ['Every var(--...) resolves to the theme', `python3 ${S('validate_theme_refs.py')} --theme ${q(resolve(root, 'assets/css/tokens.css'))} ${q(resolve(root, 'assets/css/site.css'))}`],
  ['No emoji anywhere', `python3 ${S('check_no_emoji.py')} ${q(resolve(root, 'index.html'))} ${q(resolve(root, 'assets'))} ${q(resolve(root, 'README.md'))}`],
  ['No native select', `python3 ${S('lint_native_select.py')} ${q(root)}`],
  ['Real-render WCAG contrast', `node ${S('measure_render.mjs')} ${q(page)}`],
  ['State-aware WCAG (default / hover / focus)', `node ${S('verify_states.mjs')} ${q(page)}`],
  ['axe-core WCAG 2.2 A/AA', `node ${S('axe_audit.mjs')} ${q(page)}`],
  ['Keyboard: Tab reaches, Enter/Space operates', `node ${S('verify_keyboard.mjs')} ${q(page)}`],
  ['Target size >= 24x24', `node ${S('verify_target_size.mjs')} ${q(page)}`],
  ['Reduced motion: policy, stopped, no content lost', `node ${S('verify_reduced_motion.mjs')} ${q(page)}`],
  ['RTL: logical properties, no mirror overflow', `node ${S('verify_rtl.mjs')} ${q(page)}`],
  ['Responsive: no overflow at 280/320/414 (font x1.25)', `node ${S('verify_responsive.mjs')} ${q(page)} --scale=1.25`],
  ['Mobile-first: base layer is the phone layout', `node ${S('verify_mobile_first.mjs')} ${q(page)}`],
  ['Token by intent', `node ${S('lint_intent.mjs')} ${q(page)}`],
  ['Declared states really change on click', `node ${S('verify_interactive.mjs')} ${q(page)}`],
  ['No clipped text or overlapping controls', `node ${S('verify_overflow.mjs')} ${q(page)}`],
  ['Anti-slop tells (strict)', `node ${S('slop_tells.mjs')} --strict ${q(page)}`],
  ['Taste signal (strict)', `node ${S('taste_audit.mjs')} --strict ${q(page)}`],
];

let pass = 0;
const failed = [];
for (const [name, cmd] of checks) {
  try {
    execSync(cmd, { stdio: 'pipe', env: { ...process.env, DS_REQUIRE_BROWSER: '1' }, cwd: kit });
    pass++; console.log(`PASS  ${name}`);
  } catch (e) {
    failed.push(name);
    console.log(`FAIL  ${name}`);
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n').slice(-25).join('\n');
    console.log(out.replace(/^/gm, '      '));
  }
}
console.log(`\n${pass}/${checks.length} gates pass${failed.length ? '' : ' (taste is not measured by gates; see README)'}`);
process.exit(failed.length ? 1 : 0);
