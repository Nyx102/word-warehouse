/* jsdom smoke of the built bundle: mounts the app against mocked APIs and
 * exercises the workspace shell (rail, buffers, chat dock permanence,
 * localStorage persistence + simulated reload).
 * Run in-container: node --experimental-vm-modules scripts/smoke.mjs */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
const jsName = (html.match(/assets\/index-[^"]+\.js/) || [])[0];
if (!jsName) throw new Error('no hashed bundle in dist/index.html');
const bundle = readFileSync(join(root, 'dist', jsName), 'utf8');

const failures = [];
const check = (name, ok, detail = '') => {
  failures.push(...(ok ? [] : [name + (detail ? ': ' + detail : '')]));
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail && !ok ? ' -- ' + detail : ''));
};
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function fixture(url) {
  const p = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (p === '/api/status') {
    return {
      index: { files: 3, chunks: 42, last_scan_age_s: 12 },
      git: { corpus: { dirty: 1 }, repo: { dirty: 0 } },
      chat_active: 0,
    };
  }
  if (p === '/api/threads') return { threads: [] };
  if (/^\/api\/threads\/[^/]+\/messages$/.test(p)) return { messages: [] };
  if (p === '/api/fs/list') {
    return {
      entries: [
        { name: 'corpus', path: 'corpus', is_dir: true, size: 0, mtime: 0 },
        { name: 'notes.md', path: 'notes.md', is_dir: false, size: 20, mtime: 0 },
      ],
    };
  }
  if (p === '/api/file') return { path: 'notes.md', content: '# Notes\n\nhello\n', sha256: 'deadbeef', total_lines: 3 };
  if (p === '/api/git/file') return { path: 'notes.md', rev: 'HEAD', exists: true, content: '' };
  if (p === '/api/git/status') {
    return { branch: { head: 'main', oid: 'x', upstream: null, ahead: 0, behind: 0 }, files: [] };
  }
  if (p === '/api/git/log') return { log: [], has_more: false };
  if (p === '/api/git/branches') {
    return { current: 'main', branches: [{ name: 'main', current: true, short: 'x', subject: 'init' }] };
  }
  if (p === '/api/git/diff') return { diff: '' };
  if (p === '/api/lint') return { generated_at: 'now', scope: 'all', total: 0, files: [] };
  if (p === '/api/help' || p === '/api/coverage') return { markdown: '# ok' };
  if (p === '/api/align') return { rows: [] };
  if (p === '/api/search') return { results: [] };
  return {};
}

async function boot(storage = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', () => {});
  const page = html.replace(/<script type="module"[^>]*><\/script>/, '');
  const dom = new JSDOM(page, {
    url: 'http://localhost:8686/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);

  w.fetch = async (input) => {
    const data = fixture(String(input));
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(data) };
  };
  w.EventSource = class {
    constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; }
    close() {}
    addEventListener() {}
    removeEventListener() {}
  };
  const WIDTH = 1280;
  w.matchMedia = (q) => {
    const min = q.match(/min-width:\s*(\d+)/);
    const max = q.match(/max-width:\s*(\d+)/);
    const matches = min ? WIDTH >= +min[1] : max ? WIDTH <= +max[1] : false;
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    };
  };
  const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return this; } };
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  w.Range.prototype.getClientRects = rects;
  w.Range.prototype.getBoundingClientRect = () => rect;
  w.Element.prototype.getClientRects = rects;
  w.Element.prototype.getBoundingClientRect = () => rect;
  w.Element.prototype.scrollIntoView = () => {};
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  // React's scheduler drives passive effects through MessageChannel, which
  // this jsdom lacks; without it useEffect callbacks never flush
  w.MessageChannel = NodeMessageChannel;

  const ctx = dom.getInternalVMContext();
  const mod = new vm.SourceTextModule(bundle, {
    context: ctx,
    identifier: jsName,
    initializeImportMeta(meta) { meta.url = 'http://localhost:8686/' + jsName; },
  });
  await mod.link(() => { throw new Error('unexpected static import'); });
  await mod.evaluate();
  await tick(120);
  return { dom, w, errors };
}

const q = (w, sel) => w.document.querySelector(sel);
const qa = (w, sel) => [...w.document.querySelectorAll(sel)];
const click = (el) => el.click();

// ---- first session ----
const { dom, w, errors } = await boot();

check('app mounts (shell, rail, tabbar, buffer area)',
  !!(q(w, '.shell') && q(w, '.rail') && q(w, '.tabbar') && q(w, '.buffer-area')));
check('chat dock mounted and docked by default', !!q(w, '.chat-dock.dock-docked'));
const chatNode = q(w, '.chat-panel');
check('chat panel exists', !!chatNode);

// Rail section switching
const railBtn = (label) => q(w, `.rail [aria-label="${label}"]`);
click(railBtn('Search'));
await tick();
let activePanel = q(w, '.sb-panel.active');
check('rail switches to Search sidebar (query form)', !!activePanel && !!activePanel.querySelector('.ss-form'));

// Flags sidebar
click(railBtn('Flags'));
await tick(120);
activePanel = q(w, '.sb-panel.active');
check('flags sidebar shows the flags UI', !!activePanel && !!activePanel.querySelector('.flags-side'));

// Git sidebar: Status opens the magit buffer
click(railBtn('Git'));
await tick(120);
const gitAction = (label) => qa(w, '.sb-panel.active .git-actions button')
  .find((b) => b.textContent === label);
check('git sidebar shows Status and Log actions', !!gitAction('Status') && !!gitAction('Log'));
click(gitAction('Status'));
await tick(150);
check('magit buffer mounts from Status', !!q(w, '.buffer.active .magit'));

// File buffer from the tree
click(railBtn('Files'));
await tick(120);
const row = qa(w, '.tree-row').find((r) => r.getAttribute('title') === 'notes.md');
check('file tree lists mocked file', !!row);
if (row) {
  click(row);
  await tick(200);
  check('file buffer opens and is active', !!q(w, '.buffer.active .merge-editor'));
  check('file tab present', qa(w, '.tab .tab-title').some((t) => t.textContent === 'notes.md'));
  check('codemirror editor built', !!q(w, '.buffer.active .cm-editor'));
}
check('all buffers stay mounted (keep-alive)', qa(w, '.buffer').length === 2,
  String(qa(w, '.buffer').length));
check('exactly one buffer visible', qa(w, '.buffer.active').length === 1);

// Chat dock CSS-state toggles must not remount the panel
const toggle = q(w, '.tabbar-actions .chat-toggle');
click(toggle);
await tick();
check('chat dock hides', !!q(w, '.chat-dock.dock-hidden'));
click(toggle);
await tick();
check('chat dock re-docks', !!q(w, '.chat-dock.dock-docked'));
click(q(w, '[aria-label="Expand chat to full view"]'));
await tick();
check('chat dock expands to full', !!q(w, '.chat-dock.dock-full'));
check('chat panel DOM node survives dock toggles',
  q(w, '.chat-panel') === chatNode && chatNode.isConnected);
click(q(w, '[aria-label="Dock chat to the side"]'));
await tick();

// Persistence (debounced ~300ms)
await tick(500);
let stored = null;
try { stored = JSON.parse(w.localStorage.getItem('ww.workspace.v1')); } catch { /* fail below */ }
const kinds = (stored?.buffers || []).map((b) => b?.desc?.kind);
check('workspace persisted to ww.workspace.v1',
  !!stored && kinds.includes('file') && kinds.includes('magit'),
  JSON.stringify(kinds));
check('active buffer persisted', stored?.activeId === 'file:notes.md', String(stored?.activeId));

check('no window errors in first session', errors.length === 0, errors.join(' | '));

// ---- simulated reload: same localStorage, fresh DOM ----
const carry = {};
for (let i = 0; i < w.localStorage.length; i++) {
  const k = w.localStorage.key(i);
  carry[k] = w.localStorage.getItem(k);
}
dom.window.close();

const second = await boot(carry);
await tick(250);
const tabs2 = qa(second.w, '.tab .tab-title').map((t) => t.textContent);
check('workspace restores after reload (2 tabs)', tabs2.length === 2, JSON.stringify(tabs2));
check('restored active file buffer renders',
  !!q(second.w, '.buffer.active .merge-editor') && tabs2.includes('notes.md'));
check('no window errors after reload', second.errors.length === 0, second.errors.join(' | '));
second.dom.window.close();

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
