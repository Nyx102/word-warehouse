import { useState } from 'react';
import { api } from '../api';
import { esc } from '../markdown';
import type { ChunkResponse, SearchResult } from '../types';

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

export function ResultCard({ r, onOpenFile, onEdit }: {
  r: SearchResult;
  onOpenFile: (path: string, start: number) => void;
  onEdit: (path: string, line: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<CtxChunk[] | null>(null);
  const [ctxFailed, setCtxFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const meta: string[] = [];
  if (r.series != null && r.series !== '') meta.push('S' + r.series);
  if (r.volume != null && r.volume !== '') meta.push('Vol ' + r.volume);
  if (r.chapter_label) meta.push(r.chapter_label);
  if (r.chapter_title) meta.push(r.chapter_title);
  if (r.subtitle) meta.push('“' + r.subtitle + '”');
  if (r.part_title) meta.push(r.part_title);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (ctx || loading) return;
    setLoading(true);
    try {
      const d = await api<ChunkResponse>(`/api/chunk/${r.chunk_id}?before=2&after=2`);
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
      setCtx(items);
      setCtxFailed(false);
    } catch {
      setCtxFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="result-card">
      <div className="card-head" onClick={() => void toggle()}>
        <div className="card-top">
          <span className={'badge badge-' + (r.source || 'unknown')}>{r.source || '?'}</span>
          {r.lang && <span className="lang-tag">{r.lang}</span>}
          <span className="card-meta">{meta.join(' · ')}</span>
        </div>
        <div className="card-path mono">
          {r.path}:{r.start_line}-{r.end_line}
          <button
            className="linkish card-edit"
            title="Open in the Files editor"
            onClick={(e) => { e.stopPropagation(); onEdit(r.path, r.start_line || 1); }}
          >edit</button>
        </div>
        <div className="card-snippet" dangerouslySetInnerHTML={{ __html: markSnippet(r.snippet || '') }} />
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
          {ctx && (
            <button
              className="linkish"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFile(r.path, Math.max(1, (r.start_line || 1) - 40));
              }}
            >view more in {r.path}</button>
          )}
        </div>
      )}
    </div>
  );
}
