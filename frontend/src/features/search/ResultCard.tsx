import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { esc } from '@/lib/markdown';
import type { ChunkResponse, SearchResult } from '@/lib/types';

/** Snippet text arrives with >>match<< markers; render them as <mark>. */
function markSnippet(snippet: string): string {
  return esc(snippet).replace(/&gt;&gt;([\s\S]*?)&lt;&lt;/g, '<mark>$1</mark>');
}

interface CtxChunk {
  ord: number;
  startLine: number;
  endLine: number;
  text: string;
  hit: boolean;
}

/** One search hit. Clicking the card opens the file at the matched line;
 * "context" expands neighbor chunks inline, "view" pages the file in a modal.
 * Paths passed out are corpus-relative; the caller maps them to buffers. */
export function ResultCard({ r, onOpen, onView }: {
  r: SearchResult;
  onOpen: (path: string, line: number) => void;
  onView: (path: string, start: number) => void;
}) {
  const [open, setOpen] = useState(false);

  // Context chunks load lazily on first expand and are cached forever (a chunk's
  // neighbors don't move); enabled:open gates the fetch until the card opens.
  const chunk = useQuery({
    queryKey: ['chunk', r.chunk_id],
    queryFn: () => api<ChunkResponse>(`/api/chunk/${r.chunk_id}?before=2&after=2`),
    enabled: open,
    staleTime: Infinity,
  });
  const loading = chunk.isFetching;
  const ctxFailed = chunk.isError;
  const ctx = useMemo<CtxChunk[] | null>(() => {
    const d = chunk.data;
    if (!d) return null;
    const row = d.row || ({} as ChunkResponse['row']);
    const items: CtxChunk[] = (d.neighbors || []).map((n) => ({
      ord: n.ord ?? 0,
      startLine: n.start_line,
      endLine: n.end_line,
      text: n.text || '',
      hit: false,
    }));
    items.push({
      ord: typeof row.ord === 'number' ? row.ord : 0,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text || '',
      hit: true,
    });
    items.sort((a, b) => a.ord - b.ord);
    return items;
  }, [chunk.data]);

  const meta: string[] = [];
  if (r.series != null && r.series !== '') meta.push('S' + r.series);
  if (r.volume != null && r.volume !== '') meta.push('Vol ' + r.volume);
  if (r.chapter_label) meta.push(r.chapter_label);
  if (r.chapter_title) meta.push(r.chapter_title);
  if (r.subtitle) meta.push('“' + r.subtitle + '”');
  if (r.part_title) meta.push(r.part_title);

  const toggle = () => setOpen((v) => !v);

  return (
    <div className="result-card">
      <div
        className="card-head"
        title="Open in editor"
        onClick={() => onOpen(r.path, r.start_line || 1)}
      >
        <div className="card-top">
          <span className={'badge badge-' + (r.source || 'unknown')}>{r.source || '?'}</span>
          {r.lang && <span className="lang-tag">{r.lang}</span>}
          <span className="card-meta">{meta.join(' · ')}</span>
        </div>
        <div className="card-path mono">{r.path}:{r.start_line}-{r.end_line}</div>
        <div className="card-snippet" dangerouslySetInnerHTML={{ __html: markSnippet(r.snippet || '') }} />
      </div>
      <div className="card-actions">
        <button className="linkish" onClick={toggle}>
          {open ? 'hide context' : 'context'}
        </button>
        <button
          className="linkish"
          title="Page through the file"
          onClick={() => onView(r.path, Math.max(1, (r.start_line || 1) - 40))}
        >view</button>
      </div>
      {open && (
        <div className="card-expand">
          {loading && <div className="empty">Loading context…</div>}
          {ctxFailed && <div className="empty">Failed to load context.</div>}
          {ctx && ctx.map((it, i) => (
            <div key={i} className={'ctx-chunk' + (it.hit ? ' hit' : '')}>
              <div className="ctx-lines mono">{it.startLine}-{it.endLine}</div>
              <div className="ctx-text">{it.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
