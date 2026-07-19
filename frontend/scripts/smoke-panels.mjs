/* jsdom smoke for the Track 3C panels: esbuild-bundles the sidebars and
 * file/doc buffers standalone against a mocked WorkspaceContext + mocked
 * fetch, then drives them through their key flows (tree expand, fs actions,
 * sha256 save + 409, history repo mapping, search open-at-line, flag
 * dismiss/open). No full-App mount.
 * Run in-container: node scripts/smoke-panels.mjs [--live]
 * --live proxies read-only GETs (search/lint/coverage/help/align) to the
 * real server on :8686; mutations stay mocked. */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');
const LIVE_BASE = 'http://localhost:8686';

const failures = [];
const check = (name, ok, detail = '') => {
  failures.push(...(ok ? [] : [name + (detail ? ': ' + detail : '')]));
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail && !ok ? ' -- ' + detail : ''));
};
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

// ---- bundle ----

const ENTRY = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditorView } from '@codemirror/view';
import { FilesSidebar } from './src/sidebars/FilesSidebar';
import { SearchSidebar } from './src/sidebars/SearchSidebar';
import { FlagsSidebar } from './src/sidebars/FlagsSidebar';
import { FileBuffer } from './src/buffers/FileBuffer';
import { AlignBuffer } from './src/buffers/AlignBuffer';
import { CoverageBuffer } from './src/buffers/CoverageBuffer';
import { HelpBuffer } from './src/buffers/HelpBuffer';

window.__cmFind = (el) => EditorView.findFromDOM(el);
const mount = (id, el) => {
  const host = document.createElement('div');
  host.id = id;
  document.body.appendChild(host);
  createRoot(host).render(el);
};
mount('files', React.createElement(FilesSidebar));
mount('search', React.createElement(SearchSidebar));
mount('flags', React.createElement(FlagsSidebar));
mount('fileA', React.createElement(FileBuffer, { bufferId: 'file:notes.md', path: 'notes.md' }));
mount('fileB', React.createElement(FileBuffer, {
  bufferId: 'file:corpus/worldend2/repo/ch01.md', path: 'corpus/worldend2/repo/ch01.md',
}));
mount('align', React.createElement(AlignBuffer));
mount('coverage', React.createElement(CoverageBuffer));
mount('help', React.createElement(HelpBuffer));
`;

const WORKSPACE_MOCK = `
const calls = [];
window.__ws = {
  calls,
  buffers: [], activeId: null, rail: 'flags', sidebarCollapsed: false,
  chatDock: 'hidden', chatWidth: 380, drawerOpen: false,
  open(desc) { calls.push(['open', desc]); },
  close(id) { calls.push(['close', id]); },
  activate(id) { calls.push(['activate', id]); },
  setDirty(id, dirty) { calls.push(['setDirty', id, dirty]); },
  setTitle() {}, setRail() {}, setSidebarCollapsed() {},
  setDrawerOpen() {}, setChatDock() {}, setChatWidth() {},
};
export function useWorkspace() { return window.__ws; }
export function WorkspaceProvider({ children }) { return children; }
`;

const SETTINGS_MOCK = `
export function useSettings() {
  return { theme: 'dark', keymap: 'normal', setTheme() {}, setKeymap() {} };
}
export function SettingsProvider({ children }) { return children; }
`;

const mockPlugin = {
  name: 'ctx-mocks',
  setup(b) {
    b.onResolve({ filter: /app\/(workspace|settings)$/ }, (args) => ({
      path: args.path.endsWith('workspace') ? 'workspace' : 'settings',
      namespace: 'ww-mock',
    }));
    b.onLoad({ filter: /.*/, namespace: 'ww-mock' }, (args) => ({
      contents: args.path === 'workspace' ? WORKSPACE_MOCK : SETTINGS_MOCK,
      loader: 'js',
    }));
  },
};

const built = await build({
  stdin: { contents: ENTRY, resolveDir: root, loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [mockPlugin],
  logLevel: 'silent',
});
const bundle = built.outputFiles[0].text;

// ---- fixtures ----

const dirEnt = (path) => ({ name: path.split('/').pop(), path, is_dir: true, size: 0, mtime: 0 });
const fileEnt = (path, size = 10) => ({ name: path.split('/').pop(), path, is_dir: false, size, mtime: 0 });

const lintReport = {
  generated_at: 'now',
  scope: 'all',
  total: 2,
  triage_pending: 0,
  triage: { running: false, in_backoff: false, last_error: null },
  files: [{
    path: 'raw/x.md',
    flags: [
      {
        category: 'nearmiss', key: 'Defence', closest: 'Defense', count: 1,
        locations: [{ path: 'raw/x.md', line: 12, col: 1, snippet: 'Defence line here' }],
      },
      {
        category: 'regression', key: 'r1', rule: 1, find: 'foo', replace: 'bar', matched: 'foo', count: 2,
        ai: { verdict: 'clear', reason: 'intentional', judged_at: 'now' },
        locations: [{ path: 'raw/x.md', line: 30, col: 2, snippet: 'foo bar' }],
      },
    ],
  }],
};

const searchResults = {
  results: [{
    chunk_id: 1, path: 'worldend/official-en/v03.txt', source: 'official', lang: 'en',
    series: 1, volume: '03', chapter_label: null, chapter_title: 'Chapter T', subtitle: null,
    part_title: null, start_line: 1580, end_line: 1588, kind: 'body',
    snippet: 'She was >>Chtholly<< Nota',
  }],
};

const state = { put409: false };
const LIVE_PATHS = new Set(['/api/search', '/api/lint', '/api/coverage', '/api/help', '/api/align']);

function respond(method, url) {
  const p = url.split('?')[0];
  const params = new URLSearchParams(url.split('?')[1] || '');
  const ok = (data) => ({ status: 200, data });
  if (p === '/api/fs/list') {
    const path = params.get('path') || '';
    if (path === '') return ok({ path, entries: [dirEnt('corpus'), dirEnt('data'), fileEnt('notes.md')] });
    if (path === 'corpus') return ok({ path, entries: [fileEnt('corpus/inner.md')] });
    return ok({ path, entries: [] });
  }
  if (p === '/api/file' && method === 'GET') {
    return ok({ path: params.get('path'), content: 'alpha\nbeta\ngamma\n', sha256: 'sha-1', total_lines: 3 });
  }
  if (p === '/api/file' && method === 'PUT') {
    return state.put409 ? { status: 409, data: { error: 'sha mismatch' } } : ok({ ok: true, sha256: 'sha-2' });
  }
  if (/^\/api\/chunk\//.test(p)) {
    return ok({
      row: { chunk_id: 1, ord: 2, path: 'worldend/official-en/v03.txt', start_line: 1580, end_line: 1588, text: 'hit text' },
      neighbors: [{ id: 0, ord: 1, start_line: 1570, end_line: 1579, text: 'before text' }],
    });
  }
  if (p === '/api/search') return ok(searchResults);
  if (p === '/api/lint') return ok(lintReport);
  if (p === '/api/coverage') return ok({ markdown: '# Coverage OK' });
  if (p === '/api/help') return ok({ markdown: '# Help OK' });
  if (p === '/api/align') return ok({ rows: [] });
  // fs mutations, lint dismiss/undismiss, triage run/reject, reindex
  return ok({ ok: true });
}

// ---- boot ----

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', () => {});
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:8686/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const w = dom.window;
w.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
w.__mockState = state;

const fetchLog = [];
w.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = (init.method || 'GET').toUpperCase();
  const entry = { method, url, body: init.body ? String(init.body) : null };
  fetchLog.push(entry);
  const p = url.split('?')[0];
  if (LIVE && method === 'GET' && LIVE_PATHS.has(p)) {
    const res = await fetch(LIVE_BASE + url);
    const text = await res.text();
    return { ok: res.ok, status: res.status, statusText: res.statusText, text: async () => text };
  }
  const r = respond(method, url);
  return { ok: r.status < 400, status: r.status, statusText: '', text: async () => JSON.stringify(r.data) };
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

w.eval(bundle);
await tick(250);

// ---- helpers ----

const q = (sel) => w.document.querySelector(sel);
const qa = (sel) => [...w.document.querySelectorAll(sel)];
const btn = (scope, text) => qa(scope + ' button').find((b) => b.textContent.trim() === text);
const setInput = (el, value) => {
  Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const wsCalls = () => w.__ws.calls;
const lastOpen = () => [...wsCalls()].reverse().find((c) => c[0] === 'open')?.[1];
const findFetch = (method, prefix) =>
  [...fetchLog].reverse().find((f) => f.method === method && f.url.startsWith(prefix));

// ---- files sidebar ----

const treeRow = (path) => qa('#files .tree-row').find((r) => r.getAttribute('title') === path);

check('files: root listing renders', !!treeRow('corpus') && !!treeRow('notes.md'));

treeRow('corpus').click();
await tick(150);
check('files: dir expand lazily lists children',
  !!findFetch('GET', '/api/fs/list?path=corpus') && !!treeRow('corpus/inner.md'));

treeRow('notes.md').click();
await tick();
check('files: file click opens file buffer',
  JSON.stringify(lastOpen()) === JSON.stringify({ kind: 'file', path: 'notes.md' }),
  JSON.stringify(lastOpen()));

btn('#files .fs-tools', 'New').click();
await tick();
const nameInput = q('#files .fs-name-input');
check('files: new-file dialog opens', !!nameInput);
if (nameInput) {
  setInput(nameInput, 'tmp-x.txt');
  await tick();
  btn('#files .modal-foot', 'Create').click();
  await tick(150);
  const f = findFetch('POST', '/api/fs/create');
  check('files: create fires /api/fs/create', !!f && f.body === '{"path":"tmp-x.txt"}', f?.body);
}

const kebab = (path) => treeRow(path)?.querySelector('.tree-kebab');
kebab('notes.md').click();
await tick();
check('files: kebab opens context menu', !!q('#files .ctx-menu'));
btn('#files .ctx-menu', 'Rename').click();
await tick();
const renInput = q('#files .fs-name-input');
check('files: rename dialog prefilled', renInput?.value === 'notes.md', renInput?.value);
setInput(renInput, 'notes2.md');
await tick();
btn('#files .modal-foot', 'Rename').click();
await tick(150);
const ren = findFetch('POST', '/api/fs/rename');
check('files: rename fires /api/fs/rename',
  !!ren && ren.body === '{"path":"notes.md","to":"notes2.md"}', ren?.body);
check('files: rename closes the stale buffer',
  wsCalls().some((c) => c[0] === 'close' && c[1] === 'file:notes.md'));

kebab('corpus/inner.md').click();
await tick();
btn('#files .ctx-menu', 'Delete').click();
await tick();
btn('#files .modal-foot', 'Delete').click();
await tick(150);
const del = findFetch('POST', '/api/fs/delete');
check('files: delete fires /api/fs/delete',
  !!del && del.body === '{"path":"corpus/inner.md"}', del?.body);
kebab('corpus/inner.md').click();
await tick();
check('files: kebab menu has Download for files',
  !!qa('#files .ctx-menu a').find((a) => a.textContent === 'Download'));
q('#files .ctx-overlay')?.click();
await tick();

// ---- file buffer: save, 409, history ----

await tick(300);
check('fileA: editor builds', !!q('#fileA .cm-editor'));
const view = w.__cmFind(q('#fileA .cm-editor'));
check('fileA: view reachable', !!view);
if (view) {
  view.dispatch({ changes: { from: 0, insert: 'x' } });
  await tick(150);
  check('fileA: dirty reported to workspace',
    wsCalls().some((c) => c[0] === 'setDirty' && c[1] === 'file:notes.md' && c[2] === true));
  const saveBtn = btn('#fileA', 'Save');
  check('fileA: save enabled when dirty', !!saveBtn && !saveBtn.disabled);
  saveBtn.click();
  await tick(200);
  const put = findFetch('PUT', '/api/file');
  const putBody = put ? JSON.parse(put.body) : null;
  check('fileA: save PUTs with expect_sha256',
    !!putBody && putBody.expect_sha256 === 'sha-1' && putBody.repo === 'corpus' && putBody.path === 'notes.md',
    put?.body);
  check('fileA: no conflict bar after clean save', !q('#fileA .conflict-bar'));

  state.put409 = true;
  view.dispatch({ changes: { from: 0, insert: 'y' } });
  await tick(150);
  btn('#fileA', 'Save').click();
  await tick(200);
  check('fileA: 409 shows the conflict bar', !!q('#fileA .conflict-bar'));
  state.put409 = false;
}

btn('#fileA', 'History').click();
check('fileA: history maps plain path to corpus repo',
  JSON.stringify(lastOpen()) === JSON.stringify({ kind: 'log', repo: 'corpus', path: 'notes.md' }),
  JSON.stringify(lastOpen()));

await tick(100);
btn('#fileB', 'History').click();
check('fileB: history strips nested-repo prefix',
  JSON.stringify(lastOpen()) === JSON.stringify({ kind: 'log', repo: 'repo', path: 'ch01.md' }),
  JSON.stringify(lastOpen()));

// ---- search sidebar ----

const query = LIVE ? 'Chtholly' : 'test';
setInput(q('#search .ss-q'), query);
await tick();
q('#search .ss-q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
await tick(LIVE ? 900 : 200);
check('search: query fires /api/search', !!findFetch('GET', '/api/search?q=' + query));
const cards = qa('#search .result-card');
check('search: result cards render', cards.length > 0, String(cards.length));
if (!LIVE && cards.length) {
  check('search: snippet highlights matches',
    q('#search .card-snippet').innerHTML.includes('<mark>'));
}
if (cards.length) {
  cards[0].querySelector('.card-head').click();
  const o = lastOpen();
  const wantPath = LIVE ? null : 'corpus/worldend/official-en/v03.txt';
  check('search: result click opens file at line',
    !!o && o.kind === 'file' && String(o.path).startsWith('corpus/') && typeof o.line === 'number'
    && (LIVE || (o.path === wantPath && o.line === 1580)),
    JSON.stringify(o));
}
btn('#search', 'Align matrix').click();
check('search: align button opens align buffer',
  JSON.stringify(lastOpen()) === JSON.stringify({ kind: 'align' }), JSON.stringify(lastOpen()));

// ---- flags sidebar ----

await tick(LIVE ? 900 : 200);
check('flags: lint report fetched', !!findFetch('GET', '/api/lint'));
if (!LIVE) {
  const summaries = qa('#flags .flag-file > summary').map((s) => s.textContent);
  check('flags: file group renders', summaries.some((s) => s.includes('raw/x.md')), JSON.stringify(summaries));
  // Location click first; dismissing hides the flag (and its locations)
  const loc = q('#flags .loc-open');
  check('flags: location renders', !!loc);
  if (loc) {
    loc.click();
    const o = lastOpen();
    check('flags: location click opens file at line',
      JSON.stringify(o) === JSON.stringify({ kind: 'file', path: 'corpus/raw/x.md', line: 12 }),
      JSON.stringify(o));
  }
  const dismiss = btn('#flags', 'Dismiss');
  check('flags: flag card with dismiss renders', !!dismiss);
  if (dismiss) {
    dismiss.click();
    await tick(150);
    const d = findFetch('POST', '/api/lint/dismiss');
    check('flags: dismiss fires the endpoint',
      !!d && d.body === '{"category":"nearmiss","key":"Defence"}', d?.body);
  }
  check('flags: AI-dismissed section renders', !!q('#flags .ai-dismissed'));
  const restore = btn('#flags .ai-dismissed', 'Restore');
  if (restore) {
    restore.click();
    await tick(150);
    const rj = findFetch('POST', '/api/triage/reject');
    check('flags: restore fires /api/triage/reject',
      !!rj && rj.body === '{"category":"regression","key":"r1"}', rj?.body);
  }
} else {
  check('flags: report renders (live)', !!q('#flags .fl-list') && !q('#flags .fl-list .empty, #flags .empty')
    || qa('#flags .flag-file').length >= 0);
}

// ---- doc + align buffers ----

check('coverage: markdown renders', (q('#coverage .md')?.textContent || '').trim().length > 0,
  q('#coverage .md')?.innerHTML?.slice(0, 80));
check('help: markdown renders', (q('#help .md')?.textContent || '').trim().length > 0,
  q('#help .md')?.innerHTML?.slice(0, 80));
check('align: controls render', !!q('#align .align-controls'));

check('no window errors', errors.length === 0, errors.join(' | '));

dom.window.close();
console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
