/* Standalone jsdom smoke for the git track: byte-exact diffParse round-trips,
 * MagitBuffer keyboard/mutation flows, LogBuffer paging, CommitBuffer render,
 * GitSidebar counts/branch switch. Bundles the modules with esbuild against
 * mocked fetch; never mounts the whole app.
 * Run in-container: node scripts/smoke-git.mjs [--live]
 * --live additionally round-trips REAL server diff text (read-only GETs). */

import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (name, ok, detail = '') => {
  failures.push(...(ok ? [] : [name + (detail ? ': ' + detail : '')]));
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail && !ok ? ' -- ' + detail : ''));
};
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------- diff fixtures */
/* Byte-modeled on real git output (tab terminators after paths with spaces,
 * C-quoted non-ASCII paths, marker lines, CRLF payloads) */

const F_MULTI_HEADER =
  'diff --git a/corpus/ch1.md b/corpus/ch1.md\n'
  + 'index 1111111..2222222 100644\n'
  + '--- a/corpus/ch1.md\n'
  + '+++ b/corpus/ch1.md\n';
const F_MULTI_H1 =
  '@@ -1,3 +1,3 @@\n'
  + ' line one\n'
  + '-old two\n'
  + '+new two\n'
  + ' line three\n';
const F_MULTI_H2 =
  '@@ -10,3 +10,4 @@ ctx header\n'
  + ' ten\n'
  + ' eleven\n'
  + '+eleven point five\n'
  + ' twelve\n';
const F_MULTI = F_MULTI_HEADER + F_MULTI_H1 + F_MULTI_H2;

const F_RENAME =
  'diff --git a/ren_src.txt b/ren dst.txt\n'
  + 'similarity index 95%\n'
  + 'rename from ren_src.txt\n'
  + 'rename to ren dst.txt\n'
  + 'index 96cc558..eec0790 100644\n'
  + '--- a/ren_src.txt\n'
  + '+++ b/ren dst.txt\t\n'
  + '@@ -4,3 +4,3 @@\n'
  + ' 4\n'
  + '-7\n'
  + '+seven\n'
  + ' 8\n';

const F_SPACES =
  'diff --git a/sp ace.txt b/sp ace.txt\n'
  + 'index 422c2b7..55dce13 100644\n'
  + '--- a/sp ace.txt\t\n'
  + '+++ b/sp ace.txt\t\n'
  + '@@ -1,2 +1,2 @@\n'
  + ' a\n'
  + '-b\n'
  + '+B\n';

const F_QUOTED =
  'diff --git "a/\\346\\227\\245.txt" "b/\\346\\227\\245.txt"\n'
  + 'index b77b4eb..7061c57 100644\n'
  + '--- "a/\\346\\227\\245.txt"\n'
  + '+++ "b/\\346\\227\\245.txt"\n'
  + '@@ -1,2 +1,2 @@\n'
  + ' x\n'
  + '-y\n'
  + '+Y\n';

const F_NOEOL =
  'diff --git a/noeol.txt b/noeol.txt\n'
  + 'index 20cbb4d..59af270 100644\n'
  + '--- a/noeol.txt\n'
  + '+++ b/noeol.txt\n'
  + '@@ -1 +1 @@\n'
  + '-no newline\n'
  + '\\ No newline at end of file\n'
  + '+still no newline\n'
  + '\\ No newline at end of file\n';

const F_NEW =
  'diff --git a/added.txt b/added.txt\n'
  + 'new file mode 100644\n'
  + 'index 0000000..ecce07a\n'
  + '--- /dev/null\n'
  + '+++ b/added.txt\n'
  + '@@ -0,0 +1,2 @@\n'
  + '+added\n'
  + '+file\n';

const F_DELETED =
  'diff --git a/del.txt b/del.txt\n'
  + 'deleted file mode 100644\n'
  + 'index 669dd2e..0000000\n'
  + '--- a/del.txt\n'
  + '+++ /dev/null\n'
  + '@@ -1 +0,0 @@\n'
  + '-DEL\n';

const F_BINARY =
  'diff --git a/real.bin b/real.bin\n'
  + 'index 1029138..3ceaef2 100644\n'
  + 'Binary files a/real.bin and b/real.bin differ\n';

const F_CRLF =
  'diff --git a/crlf.txt b/crlf.txt\n'
  + 'index a4b32e8..fc1b26f 100644\n'
  + '--- a/crlf.txt\n'
  + '+++ b/crlf.txt\n'
  + '@@ -1,2 +1,2 @@\n'
  + ' crlf one\r\n'
  + '-crlf two\r\n'
  + '+CRLF TWO\r\n';

const F_MODE =
  'diff --git a/script.sh b/script.sh\n'
  + 'old mode 100644\n'
  + 'new mode 100755\n'
  + 'index 20cbb4d..59af270\n';

const F_STAGED =
  'diff --git a/server.py b/server.py\n'
  + 'index aaaaaaa..bbbbbbb 100644\n'
  + '--- a/server.py\n'
  + '+++ b/server.py\n'
  + '@@ -5,3 +5,3 @@\n'
  + ' import os\n'
  + '-import re\n'
  + '+import re, sys\n'
  + ' import json\n';

/* ------------------------------------------------------------ diffParse */

const dpOut = await build({
  entryPoints: [join(root, 'src/git/diffParse.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
});
const dp = await import(
  'data:text/javascript;base64,' + Buffer.from(dpOut.outputFiles[0].text).toString('base64'));

const ALL = F_MULTI + F_RENAME + F_SPACES + F_QUOTED + F_NOEOL + F_NEW
  + F_DELETED + F_BINARY + F_CRLF + F_MODE;
{
  const parsed = dp.parseDiff(ALL);
  check('parse: 10 file entries', parsed.files.length === 10, String(parsed.files.length));
  check('round-trip: concatenated fixture byte-identical', dp.serializeDiff(parsed) === ALL);
  for (const [name, text] of [
    ['multi-hunk', F_MULTI], ['rename', F_RENAME], ['spaces', F_SPACES],
    ['c-quoted', F_QUOTED], ['no-eol', F_NOEOL], ['new file', F_NEW],
    ['deleted', F_DELETED], ['binary', F_BINARY], ['crlf', F_CRLF], ['mode-only', F_MODE],
  ]) {
    check(`round-trip: ${name}`, dp.serializeDiff(dp.parseDiff(text)) === text);
  }
  const [multi, ren, spaces, quoted, noeol, added, deleted, binary, crlf, mode] = parsed.files;
  check('multi: 2 hunks, path, line numbers',
    multi.hunks.length === 2 && multi.path === 'corpus/ch1.md'
    && multi.hunks[1].oldStart === 10 && multi.hunks[1].newStart === 10
    && multi.hunks[1].newLines === 4);
  check('rename: flag + decoded paths',
    ren.isRename && ren.oldPath === 'ren_src.txt' && ren.newPath === 'ren dst.txt');
  check('spaces: tab terminator stripped',
    spaces.path === 'sp ace.txt' && spaces.hunks.length === 1);
  check('c-quoted: octal utf-8 decoded',
    quoted.path === '日.txt' && quoted.oldPath === '日.txt');
  check('no-eol: markers inside single hunk',
    noeol.hunks.length === 1 && noeol.hunks[0].text.includes('\\ No newline')
    && noeol.hunks[0].text.endsWith('\\ No newline at end of file\n'));
  check('new file: isNew, null oldPath', added.isNew && added.oldPath === null
    && added.newPath === 'added.txt');
  check('deleted: isDeleted, null newPath', deleted.isDeleted && deleted.newPath === null
    && deleted.path === 'del.txt');
  check('binary: notice kept in header, no hunks',
    binary.isBinary && binary.hunks.length === 0
    && binary.header.includes('Binary files a/real.bin and b/real.bin differ'));
  check('crlf: \\r preserved in hunk bytes', crlf.hunks[0].text.includes(' crlf one\r\n'));
  check('mode-only: header-only entry', mode.hunks.length === 0 && mode.path === 'script.sh');

  check('buildHunkPatch: header + single hunk verbatim',
    dp.buildHunkPatch(multi, multi.hunks[1]) === F_MULTI_HEADER + F_MULTI_H2);
  check('buildFilePatch: full entry verbatim', dp.buildFilePatch(multi) === F_MULTI);
  check('hunkBody strips the @@ line',
    dp.hunkBody(multi.hunks[0]) === ' line one\n-old two\n+new two\n line three\n');
  check('preamble round-trip', dp.serializeDiff(dp.parseDiff('junk\n' + F_NEW)) === 'junk\n' + F_NEW);
  check('empty diff parses to no files', dp.parseDiff('').files.length === 0);
}

/* -------------------------------------------------------- component boot */

const uiOut = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { WorkspaceProvider, useWorkspace } from './src/app/workspace';
      import { MagitBuffer } from './src/buffers/MagitBuffer';
      import { LogBuffer } from './src/buffers/LogBuffer';
      import { CommitBuffer } from './src/buffers/CommitBuffer';
      import { GitSidebar } from './src/sidebars/GitSidebar';
      window.__mods = { React, createRoot, WorkspaceProvider, useWorkspace,
        MagitBuffer, LogBuffer, CommitBuffer, GitSidebar };
    `,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const uiCode = uiOut.outputFiles[0].text;

function boot(route) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
  vc.on('error', () => {});
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: 'http://localhost:8686/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push('window.error: ' + e.message));
  w.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    dispatchEvent() { return false; },
  });
  w.Element.prototype.scrollIntoView = () => {};
  const calls = [];
  w.fetch = async (input, init = {}) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '');
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { path: path.split('?')[0], full: path, method: init.method || 'GET', body };
    calls.push(call);
    const res = route(call);
    if (res && res.status && res.status >= 400) {
      return {
        ok: false, status: res.status, statusText: 'Error',
        text: async () => JSON.stringify(res.data ?? { error: 'mock error' }),
      };
    }
    return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(res ?? {}) };
  };
  w.eval(uiCode);
  const render = (node) => {
    const { createRoot } = w.__mods;
    const r = createRoot(w.document.getElementById('host'));
    r.render(node);
    return r;
  };
  const q = (sel) => w.document.querySelector(sel);
  const qa = (sel) => [...w.document.querySelectorAll(sel)];
  const key = (el, k, opts = {}) =>
    el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  return { dom, w, calls, errors, render, q, qa, key };
}

const qparam = (full, name) => new URL(full, 'http://x').searchParams.get(name);

/* ------------------------------------------------------------ MagitBuffer */

{
  const flags = { apply409: false };
  const STATUS = {
    branch: { head: 'main', oid: 'abc123def', upstream: null, ahead: 0, behind: 0 },
    files: [
      { path: 'notes/new.txt', orig_path: null, index: '', worktree: '', untracked: true, status: '??' },
      { path: 'corpus/ch1.md', orig_path: null, index: '', worktree: 'M', untracked: false, status: ' M' },
      { path: 'server.py', orig_path: null, index: 'M', worktree: '', untracked: false, status: 'M ' },
    ],
  };
  const LOG = {
    log: [
      { hash: 'aaaa111', oid: 'a'.repeat(40), author: 'Rehpotsirhc', date: '2026-07-17T10:00:00+00:00', subject: 'First subject' },
      { hash: 'bbbb222', oid: 'b'.repeat(40), author: 'Rehpotsirhc', date: '2026-07-16T10:00:00+00:00', subject: 'Second subject' },
    ],
    has_more: true,
  };
  const s = boot((c) => {
    if (c.path === '/api/git/status') return STATUS;
    if (c.path === '/api/git/log') return LOG;
    if (c.path === '/api/git/diff') {
      return { diff: qparam(c.full, 'mode') === 'staged' ? F_STAGED : F_MULTI };
    }
    if (c.path === '/api/git/apply' && flags.apply409) {
      return { status: 409, data: { error: 'patch does not apply' } };
    }
    if (c.method === 'POST') return { ok: true, hash: 'cafe123' };
    return {};
  });
  const { React, WorkspaceProvider, useWorkspace, MagitBuffer } = s.w.__mods;
  let ws = null;
  const Probe = () => { ws = useWorkspace(); return null; };
  s.render(React.createElement(WorkspaceProvider, null,
    React.createElement(Probe),
    React.createElement(MagitBuffer, { repo: 'corpus' })));
  await tick(120);

  const headers = s.qa('.magit-section-h').map((el) => el.textContent);
  check('magit: all four sections render',
    headers.length === 4
    && ['Untracked', 'Unstaged', 'Staged', 'Recent commits'].every((t) => headers.some((h) => h.includes(t))),
    JSON.stringify(headers));
  check('magit: three file rows + two commit rows',
    s.qa('.magit-file-row').length === 3 && s.qa('.magit-commit-row').length === 2);
  check('magit: branch shown in header', s.q('.magit-branch')?.textContent === 'main');

  const magitEl = s.q('.magit');
  magitEl.focus();

  // Point starts on the untracked row; s = whole-file stage
  s.key(magitEl, 's');
  await tick(100);
  const stageCall = s.calls.filter((c) => c.path === '/api/git/stage').pop();
  check('magit: s on untracked row posts git/stage',
    !!stageCall && JSON.stringify(stageCall.body) === JSON.stringify({ repo: 'corpus', paths: ['notes/new.txt'] }),
    JSON.stringify(stageCall?.body));

  // n to the unstaged file, TAB expands its two hunks inline
  s.key(magitEl, 'n');
  await tick(20);
  s.key(magitEl, 'Tab');
  await tick(40);
  check('magit: TAB expands unstaged file to 2 hunks', s.qa('.magit-hunk').length === 2);
  check('magit: hunk body rendered via DiffText',
    s.qa('.magit-hunk .difftext .dl.add').some((el) => el.textContent === '+new two'));

  // Point onto hunk 2; s sends the exact header+hunk patch
  s.key(magitEl, 'n');
  await tick(20);
  s.key(magitEl, 'n');
  await tick(20);
  s.key(magitEl, 's');
  await tick(100);
  const applyCall = s.calls.filter((c) => c.path === '/api/git/apply').pop();
  check('magit: s on hunk posts exact verbatim patch',
    !!applyCall && applyCall.body.patch === F_MULTI_HEADER + F_MULTI_H2
    && applyCall.body.repo === 'corpus' && !applyCall.body.reverse,
    JSON.stringify(applyCall?.body ?? null).slice(0, 120));

  // RET on the hunk visits the file at the hunk's new-side start
  s.key(magitEl, 'Enter');
  await tick(40);
  const fileBuf = ws?.buffers.find((b) => b.id === 'file:corpus/ch1.md');
  check('magit: RET on hunk opens file buffer at new-side line',
    !!fileBuf && fileBuf.desc.kind === 'file' && fileBuf.desc.line === 10,
    JSON.stringify(fileBuf?.desc));

  // c focuses the commit editor; Ctrl+Enter commits the staged set, no paths
  s.key(magitEl, 'c');
  await tick(20);
  const ta = s.q('.magit-msg');
  check('magit: c focuses the commit textarea', s.w.document.activeElement === ta);
  Object.getOwnPropertyDescriptor(s.w.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Smoke commit');
  ta.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  await tick(20);
  ta.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(100);
  const commitCall = s.calls.filter((c) => c.path === '/api/git/commit').pop();
  check('magit: Ctrl+Enter commits without paths',
    !!commitCall && commitCall.body.message === 'Smoke commit' && !('paths' in commitCall.body),
    JSON.stringify(commitCall?.body));

  // 409 from apply triggers a full refresh
  flags.apply409 = true;
  const statusCallsBefore = s.calls.filter((c) => c.path === '/api/git/status').length;
  s.key(magitEl, 's');
  await tick(120);
  const statusCallsAfter = s.calls.filter((c) => c.path === '/api/git/status').length;
  check('magit: 409 on apply refetches status', statusCallsAfter > statusCallsBefore,
    `${statusCallsBefore} -> ${statusCallsAfter}`);

  // Commit row click opens the commit buffer
  s.qa('.magit-commit-row')[0].click();
  await tick(40);
  check('magit: commit row opens commit buffer',
    !!ws?.buffers.find((b) => b.id === 'commit:corpus:' + 'a'.repeat(40)));

  check('magit: no window errors', s.errors.length === 0, s.errors.join(' | '));
  s.dom.window.close();
}

/* -------------------------------------------------------------- LogBuffer */

{
  const mk = (i) => ({
    hash: 'h' + i, oid: String(i).padStart(2, '0').repeat(20), author: 'A',
    date: '2026-01-01T00:00:00+00:00', subject: 'commit ' + i,
  });
  const s = boot((c) => {
    if (c.path === '/api/git/log') {
      const skip = Number(qparam(c.full, 'skip') || 0);
      return skip === 0
        ? { log: [mk(1), mk(2), mk(3)], has_more: true }
        : { log: [mk(4), mk(5)], has_more: false };
    }
    return {};
  });
  const { React, WorkspaceProvider, useWorkspace, LogBuffer } = s.w.__mods;
  let ws = null;
  const Probe = () => { ws = useWorkspace(); return null; };
  s.render(React.createElement(WorkspaceProvider, null,
    React.createElement(Probe),
    React.createElement(LogBuffer, { repo: 'repo', path: 'Volumes/v1.md' })));
  await tick(120);

  check('log: file-history header shows path',
    s.q('.log-head')?.textContent.includes('Volumes/v1.md'));
  check('log: first page rows', s.qa('.log-buffer-row').length === 3);
  const more = s.qa('button').find((b) => b.textContent === 'Load more');
  check('log: has_more shows Load more', !!more);
  check('log: path forwarded to the endpoint',
    qparam(s.calls.find((c) => c.path === '/api/git/log').full, 'path') === 'Volumes/v1.md');
  more.click();
  await tick(120);
  check('log: second page appends (5 rows)', s.qa('.log-buffer-row').length === 5,
    String(s.qa('.log-buffer-row').length));
  check('log: second page requested with skip=3',
    qparam(s.calls.filter((c) => c.path === '/api/git/log').pop().full, 'skip') === '3');
  check('log: has_more=false hides Load more',
    !s.qa('button').some((b) => b.textContent === 'Load more'));

  // n moves the point; RET opens the commit buffer for the entry at point
  const logEl = s.q('.log-buffer');
  logEl.focus();
  s.key(logEl, 'n');
  await tick(20);
  s.key(logEl, 'Enter');
  await tick(40);
  check('log: RET opens commit buffer for the pointed row',
    !!ws?.buffers.find((b) => b.desc.kind === 'commit' && b.desc.rev === mk(2).oid));
  check('log: no window errors', s.errors.length === 0, s.errors.join(' | '));
  s.dom.window.close();
}

/* ------------------------------------------------------------ CommitBuffer */

{
  const DETAIL = {
    meta: {
      hash: 'f'.repeat(40), short: 'ffff123', author: 'Rehpotsirhc', email: 'r@example.com',
      date: '2026-07-01T12:00:00+09:00', parents: ['1'.repeat(40), '2'.repeat(40)],
      subject: 'Fix chapter one', body: 'Longer explanation.\n\nSecond paragraph.',
    },
    stat: [
      { path: 'corpus/ch1.md', added: 2, deleted: 1 },
      { path: 'real.bin', added: null, deleted: null },
    ],
    patch: F_MULTI + F_BINARY,
  };
  const s = boot((c) => (c.path === '/api/git/show' ? DETAIL : {}));
  const { React, WorkspaceProvider, CommitBuffer } = s.w.__mods;
  s.render(React.createElement(WorkspaceProvider, null,
    React.createElement(CommitBuffer, { repo: 'corpus', rev: 'f'.repeat(40) })));
  await tick(120);

  const metaText = s.q('.commit-meta')?.textContent ?? '';
  check('commit: meta header renders hash/author/email/date',
    metaText.includes('ffff123') && metaText.includes('Rehpotsirhc')
    && metaText.includes('r@example.com') && metaText.includes('2026-07-01T12:00:00+09:00'));
  check('commit: subject and pre-wrap body',
    s.q('.commit-subject')?.textContent === 'Fix chapter one'
    && s.q('.commit-body')?.textContent.includes('Second paragraph.'));
  check('commit: two clickable parents', s.qa('.commit-parent').length === 2);
  const statRows = s.qa('.commit-stat-row');
  check('commit: numstat rows with +/-/bin',
    statRows.length === 2
    && statRows[0].textContent.includes('+2') && statRows[0].textContent.includes('−1')
    && statRows[1].textContent.includes('bin'));
  check('commit: patch renders one section per file',
    s.qa('.commit-patch-file').length === 2
    && s.qa('.commit-patch-file .difftext .dl.add').some((el) => el.textContent === '+new two'));
  statRows[0].click();
  check('commit: no window errors', s.errors.length === 0, s.errors.join(' | '));
  s.dom.window.close();
}

/* -------------------------------------------------------------- GitSidebar */

{
  const s = boot((c) => {
    if (c.path === '/api/git/status') {
      return {
        branch: { head: 'main', oid: 'abc', upstream: 'origin/main', ahead: 2, behind: 1 },
        files: [
          { path: 'notes/new.txt', orig_path: null, index: '', worktree: '', untracked: true, status: '??' },
          { path: 'corpus/ch1.md', orig_path: null, index: '', worktree: 'M', untracked: false, status: ' M' },
          { path: 'server.py', orig_path: null, index: 'M', worktree: '', untracked: false, status: 'M ' },
        ],
      };
    }
    if (c.path === '/api/git/branches') {
      return {
        current: 'main',
        branches: [
          { name: 'main', current: true, short: 'abc1234', subject: 'tip' },
          { name: 'dev', current: false, short: 'def5678', subject: 'wip' },
        ],
      };
    }
    if (c.method === 'POST') return { ok: true };
    return {};
  });
  const { React, WorkspaceProvider, useWorkspace, GitSidebar } = s.w.__mods;
  let ws = null;
  const Probe = () => { ws = useWorkspace(); return null; };
  s.render(React.createElement(WorkspaceProvider, null,
    React.createElement(Probe),
    React.createElement(GitSidebar)));
  await tick(120);

  const sums = s.qa('.git-sum-item').map((el) => el.textContent.replace(/\s+/g, ' ').trim());
  check('sidebar: dirty summary counts',
    JSON.stringify(sums) === JSON.stringify(['1 staged', '1 unstaged', '1 untracked']),
    JSON.stringify(sums));
  check('sidebar: current branch + ahead/behind',
    s.q('.git-branch-name')?.textContent === 'main'
    && s.q('.magit-ab')?.textContent.includes('↑2'));
  check('sidebar: branch list options', s.qa('.git-branch-select option').length === 2);
  check('sidebar: grouped file rows', s.qa('.file-row').length === 3);

  s.qa('button').find((b) => b.textContent === 'Status').click();
  await tick(40);
  check('sidebar: Status opens magit buffer', !!ws?.buffers.find((b) => b.id === 'magit:corpus'));

  s.qa('.file-row')[0].click();
  await tick(40);
  check('sidebar: file row opens diff buffer',
    !!ws?.buffers.find((b) => b.desc.kind === 'diff' && b.desc.path === 'server.py'));

  const sel = s.q('.git-branch-select');
  Object.getOwnPropertyDescriptor(s.w.HTMLSelectElement.prototype, 'value').set.call(sel, 'dev');
  sel.dispatchEvent(new s.w.Event('change', { bubbles: true }));
  await tick(100);
  const brCall = s.calls.filter((c) => c.path === '/api/git/branch').pop();
  check('sidebar: branch select posts git/branch',
    !!brCall && brCall.body.name === 'dev' && !('create' in brCall.body),
    JSON.stringify(brCall?.body));
  check('sidebar: no window errors', s.errors.length === 0, s.errors.join(' | '));
  s.dom.window.close();
}

/* ---------------------------------------------------------- live sanity */

if (process.argv.includes('--live')) {
  const base = process.env.SMOKE_BASE || 'http://localhost:8686';
  for (const [repo, mode] of [['corpus', 'worktree'], ['corpus', 'staged'], ['repo', 'worktree']]) {
    const r = await fetch(`${base}/api/git/diff?repo=${repo}&mode=${mode}`);
    const { diff } = await r.json();
    const parsed = dp.parseDiff(diff);
    check(`live: ${repo}/${mode} reserializes byte-identical (${diff.length} bytes, ${parsed.files.length} files)`,
      dp.serializeDiff(parsed) === diff);
  }
  const st = await (await fetch(base + '/api/git/status?repo=corpus')).json();
  check('live: status has branch + files', Array.isArray(st.files) && !!st.branch);
  const wt = await (await fetch(base + '/api/git/diff?repo=corpus&mode=worktree')).json();
  const wtPaths = new Set(dp.parseDiff(wt.diff).files.map((f) => f.path));
  const missing = st.files
    .filter((f) => !f.untracked && f.worktree === 'M')
    .map((f) => f.path)
    .filter((p) => !wtPaths.has(p));
  check('live: every worktree-modified status path parsed from the diff',
    missing.length === 0, missing.slice(0, 5).join(', '));
  const lg = await (await fetch(base + '/api/git/log?repo=corpus&n=3')).json();
  for (const e of lg.log) {
    const det = await (await fetch(base + '/api/git/show?repo=corpus&rev=' + e.oid)).json();
    check(`live: commit ${e.hash} patch reserializes byte-identical (${det.patch.length} bytes)`,
      dp.serializeDiff(dp.parseDiff(det.patch)) === det.patch);
  }
}

console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
