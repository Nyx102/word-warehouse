/* =============================================================
 * WorldEnd Translation Workbench — frontend
 * Sections: utils | toasts | api | modal | markdown |
 *           tabs+status | threads | chat | search | flags | diffs
 * ============================================================= */
'use strict';

const App = (() => {

  /* ---------------- utils ---------------- */

  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Tiny DOM builder. Props: class, html (pre-escaped!), dataset, style,
  // on<event> handlers; everything else via setAttribute. Kids flatten,
  // null/false skipped, strings become text nodes.
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  function truncate(s, n) {
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function fmtAge(s) {
    s = Math.max(0, Math.round(s));
    if (s < 120) return s + 's';
    if (s < 7200) return Math.round(s / 60) + 'm';
    return Math.round(s / 3600) + 'h';
  }

  function hashHue(str) {
    let x = 7;
    for (let i = 0; i < str.length; i++) x = ((x * 31) + str.charCodeAt(i)) >>> 0;
    return x % 360;
  }

  /* ---------------- toasts ---------------- */

  function toast(msg, kind, ms) {
    const t = h('div', { class: 'toast ' + (kind || 'info') }, String(msg));
    $('toasts').append(t);
    setTimeout(() => {
      t.classList.add('fade');
      setTimeout(() => t.remove(), 350);
    }, ms || 4000);
  }

  /* ---------------- api helper ---------------- */

  // All fetches go through here. opts: {method, body, silent}.
  // Non-2xx -> toast (unless silent) + throw Error with .status.
  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      if (!opts.silent) toast('Network error: ' + e.message, 'error');
      throw e;
    }
    const raw = await res.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = { raw }; }
    if (!res.ok) {
      const msg = (data && (data.error || data.detail)) || (res.status + ' ' + res.statusText);
      if (!opts.silent) toast(msg, 'error');
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------- modal ---------------- */

  function openModal(title, bodyNode, footNodes) {
    $('modal-title').textContent = title;
    $('modal-body').replaceChildren(bodyNode);
    $('modal-foot').replaceChildren(...(footNodes || []));
    $('modal-backdrop').classList.remove('hidden');
  }

  function closeModal() {
    $('modal-backdrop').classList.add('hidden');
    $('modal-body').replaceChildren();
    $('modal-foot').replaceChildren();
  }

  function modalOpen() {
    return !$('modal-backdrop').classList.contains('hidden');
  }

  /* ---------------- minimal markdown ---------------- */

  // Inline spans on an already HTML-escaped string. Code spans are
  // protected first so bold/italic markers inside them survive.
  function mdInline(s) {
    return s.split(/(`[^`]+`)/).map((part) => {
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
        return '<code>' + part.slice(1, -1) + '</code>';
      }
      let t = part;
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, url) =>
        /^https?:\/\//.test(url)
          ? '<a href="' + url + '" target="_blank" rel="noopener">' + txt + '</a>'
          : m);
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*\w])\*([^*]+)\*/g, '$1<em>$2</em>');
      t = t.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
      return t;
    }).join('');
  }

  function mdTable(rows) {
    let html = '<table>';
    rows.forEach((r, idx) => {
      if (/^[|\s:-]+$/.test(r)) return; // |---|---| separator row
      const tag = idx === 0 ? 'th' : 'td';
      const cells = r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      html += '<tr>' + cells.map((c) => '<' + tag + '>' + mdInline(esc(c.trim())) + '</' + tag + '>').join('') + '</tr>';
    });
    return html + '</table>';
  }

  function renderMarkdown(src) {
    const lines = String(src == null ? '' : src).split('\n');
    const out = [];
    let i = 0;
    const isBlockStart = (l) => /^(#{1,6}\s|```|\s*[-*]\s|>\s?|\s*\|)/.test(l);
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // closing fence (or EOF)
        out.push('<pre class="md-code"><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        const lvl = hm[1].length;
        out.push('<h' + lvl + '>' + mdInline(esc(hm[2])) + '</h' + lvl + '>');
        i++;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push('<li>' + mdInline(esc(lines[i].replace(/^\s*[-*]\s+/, ''))) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + mdInline(esc(buf.join(' '))) + '</blockquote>');
        continue;
      }
      if (/^\s*\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        out.push(mdTable(rows));
        continue;
      }
      if (line.trim() === '') { i++; continue; }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push('<p>' + buf.map((l) => mdInline(esc(l))).join('<br>') + '</p>');
    }
    return out.join('\n');
  }

  /* ---------------- state ---------------- */

  const state = {
    tab: 'chat',
    chatActive: 0,        // server-wide running turns (from /api/status)
    statusTimer: null,
    threads: [],
    threadTitles: {},     // thread id -> title derived from first user message
  };

  const chat = {
    threadId: null, es: null, seen: new Set(),
    turnActive: false, block: null, buf: '', lastChip: null,
    thinkingEl: null, pinned: true, pendingEcho: null,
  };

  const flagsState = { data: null, showDismissed: false, localDismissed: new Set() };
  const diffs = { repo: 'corpus', files: [], checked: new Set(), pathFilter: null };
  const fileView = { path: null, start: 1, count: 200, total: 0 };

  /* ---------------- tabs + status bar ---------------- */

  function showTab(name) {
    state.tab = name;
    for (const b of document.querySelectorAll('#tabs .tab-btn')) {
      b.classList.toggle('active', b.dataset.tab === name);
    }
    for (const p of document.querySelectorAll('.panel')) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    }
    if (name === 'flags' && !flagsState.data) loadFlags();
    if (name === 'diffs') loadDiffs();
    if (name === 'chat') $('chat-input').focus();
  }

  function updateSpinner() {
    $('st-spinner').classList.toggle('hidden', !(state.chatActive > 0 || chat.turnActive));
  }

  function updateBadge(el, label, n) {
    el.textContent = label + ' ' + n;
    el.classList.toggle('hidden', !n);
  }

  function renderStatus(s) {
    const idx = s.index || {};
    $('st-index').textContent = Number(idx.chunks || 0).toLocaleString() + ' chunks';
    $('st-index').title = (idx.files || 0) + ' files indexed';
    $('st-fresh').textContent =
      idx.last_scan_age_s == null ? '' : 'index fresh ' + fmtAge(idx.last_scan_age_s) + ' ago';
    const git = s.git || {};
    updateBadge($('st-corpus'), 'corpus', (git.corpus || {}).dirty || 0);
    updateBadge($('st-repo'), 'repo', (git.repo || {}).dirty || 0);
    state.chatActive = s.chat_active || 0;
    updateSpinner();
  }

  async function pollStatus() {
    try { renderStatus(await api('/api/status', { silent: true })); } catch (e) { /* backend down; retry next tick */ }
  }

  function startPolling() {
    stopPolling();
    pollStatus();
    state.statusTimer = setInterval(pollStatus, 10000);
  }

  function stopPolling() {
    if (state.statusTimer) { clearInterval(state.statusTimer); state.statusTimer = null; }
  }

  /* ---------------- threads sidebar ---------------- */

  function threadLabel(t) {
    return t.title || state.threadTitles[t.id] || 'New thread';
  }

  function renderThreadList() {
    $('thread-list').replaceChildren(...state.threads.map((t) =>
      h('li', { class: 'thread' + (t.id === chat.threadId ? ' active' : ''), onclick: () => selectThread(t.id) },
        h('span', { class: 'thread-title', title: threadLabel(t) }, threadLabel(t)),
        h('button', {
          class: 'thread-del', title: 'Delete thread',
          onclick: (e) => { e.stopPropagation(); deleteThread(t.id); },
        }, '×'))));
  }

  async function loadThreads() {
    const d = await api('/api/threads');
    state.threads = (d.threads || []).slice().sort((a, b) =>
      String(b.last_active || b.created_at || '').localeCompare(String(a.last_active || a.created_at || '')));
    renderThreadList();
    fetchMissingTitles();
  }

  // Untitled threads get their sidebar label from their first user message.
  function fetchMissingTitles() {
    for (const t of state.threads) {
      if (t.title || state.threadTitles[t.id] !== undefined) continue;
      state.threadTitles[t.id] = null; // sentinel: fetch in flight, don't refetch
      api('/api/threads/' + t.id + '/messages', { silent: true }).then((d) => {
        for (const m of d.messages || []) {
          try {
            const p = JSON.parse(m.content);
            if (p.kind === 'user_text' && p.text) {
              state.threadTitles[t.id] = truncate(p.text, 42);
              renderThreadList();
              return;
            }
          } catch (e) { /* unparsable row; keep looking */ }
        }
      }).catch(() => {});
    }
  }

  async function newThread() {
    const r = await api('/api/threads', { method: 'POST', body: {} });
    await loadThreads();
    await selectThread(r.id);
    showTab('chat');
  }

  async function deleteThread(id) {
    if (!confirm('Delete this thread?')) return;
    await api('/api/threads/' + id, { method: 'DELETE' });
    if (chat.threadId === id) {
      closeStream();
      chat.threadId = null;
      clearChat();
    }
    await loadThreads();
  }

  /* ---------------- chat ---------------- */

  function scrollChatBottom() {
    const m = $('chat-messages');
    m.scrollTop = m.scrollHeight;
  }

  function appendMsg(node) {
    $('chat-messages').append(node);
    if (chat.pinned) scrollChatBottom();
  }

  function setTurnActive(on) {
    chat.turnActive = on;
    $('chat-input').disabled = on;
    $('send-btn').disabled = on;
    $('stop-btn').classList.toggle('hidden', !on);
    if (!on) removeThinking();
    updateSpinner();
  }

  function clearChat() {
    $('chat-messages').replaceChildren();
    chat.seen = new Set();
    chat.block = null;
    chat.buf = '';
    chat.lastChip = null;
    chat.thinkingEl = null;
    chat.pinned = true;
    chat.pendingEcho = null;
    setTurnActive(false);
  }

  function ensureBlock() {
    if (!chat.block) {
      chat.buf = '';
      chat.block = h('div', { class: 'msg assistant md' });
      appendMsg(chat.block);
    }
  }

  function renderBlock() {
    chat.block.innerHTML = renderMarkdown(chat.buf);
    if (chat.pinned) scrollChatBottom();
  }

  function closeBlock() {
    chat.block = null;
    chat.buf = '';
  }

  function showThinking() {
    if (!chat.thinkingEl) {
      chat.thinkingEl = h('div', { class: 'thinking' }, 'thinking…');
      appendMsg(chat.thinkingEl);
    }
  }

  function removeThinking() {
    if (chat.thinkingEl) { chat.thinkingEl.remove(); chat.thinkingEl = null; }
  }

  // Renders one chat event (live SSE or replayed message row).
  // meta: {turn, seq} fallbacks from the message row, plus replay flag.
  function handleEvent(p, meta) {
    meta = meta || {};
    const turn = p.turn != null ? p.turn : meta.turn;
    const seq = p.seq != null ? p.seq : meta.seq;
    if (turn != null && seq != null) {
      const key = turn + ':' + seq;   // reconnects replay events; drop dupes
      if (chat.seen.has(key)) return;
      chat.seen.add(key);
    }
    if (p.kind !== 'thinking') removeThinking();
    switch (p.kind) {
      case 'user_text': {
        // Skip the SSE echo of the message we just rendered optimistically.
        if (!meta.replay && chat.pendingEcho !== null && p.text === chat.pendingEcho) {
          chat.pendingEcho = null;
          return;
        }
        closeBlock();
        appendMsg(h('div', { class: 'msg user' }, p.text));
        break;
      }
      case 'init':
        closeBlock();
        if (!meta.replay) setTurnActive(true);
        break;
      case 'text_delta':
        ensureBlock();
        chat.buf += p.text;
        renderBlock();
        if (!meta.replay) setTurnActive(true);
        break;
      case 'assistant_text':
        // Complete block: replaces whatever deltas accumulated for it.
        ensureBlock();
        chat.buf = p.text;
        renderBlock();
        closeBlock();
        break;
      case 'tool_use': {
        closeBlock();
        const pre = h('pre', { class: 'chip-result hidden' });
        const chip = h('div', { class: 'tool-chip' },
          h('button', {
            class: 'chip-head', title: 'Toggle tool result',
            onclick: () => pre.classList.toggle('hidden'),
          }, '⚙ ', h('b', null, p.name || 'tool'), ' ',
            h('span', { class: 'chip-input' }, truncate(p.input_preview || '', 90))),
          pre);
        chip._pre = pre;
        chat.lastChip = chip;
        appendMsg(chip);
        if (!meta.replay) setTurnActive(true);
        break;
      }
      case 'tool_result':
        if (chat.lastChip) {
          chat.lastChip._pre.textContent = p.preview == null ? '' : String(p.preview);
          if (p.is_error) chat.lastChip.classList.add('chip-error');
        }
        break;
      case 'thinking':
        if (!meta.replay) { showThinking(); setTurnActive(true); }
        break;
      case 'result': {
        closeBlock();
        const dur = p.duration_s == null ? '' : ' ' + Number(p.duration_s).toFixed(1) + 's';
        appendMsg(h('div', { class: 'msg-meta' }, (p.ok ? '✓' : '✗') + dur));
        setTurnActive(false);
        break;
      }
      case 'error':
        closeBlock();
        appendMsg(h('div', { class: 'msg error' }, p.message || 'error'));
        if (!meta.replay) toast(p.message || 'Chat error', 'error');
        break;
      case 'done':
        setTurnActive(false);
        break;
      default:
        break; // unknown kinds: ignore
    }
  }

  function closeStream() {
    if (chat.es) { chat.es.close(); chat.es = null; }
  }

  function openStream(threadId) {
    closeStream();
    const es = new EventSource('/api/threads/' + threadId + '/stream');
    chat.es = es;
    es.onmessage = (ev) => {
      let p;
      try { p = JSON.parse(ev.data); } catch (e) { return; }
      if (chat.threadId === threadId) handleEvent(p, {});
    };
    // EventSource auto-reconnects; the (turn,seq) dedupe absorbs replays.
  }

  async function selectThread(id) {
    if (chat.threadId === id) return;
    closeStream();
    chat.threadId = id;
    clearChat();
    renderThreadList();
    try {
      const d = await api('/api/threads/' + id + '/messages');
      if (chat.threadId !== id) return; // user switched again mid-load
      for (const m of d.messages || []) {
        let p;
        try { p = JSON.parse(m.content); } catch (e) { continue; }
        handleEvent(p, { turn: m.turn, seq: m.seq, replay: true });
      }
      closeBlock();
      setTurnActive(false); // live SSE events will re-arm if a turn is running
      scrollChatBottom();
    } finally {
      if (chat.threadId === id) openStream(id);
    }
  }

  async function sendMessage() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || chat.turnActive) return;
    try {
      if (!chat.threadId) {
        const r = await api('/api/threads', { method: 'POST', body: {} });
        await loadThreads();
        await selectThread(r.id);
      }
      const tid = chat.threadId;
      closeBlock();
      appendMsg(h('div', { class: 'msg user' }, text));
      chat.pendingEcho = text;
      input.value = '';
      chat.pinned = true;
      scrollChatBottom();
      setTurnActive(true);
      if (!state.threadTitles[tid]) {
        state.threadTitles[tid] = truncate(text, 42);
        renderThreadList();
      }
      await api('/api/threads/' + tid + '/message', { method: 'POST', body: { text } });
    } catch (e) {
      // 409 (turn already running / global cap) or network error: toast shown by api()
      chat.pendingEcho = null;
      setTurnActive(false);
    }
  }

  async function stopTurn() {
    if (!chat.threadId) return;
    try {
      await api('/api/threads/' + chat.threadId + '/interrupt', { method: 'POST', body: {} });
    } catch (e) { /* toast already shown */ }
  }

  /* ---------------- search ---------------- */

  function srcBadge(source) {
    const s = source || '?';
    return h('span', { class: 'badge badge-' + s }, s);
  }

  function markSnippet(snippet) {
    // >>match<< markers arrive inside the snippet text.
    return esc(snippet).replace(/&gt;&gt;([\s\S]*?)&lt;&lt;/g, '<mark>$1</mark>');
  }

  async function runSearch() {
    const q = $('search-q').value.trim();
    if (!q) return;
    const params = new URLSearchParams({ q });
    for (const [id, name] of [['f-lang', 'lang'], ['f-series', 'series'], ['f-source', 'source']]) {
      const v = $(id).value;
      if (v !== 'any') params.set(name, v);
    }
    params.set('kind', $('f-kind').value);
    params.set('limit', $('f-limit').value || '30');
    const box = $('search-results');
    box.replaceChildren(h('div', { class: 'empty' }, 'Searching…'));
    try {
      const d = await api('/api/search?' + params.toString());
      renderResults(d.results || []);
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, 'Search failed.'));
    }
  }

  function renderResults(results) {
    const box = $('search-results');
    box.replaceChildren(h('div', { class: 'result-count' },
      results.length + ' result' + (results.length === 1 ? '' : 's')));
    for (const r of results) box.append(resultCard(r));
  }

  function resultCard(r) {
    const meta = [];
    if (r.series != null && r.series !== '') meta.push('S' + r.series);
    if (r.volume != null && r.volume !== '') meta.push('Vol ' + r.volume);
    if (r.chapter_label) meta.push(r.chapter_label);
    if (r.chapter_title) meta.push(r.chapter_title);
    if (r.subtitle) meta.push('“' + r.subtitle + '”');
    if (r.part_title) meta.push(r.part_title);
    const expand = h('div', { class: 'card-expand hidden' });
    const head = h('div', { class: 'card-head', onclick: () => toggleExpand(r, expand) },
      h('div', { class: 'card-top' },
        srcBadge(r.source),
        r.lang ? h('span', { class: 'lang-tag' }, r.lang) : null,
        h('span', { class: 'card-meta' }, meta.join(' · '))),
      h('div', { class: 'card-path mono' }, r.path + ':' + r.start_line + '-' + r.end_line),
      h('div', { class: 'card-snippet', html: markSnippet(r.snippet || '') }));
    return h('div', { class: 'result-card' }, head, expand);
  }

  async function toggleExpand(r, expand) {
    if (!expand.classList.contains('hidden')) {
      expand.classList.add('hidden');
      return;
    }
    expand.classList.remove('hidden');
    if (expand.dataset.loaded) return;
    expand.textContent = 'Loading context…';
    try {
      const d = await api('/api/chunk/' + r.chunk_id + '?before=2&after=2');
      expand.dataset.loaded = '1';
      const row = d.row || {};
      const items = (d.neighbors || []).map((n) => ({ ...n, hit: false }));
      items.push({ ord: row.ord, start_line: row.start_line, end_line: row.end_line, text: row.text, hit: true });
      items.sort((a, b) => (a.ord || 0) - (b.ord || 0));
      expand.replaceChildren(
        ...items.map((it) => h('div', { class: 'ctx-chunk' + (it.hit ? ' hit' : '') },
          h('div', { class: 'ctx-lines mono' }, it.start_line + '-' + it.end_line),
          h('div', { class: 'ctx-text' }, it.text || ''))),
        h('button', {
          class: 'linkish',
          onclick: (e) => {
            e.stopPropagation();
            openFileModal(row.path, Math.max(1, (row.start_line || 1) - 40));
          },
        }, 'view more in ' + (row.path || 'file')));
    } catch (e) {
      expand.textContent = 'Failed to load context.';
    }
  }

  /* -- windowed file viewer (modal) -- */

  async function openFileModal(path, start) {
    fileView.path = path;
    fileView.start = Math.max(1, start || 1);
    await loadFilePage();
  }

  async function loadFilePage() {
    const params = new URLSearchParams({
      path: fileView.path,
      start: String(fileView.start),
      count: String(fileView.count),
    });
    const d = await api('/api/file?' + params.toString());
    fileView.total = d.total_lines || 0;
    fileView.start = d.start || fileView.start;
    const lines = d.lines || [];
    const width = String(fileView.start + lines.length).length;
    const body = h('pre', { class: 'file-view' },
      lines.map((ln, i) => String(fileView.start + i).padStart(width) + '  ' + ln).join('\n'));
    const end = fileView.start + lines.length - 1;
    const prev = h('button', { onclick: () => { fileView.start = Math.max(1, fileView.start - fileView.count); loadFilePage(); } }, '← Prev');
    const next = h('button', { onclick: () => { fileView.start = fileView.start + fileView.count; loadFilePage(); } }, 'Next →');
    if (fileView.start <= 1) prev.disabled = true;
    if (end >= fileView.total) next.disabled = true;
    const label = h('span', { class: 'dim' },
      'lines ' + fileView.start + '–' + end + ' of ' + fileView.total);
    openModal(d.path || fileView.path, body, [prev, label, next]);
  }

  /* -- alignment sub-panel -- */

  async function loadAlign() {
    const params = new URLSearchParams();
    const s = $('al-series').value;
    if (s !== 'any') params.set('series', s);
    const v = $('al-volume').value.trim();
    if (v) params.set('volume', v);
    const box = $('align-results');
    box.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    try {
      const d = await api('/api/align?' + params.toString());
      renderAlign(d.rows || []);
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, 'Failed to load alignment.'));
    }
  }

  function renderAlign(rows) {
    const box = $('align-results');
    box.replaceChildren();
    if (!rows.length) {
      box.append(h('div', { class: 'empty' }, 'No alignment rows.'));
      return;
    }
    // volume -> (source/lang key -> column)
    const volumes = new Map();
    for (const r of rows) {
      const vk = String(r.volume == null ? '?' : r.volume);
      if (!volumes.has(vk)) volumes.set(vk, new Map());
      const cols = volumes.get(vk);
      const ck = (r.source || '?') + '/' + (r.lang || '?');
      if (!cols.has(ck)) cols.set(ck, { source: r.source, lang: r.lang, rows: [] });
      cols.get(ck).rows.push(r);
    }
    const srcOrder = ['official', 'fan', 'jp', 'zh', 'raw', 'notes', 'docs'];
    const srcIdx = (s) => {
      const i = srcOrder.indexOf(s);
      return i === -1 ? 99 : i;
    };
    const volKeys = [...volumes.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const vk of volKeys) {
      box.append(h('h3', { class: 'al-vol' }, 'Volume ' + vk));
      const cols = [...volumes.get(vk).values()].sort((a, b) => srcIdx(a.source) - srcIdx(b.source));
      box.append(h('div', { class: 'al-row' }, cols.map((col) =>
        h('div', { class: 'al-col' },
          h('div', { class: 'al-col-head' },
            srcBadge(col.source),
            col.lang ? h('span', { class: 'lang-tag' }, col.lang) : null),
          col.rows.slice().sort((a, b) => (a.ord || 0) - (b.ord || 0)).map((ch) => {
            // Same subtitle_key => same pastel tint across languages/sources.
            const style = ch.subtitle_key
              ? 'background:hsla(' + hashHue(String(ch.subtitle_key)) + ',60%,60%,0.16)'
              : null;
            const title = [ch.title, ch.subtitle].filter(Boolean).join(' — ')
              + (ch.part_title ? ' · ' + ch.part_title : '');
            return h('div', { class: 'al-ch', style, title: ch.path },
              h('span', { class: 'al-label' }, ch.chapter_label || ''),
              h('span', { class: 'al-title', title }, title),
              h('span', { class: 'al-lines mono' }, ch.start_line + '-' + ch.end_line));
          })))));
    }
  }

  /* ---------------- flags (lint) ---------------- */

  function flagKey(f) {
    return f.category + '|' + f.key;
  }

  async function loadFlags() {
    const url = '/api/lint' + (flagsState.showDismissed ? '?include_dismissed=1' : '');
    const d = await api(url);
    flagsState.data = d;
    renderFlags();
  }

  async function rerunLint() {
    const btn = $('lint-rerun');
    btn.disabled = true;
    btn.textContent = 'Running…';
    try {
      await api('/api/reindex', { method: 'POST', body: {} });
      await loadFlags();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Re-run lint';
    }
  }

  function markToken(snippet, token) {
    let out = esc(snippet == null ? '' : snippet);
    if (token) {
      const t = esc(token);
      out = out.split(t).join('<mark>' + t + '</mark>');
    }
    return out;
  }

  function flagRow(fl) {
    const dismissed = !!fl.dismissed || flagsState.localDismissed.has(flagKey(fl));
    const chipClass = fl.manual ? 'chip-manual'
      : (fl.category === 'nearmiss' ? 'chip-nearmiss' : 'chip-regression');
    let desc;
    if (fl.category === 'nearmiss') {
      desc = h('span', null, h('b', null, fl.key),
        fl.closest ? [' — did you mean ', h('b', null, fl.closest), '?'] : null);
    } else {
      const bits = [];
      if (fl.rule != null) bits.push('rule ' + fl.rule + ': ');
      bits.push("'" + (fl.find != null ? fl.find : fl.key) + "' → '" + (fl.replace != null ? fl.replace : '') + "'");
      if (fl.matched) bits.push(", matched '" + fl.matched + "'");
      if (fl.count) bits.push(' ×' + fl.count);
      desc = h('span', null, bits.join(''));
    }
    const row = h('div', { class: 'flag' + (dismissed ? ' dismissed' : '') },
      h('div', { class: 'flag-head' },
        h('span', { class: 'chip ' + chipClass }, fl.manual ? 'manual' : fl.category),
        desc,
        h('button', {
          class: 'btn-sm flag-btn',
          onclick: (e) => dismissFlag(fl, row, dismissed, e.target),
        }, dismissed ? 'Undismiss' : 'Dismiss')),
      h('div', { class: 'flag-locs' }, (fl.locations || []).map((loc) =>
        h('div', { class: 'loc mono' },
          h('span', { class: 'loc-path' }, loc.path + ':' + loc.line),
          h('span', { class: 'loc-snippet', html: markToken(loc.snippet, fl.matched || fl.key || fl.find) })))));
    return row;
  }

  async function dismissFlag(fl, row, wasDismissed, btn) {
    const key = flagKey(fl);
    // Optimistic: flip UI first, revert on failure.
    if (wasDismissed) flagsState.localDismissed.delete(key);
    else flagsState.localDismissed.add(key);
    if (!wasDismissed && !flagsState.showDismissed) row.classList.add('hidden');
    else {
      row.classList.toggle('dismissed', !wasDismissed);
      btn.textContent = wasDismissed ? 'Dismiss' : 'Undismiss';
    }
    try {
      await api('/api/lint/' + (wasDismissed ? 'undismiss' : 'dismiss'),
        { method: 'POST', body: { category: fl.category, key: fl.key } });
      if (flagsState.showDismissed) loadFlags(); // pick up server's dismissed state
    } catch (e) {
      if (wasDismissed) flagsState.localDismissed.add(key);
      else flagsState.localDismissed.delete(key);
      row.classList.remove('hidden');
      row.classList.toggle('dismissed', wasDismissed);
      btn.textContent = wasDismissed ? 'Undismiss' : 'Dismiss';
    }
  }

  function renderFlags() {
    const d = flagsState.data;
    const list = $('flags-list');
    list.replaceChildren();
    if (!d) return;
    $('flags-total').textContent = (d.total || 0) + ' flag' + (d.total === 1 ? '' : 's');
    $('flags-generated').textContent = d.generated_at ? 'generated ' + d.generated_at : '';
    const files = d.files || [];
    if (!files.length) {
      list.append(h('div', { class: 'empty' }, 'No flags. Clean corpus.'));
      return;
    }
    for (const f of files) {
      const flags = f.flags || [];
      list.append(h('details', { open: '' },
        h('summary', null,
          h('span', { class: 'mono' }, f.path),
          h('span', { class: 'count-pill' }, flags.length)),
        flags.map((fl) => flagRow(fl))));
    }
  }

  /* ---------------- diffs (git) ---------------- */

  function setRepo(repo) {
    diffs.repo = repo;
    diffs.pathFilter = null;
    loadDiffs();
  }

  async function loadDiffs() {
    $('repo-corpus').classList.toggle('active', diffs.repo === 'corpus');
    $('repo-repo').classList.toggle('active', diffs.repo === 'repo');
    await Promise.all([
      loadGitStatus().catch(() => {}),
      loadGitDiff().catch(() => {}),
      loadGitLog().catch(() => {}),
    ]);
  }

  async function loadGitStatus() {
    const d = await api('/api/git/status?repo=' + diffs.repo);
    diffs.files = d.files || [];
    diffs.checked = new Set(diffs.files.map((f) => f.path));
    renderFileList();
  }

  function renderFileList() {
    const box = $('diff-files');
    box.replaceChildren();
    if (!diffs.files.length) {
      box.append(h('div', { class: 'empty' }, 'Working tree clean.'));
      return;
    }
    box.append(h('div', {
      class: 'file-row all' + (diffs.pathFilter ? '' : ' selected'),
      onclick: () => { diffs.pathFilter = null; renderFileList(); loadGitDiff(); },
    }, 'All files (' + diffs.files.length + ')'));
    for (const f of diffs.files) {
      const st = String(f.status || 'M').trim();
      const cb = h('input', {
        type: 'checkbox',
        onclick: (e) => {
          e.stopPropagation();
          if (e.target.checked) diffs.checked.add(f.path);
          else diffs.checked.delete(f.path);
        },
      });
      cb.checked = diffs.checked.has(f.path);
      box.append(h('div', {
        class: 'file-row' + (diffs.pathFilter === f.path ? ' selected' : ''),
        onclick: () => { diffs.pathFilter = f.path; renderFileList(); loadGitDiff(); },
      },
        cb,
        h('span', { class: 'git-st st-' + st.replace(/\?/g, 'q') }, st || 'M'),
        h('span', { class: 'mono file-path', title: f.path }, f.path)));
    }
  }

  async function loadGitDiff() {
    let url = '/api/git/diff?repo=' + diffs.repo;
    if (diffs.pathFilter) url += '&path=' + encodeURIComponent(diffs.pathFilter);
    const d = await api(url);
    renderDiffText(d.diff || '');
  }

  function renderDiffText(text) {
    const box = $('diff-view');
    if (!text.trim()) {
      box.replaceChildren(h('div', { class: 'empty' }, 'No diff.'));
      return;
    }
    box.innerHTML = text.split('\n').map((line) => {
      let cls = 'ctx';
      if (line.startsWith('diff --git') || line.startsWith('index ')
        || line.startsWith('new file') || line.startsWith('deleted file')
        || line.startsWith('similarity') || line.startsWith('rename')) cls = 'meta';
      else if (line.startsWith('+++') || line.startsWith('---')) cls = 'file';
      else if (line.startsWith('@@')) cls = 'hunk';
      else if (line.startsWith('+')) cls = 'add';
      else if (line.startsWith('-')) cls = 'del';
      return '<div class="dl ' + cls + '">' + (esc(line) || '&nbsp;') + '</div>';
    }).join('');
  }

  async function loadGitLog() {
    const d = await api('/api/git/log?repo=' + diffs.repo + '&n=20');
    $('git-log').replaceChildren(...(d.log || []).map((c) =>
      h('div', { class: 'log-row' },
        h('span', { class: 'mono log-hash' }, String(c.hash || '').slice(0, 8)),
        h('span', { class: 'log-subject', title: c.subject }, c.subject || ''),
        h('span', { class: 'log-date' }, c.date || ''))));
  }

  async function doCommit() {
    const msg = $('commit-msg').value.trim();
    const paths = [...diffs.checked];
    if (!msg) { toast('Commit message required', 'error'); return; }
    if (!paths.length) { toast('No files checked', 'error'); return; }
    const btn = $('commit-btn');
    btn.disabled = true;
    try {
      const d = await api('/api/git/commit',
        { method: 'POST', body: { repo: diffs.repo, message: msg, paths } });
      if (d.error) { toast(d.error, 'error'); return; }
      toast('Committed ' + String(d.hash || '').slice(0, 8), 'ok');
      $('commit-msg').value = '';
      diffs.pathFilter = null;
      await loadDiffs();
      pollStatus(); // refresh the dirty badges promptly
    } catch (e) {
      /* toast already shown */
    } finally {
      btn.disabled = false;
    }
  }

  async function openCoverage() {
    try {
      const d = await api('/api/coverage');
      openModal('Coverage',
        h('div', { class: 'md coverage', html: renderMarkdown(d.markdown || '') }));
    } catch (e) { /* toast already shown */ }
  }

  /* ---------------- wiring + init ---------------- */

  function wireEvents() {
    // tabs
    for (const b of document.querySelectorAll('#tabs .tab-btn')) {
      b.addEventListener('click', () => showTab(b.dataset.tab));
    }
    $('sidebar-toggle').addEventListener('click', () => $('sidebar').classList.toggle('collapsed'));
    $('st-corpus').addEventListener('click', () => { diffs.repo = 'corpus'; diffs.pathFilter = null; showTab('diffs'); });
    $('st-repo').addEventListener('click', () => { diffs.repo = 'repo'; diffs.pathFilter = null; showTab('diffs'); });

    // threads
    $('new-thread-btn').addEventListener('click', newThread);

    // chat
    $('send-btn').addEventListener('click', sendMessage);
    $('stop-btn').addEventListener('click', stopTurn);
    $('chat-input').addEventListener('keydown', (e) => {
      // Enter or Ctrl+Enter sends; Shift+Enter inserts a newline.
      // isComposing: never send while a CJK IME conversion is in progress.
      if (e.isComposing) return;
      if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        sendMessage();
      }
    });
    const mlist = $('chat-messages');
    mlist.addEventListener('scroll', () => {
      chat.pinned = mlist.scrollHeight - mlist.scrollTop - mlist.clientHeight < 40;
      $('jump-latest').classList.toggle('hidden', chat.pinned);
    });
    $('jump-latest').addEventListener('click', () => {
      chat.pinned = true;
      scrollChatBottom();
      $('jump-latest').classList.add('hidden');
    });

    // search
    $('search-btn').addEventListener('click', runSearch);
    $('search-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) runSearch();
    });
    $('al-load').addEventListener('click', loadAlign);

    // flags
    $('lint-rerun').addEventListener('click', rerunLint);
    $('flags-show-dismissed').addEventListener('change', (e) => {
      flagsState.showDismissed = e.target.checked;
      loadFlags();
    });

    // diffs
    $('repo-corpus').addEventListener('click', () => setRepo('corpus'));
    $('repo-repo').addEventListener('click', () => setRepo('repo'));
    $('commit-btn').addEventListener('click', doCommit);
    $('commit-msg').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doCommit();
    });
    $('coverage-btn').addEventListener('click', openCoverage);

    // modal
    $('modal-close').addEventListener('click', closeModal);
    $('modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('modal-backdrop')) closeModal();
    });

    // keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalOpen()) { closeModal(); return; }
      const typing = e.target && e.target.matches
        && e.target.matches('input, textarea, select');
      if (e.key === '/' && state.tab === 'search' && !typing && !modalOpen()) {
        e.preventDefault();
        $('search-q').focus();
      }
    });

    // status polling pauses while the browser tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopPolling();
      else startPolling();
    });
  }

  async function init() {
    wireEvents();
    startPolling();
    try {
      await loadThreads();
      if (state.threads.length) await selectThread(state.threads[0].id);
    } catch (e) { /* backend not up yet; toast already shown */ }
  }

  return { init, showTab };
})();

document.addEventListener('DOMContentLoaded', App.init);
