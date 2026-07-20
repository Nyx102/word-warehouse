import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useWorkspace } from '@/context/workspace';
import { ChunkModal } from '@/features/search/ChunkModal';
import { ResultCard } from '@/features/search/ResultCard';
import type { SearchResult } from '@/lib/types';

const LANGS = ['any', 'en', 'jp', 'zh', 'zh-s', 'zh-t'];
const SOURCES = ['any', 'official', 'fan', 'jp', 'zh', 'raw', 'notes', 'docs'];

/** Search section: compact query form + result list. The panel stays mounted
 * across section switches, so query and results survive. Result clicks open
 * file buffers at the matched line (corpus-relative paths get the corpus/
 * prefix the project-relative editor expects). */
export function SearchSidebar() {
  const ws = useWorkspace();
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('any');
  const [series, setSeries] = useState('any');
  const [source, setSource] = useState('any');
  const [kind, setKind] = useState('body');
  const [limit, setLimit] = useState('30');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fileModal, setFileModal] = useState<{ path: string; start: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // '/' focuses the query box while this section is active and no modal is open
  useEffect(() => {
    if (ws.rail !== 'search' || fileModal) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && typeof t.matches === 'function' && t.matches('input, textarea, select');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws.rail, fileModal]);

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    const params = new URLSearchParams({ q: query });
    if (lang !== 'any') params.set('lang', lang);
    if (series !== 'any') params.set('series', series);
    if (source !== 'any') params.set('source', source);
    params.set('kind', kind);
    params.set('limit', limit || '30');
    setSearching(true);
    setFailed(false);
    try {
      const d = await api<{ results: SearchResult[] }>('/api/search?' + params.toString());
      setResults(d.results || []);
    } catch {
      setFailed(true);
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const openFile = (path: string, line: number) => {
    ws.open({ kind: 'file', path: 'corpus/' + path, line });
    ws.setDrawerOpen(false);
  };

  const openAlign = () => {
    ws.open({ kind: 'align' });
    ws.setDrawerOpen(false);
  };

  return (
    <div className="search-side">
      <div className="ss-form">
        <input
          ref={inputRef}
          className="ss-q"
          type="search"
          value={q}
          placeholder="Search corpus…  ( / )"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void run(); }}
        />
        <div className="ss-grid">
          <select value={lang} onChange={(e) => setLang(e.target.value)} title="Language">
            {LANGS.map((l) => <option key={l} value={l}>{l === 'any' ? 'lang: any' : l}</option>)}
          </select>
          <select value={series} onChange={(e) => setSeries(e.target.value)} title="Series">
            <option value="any">series: any</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} title="Source">
            {SOURCES.map((s) => <option key={s} value={s}>{s === 'any' ? 'source: any' : s}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} title="Chunk kind">
            <option value="body">kind: body</option>
            <option value="all">kind: all</option>
          </select>
        </div>
        <div className="ss-actions">
          <input
            className="limit-input"
            type="number"
            min={1}
            max={500}
            value={limit}
            title="Max results"
            onChange={(e) => setLimit(e.target.value)}
          />
          <button className="btn btn-sm primary" onClick={() => void run()} disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
          <span className="toolbar-spacer" />
          <button className="btn btn-sm" onClick={openAlign} title="Chapter alignment matrix">
            Align matrix
          </button>
        </div>
      </div>
      <div className="ss-results">
        {searching && <div className="empty">Searching…</div>}
        {failed && !searching && <div className="empty">Search failed.</div>}
        {results && !searching && !failed && (
          <>
            <div className="result-count">
              {results.length} result{results.length === 1 ? '' : 's'}
            </div>
            {results.map((r) => (
              <ResultCard
                key={r.chunk_id}
                r={r}
                onOpen={openFile}
                onView={(path, start) => setFileModal({ path, start })}
              />
            ))}
          </>
        )}
        {!results && !searching && !failed && (
          <div className="empty">Type a query and press Enter.</div>
        )}
      </div>
      {fileModal && (
        <ChunkModal
          path={fileModal.path}
          initialStart={fileModal.start}
          onClose={() => setFileModal(null)}
          onEdit={(path, line) => { setFileModal(null); openFile(path, line); }}
        />
      )}
    </div>
  );
}
