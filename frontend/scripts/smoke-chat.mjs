/* jsdom smoke of the Track-3B chat components, bundled standalone with
 * esbuild: real useThreads/ThreadsSidebar/ChatDock/Composer over a mocked
 * WorkspaceContext, mocked fetch and EventSource (never the live backend).
 * Run in-container: cd frontend && node scripts/smoke-chat.mjs */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

const failures = [];
const check = (name, ok, detail = '') => {
  failures.push(...(ok ? [] : [name + (detail ? ': ' + detail : '')]));
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail && !ok ? ' -- ' + detail : ''));
};
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

// ---- bundle (entry + context mocks are virtual modules) ----

const ENTRY = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceProvider } from './app/workspace';
import { useThreads } from './chat/useThreads';
import { ThreadsSidebar } from './sidebars/ThreadsSidebar';
import { ChatDock } from './chat/ChatDock';
import { Composer } from './chat/Composer';

function ComposerHarness() {
  const [turnActive, setTurnActive] = useState(false);
  (window as any).__setTurnActive = setTurnActive;
  return (
    <div id="composer-harness">
      <Composer
        turnActive={turnActive}
        onSend={(t: string) => (window as any).__sent.push(t)}
        onStop={() => { (window as any).__stopped = true; }}
      />
    </div>
  );
}

function Harness() {
  const threadsApi = useThreads();
  (window as any).__threadsApi = threadsApi;
  return (
    <div>
      <div id="sidebar-host"><ThreadsSidebar threadsApi={threadsApi} /></div>
      <ChatDock threadsApi={threadsApi} onTurnActiveChange={() => {}} />
      <ComposerHarness />
    </div>
  );
}

(window as any).__sent = [];
createRoot(document.getElementById('root')!).render(
  <WorkspaceProvider><Harness /></WorkspaceProvider>,
);
`;

const WORKSPACE_MOCK = `
import { createContext, useContext, useState } from 'react';
const Ctx = createContext<any>(null);
export function WorkspaceProvider({ children }: any) {
  const [chatDock, setChatDock] = useState('docked');
  const [chatWidth, setChatWidth] = useState(380);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const api = {
    buffers: [], activeId: null, rail: 'chat', sidebarCollapsed: false,
    chatDock, chatWidth, drawerOpen,
    open() {}, close() {}, activate() {}, setDirty() {}, setTitle() {},
    setRail() {}, setSidebarCollapsed() {},
    setDrawerOpen, setChatDock, setChatWidth,
  };
  (window as any).__ws = api;
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
export function useWorkspace() { return useContext(Ctx); }
`;

const ICONS_MOCK = `
export const IconDockRight = () => <span data-icon="dock" />;
export const IconExpand = () => <span data-icon="expand" />;
`;

const mocks = {
  workspace: { contents: WORKSPACE_MOCK, filter: /\/app\/workspace$/ },
  icons: { contents: ICONS_MOCK, filter: /\/shell\/icons$/ },
};

const mockPlugin = {
  name: 'context-mocks',
  setup(b) {
    for (const [name, m] of Object.entries(mocks)) {
      b.onResolve({ filter: m.filter }, () => ({ path: name, namespace: 'mock' }));
    }
    b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
      contents: mocks[args.path].contents,
      loader: 'tsx',
      resolveDir: srcDir,
    }));
  },
};

const built = await build({
  stdin: { contents: ENTRY, resolveDir: srcDir, sourcefile: 'smoke-chat-entry.tsx', loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [mockPlugin],
  logLevel: 'silent',
});
const bundle = built.outputFiles[0].text;

// ---- jsdom environment ----

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
vc.on('error', () => {});
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:8686/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const w = dom.window;
w.addEventListener('error', (e) => errors.push('window.error: ' + e.message));

// Server-shaped fixture: pinned DESC then last_active DESC; one thread both
// pinned and archived so auto-select must skip past the list head
const threads = [
  { id: 3, title: 'archived pinned', claude_session_id: null, model: null, created_at: 100, last_active: 900, pinned: 1, archived: 1 },
  { id: 1, title: 'pinned one', claude_session_id: null, model: 'haiku', created_at: 100, last_active: 800, pinned: 1, archived: 0 },
  { id: 2, title: 'main one', claude_session_id: null, model: null, created_at: 100, last_active: 700, pinned: 0, archived: 0 },
];
const sorted = () => threads.slice().sort((a, b) => b.pinned - a.pinned || b.last_active - a.last_active);

const calls = [];
w.fetch = async (input, init = {}) => {
  const path = String(input).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ method, path, body });
  let data = {};
  if (method === 'GET' && path === '/api/threads') data = { threads: sorted() };
  else if (method === 'PATCH' && /^\/api\/threads\/\d+$/.test(path)) {
    const t = threads.find((x) => x.id === Number(path.split('/').pop()));
    if (t && body) Object.assign(t, body);
    data = { ok: true };
  } else if (/^\/api\/threads\/\d+\/messages$/.test(path)) data = { messages: [] };
  return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(data) };
};

const esLog = [];
w.EventSource = class {
  constructor(url) { this.url = url; this.onmessage = null; this.onerror = null; esLog.push(url); }
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

// Composer autosize measures scrollHeight; derive it from the line count
Object.defineProperty(w.HTMLTextAreaElement.prototype, 'scrollHeight', {
  configurable: true,
  get() { return 20 * String(this.value).split('\n').length + 10; },
});

// React's scheduler drives passive effects through MessageChannel, which this
// jsdom lacks; without it useEffect callbacks (thread fetch etc.) never flush
w.MessageChannel = NodeMessageChannel;

w.eval(bundle);
await tick(150);

const q = (sel, scope) => (scope || w.document).querySelector(sel);
const qa = (sel, scope) => [...(scope || w.document).querySelectorAll(sel)];
const sidebar = () => q('#sidebar-host');
const titles = () => qa('.thread-title', sidebar()).map((t) => t.textContent);
const rowOf = (title) =>
  qa('.thread', sidebar()).find((li) => q('.thread-title', li)?.textContent === title);
const setTextarea = (ta, value) => {
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(ta, value);
  ta.dispatchEvent(new w.Event('input', { bubbles: true }));
};
const key = (el, opts) => {
  const ev = new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...opts });
  if (opts.isComposing) Object.defineProperty(ev, 'isComposing', { value: true });
  el.dispatchEvent(ev);
};
const lastPatch = () => calls.filter((c) => c.method === 'PATCH').pop();
const getsAfter = (idx) =>
  calls.slice(idx + 1).filter((c) => c.method === 'GET' && c.path === '/api/threads').length;

// ---- ThreadsSidebar ----

check('sidebar and chat dock mount', !!q('.thread-pane', sidebar()) && !!q('.chat-dock.dock-docked'));
const secTexts = qa('.thread-sec', sidebar()).map((e) => e.textContent.trim());
check('pinned section renders', secTexts.includes('Pinned'), JSON.stringify(secTexts));
check('archived section labeled with count', secTexts.some((t) => /Archived \(1\)/.test(t)));
check('pinned + main rows visible', titles().includes('pinned one') && titles().includes('main one'));
check('archived section collapsed by default', !titles().includes('archived pinned'), JSON.stringify(titles()));
check('auto-select skips archived list head', w.__threadsApi.selectedId === 1, String(w.__threadsApi.selectedId));
check('active row highlighted', q('.thread-title', q('.thread.active', sidebar()))?.textContent === 'pinned one');

// Pin: PATCH {pinned:1} then refetch
q('[title="Pin"]', rowOf('main one')).click();
await tick();
let p = lastPatch();
check('pin PATCHes {pinned:1}',
  p && p.path === '/api/threads/2' && JSON.stringify(p.body) === '{"pinned":1}', JSON.stringify(p));
check('pin triggers list refetch', getsAfter(calls.indexOf(p)) >= 1);
const pinnedSec = qa('.thread-sec', sidebar()).find((e) => e.textContent.trim() === 'Pinned');
check('re-sorted into pinned section',
  qa('.thread-title', pinnedSec.nextElementSibling).map((t) => t.textContent).includes('main one'));

// Archive: PATCH {archived:1} then refetch
q('[title="Archive"]', rowOf('main one')).click();
await tick();
p = lastPatch();
check('archive PATCHes {archived:1}',
  p && p.path === '/api/threads/2' && JSON.stringify(p.body) === '{"archived":1}', JSON.stringify(p));
check('archived row leaves visible lists', !titles().includes('main one'));
check('archived count updates',
  qa('.thread-sec', sidebar()).some((e) => /Archived \(2\)/.test(e.textContent)));

// Expand archived; explicit selection of an archived thread stays allowed
qa('.thread-sec-toggle', sidebar())[0].click();
await tick();
check('expanded archived shows its rows',
  titles().includes('archived pinned') && titles().includes('main one'));
rowOf('archived pinned').click();
await tick();
check('archived thread selectable by click', w.__threadsApi.selectedId === 3);

// Rename: inline input, Enter commits PATCH {title}
q('[title="Rename"]', rowOf('pinned one')).click();
await tick();
const ren = q('.thread-rename', sidebar());
check('rename input appears with current title', !!ren && ren.value === 'pinned one');
ren.value = 'renamed one';
key(ren, { key: 'Enter' });
await tick();
p = lastPatch();
check('rename PATCHes {title}',
  p && p.path === '/api/threads/1' && JSON.stringify(p.body) === '{"title":"renamed one"}', JSON.stringify(p));
check('renamed title rendered after refetch', titles().includes('renamed one'));

// Esc cancels rename without a PATCH
const patchesBefore = calls.filter((c) => c.method === 'PATCH').length;
q('[title="Rename"]', rowOf('renamed one')).click();
await tick();
key(q('.thread-rename', sidebar()), { key: 'Escape' });
await tick();
check('Esc cancels rename without PATCH',
  !q('.thread-rename', sidebar()) && calls.filter((c) => c.method === 'PATCH').length === patchesBefore);

// ---- Composer ----

const ta = q('#composer-harness textarea');
const h1 = parseFloat(ta.style.height);
setTextarea(ta, 'a\nb\nc\nd');
await tick();
const h4 = parseFloat(ta.style.height);
setTextarea(ta, Array(12).fill('x').join('\n'));
await tick();
const h12 = parseFloat(ta.style.height);
check('textarea grows with content', h1 < h4 && h4 < h12, `${h1} ${h4} ${h12}`);
check('growth capped at 6 rows', h12 === 120 && ta.style.overflowY === 'auto', `${h12} ${ta.style.overflowY}`);
check('no scrollbar below the cap', h4 === 90, String(h4));

setTextarea(ta, 'hello world');
key(ta, { key: 'Enter' });
await tick();
check('Enter sends and clears', w.__sent.includes('hello world') && ta.value === '', JSON.stringify(w.__sent));
check('send resets to one row', parseFloat(ta.style.height) === h1, ta.style.height);

setTextarea(ta, 'no send');
key(ta, { key: 'Enter', shiftKey: true });
await tick();
check('Shift+Enter does not send', !w.__sent.includes('no send'));
key(ta, { key: 'Enter', isComposing: true });
await tick();
check('IME-composing Enter does not send', !w.__sent.includes('no send'));
key(ta, { key: 'Enter', ctrlKey: true });
await tick();
check('Ctrl+Enter sends', w.__sent.includes('no send'));

w.__setTurnActive(true);
await tick();
const harness = q('#composer-harness');
const btns = qa('.composer-btn', harness).map((b) => b.textContent);
check('Stop replaces Send during a turn', JSON.stringify(btns) === '["Stop"]', JSON.stringify(btns));
setTextarea(q('textarea', harness), 'mid turn');
key(q('textarea', harness), { key: 'Enter' });
await tick();
check('Enter during a turn does not send', !w.__sent.includes('mid turn'));
q('.composer-btn', harness).click();
check('Stop button wired to onStop', w.__stopped === true);
w.__setTurnActive(false);
await tick();

// ---- ChatDock permanence ----

const panelNode = q('.chat-dock .chat-panel');
const esBefore = esLog.length;
w.__ws.setChatDock('hidden');
await tick();
check('dock hides', !!q('.chat-dock.dock-hidden'));
w.__ws.setChatDock('docked');
await tick();
check('dock re-docks', !!q('.chat-dock.dock-docked'));
w.__ws.setChatDock('full');
await tick();
check('dock expands to full', !!q('.chat-dock.dock-full'));
check('chat panel DOM node survives hidden->docked->full',
  q('.chat-dock .chat-panel') === panelNode && panelNode.isConnected);
check('no stream reconnects across dock transitions', esLog.length === esBefore,
  `${esBefore} -> ${esLog.length}`);

// ---- cost-rule + error guards ----

check('no /message or /interrupt POSTs issued',
  !calls.some((c) => /\/(message|interrupt)$/.test(c.path)),
  JSON.stringify(calls.filter((c) => /\/(message|interrupt)$/.test(c.path))));
check('no window errors', errors.length === 0, errors.join(' | '));

dom.window.close();
console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
