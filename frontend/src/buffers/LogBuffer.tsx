import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../app/settings';
import { useWorkspace } from '../app/workspace';
import { fmtWhen, repoLabel } from '../git/fmt';
import { gitLog } from '../git/gitApi';
import type { GitLogEntry, RepoName } from '../types';
import { bufferId } from '../workspace/buffers';

const PAGE = 30;

/** Paged commit log; with a path it becomes that file's history (--follow).
 * Rows open the commit buffer; keyboard n/p (or j/k in vim keymap)/RET on
 * the container. */
export function LogBuffer({ repo, path }: { repo: RepoName; path?: string | null }) {
  const ws = useWorkspace();
  const { keymap } = useSettings();
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = nothing pointed at yet; don't highlight a row until the user
  // actually clicks or presses a nav key
  const [point, setPoint] = useState<number | null>(null);
  const seqRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());

  const loadPage = useCallback(async (skip: number) => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const r = await gitLog(repo, { n: PAGE, skip, path: path ?? null });
      if (seq !== seqRef.current) return;
      setEntries((prev) => (skip === 0 ? r.log : [...prev, ...r.log]));
      setHasMore(r.has_more);
      setError(null);
    } catch (e) {
      if (seq === seqRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [repo, path]);

  useEffect(() => {
    setEntries([]);
    setPoint(null);
    void loadPage(0);
  }, [loadPage]);

  useEffect(() => {
    if (point !== null) rowEls.current.get(point)?.scrollIntoView({ block: 'nearest' });
  }, [point]);

  // Buffer stays mounted (CSS-hidden) across tab switches; grab focus on
  // activation so keyboard nav works without clicking a row first
  const active = ws.activeId === bufferId({ kind: 'log', repo, path });
  useEffect(() => { if (active) containerRef.current?.focus(); }, [active]);

  const openCommit = (e: GitLogEntry) => ws.open({ kind: 'commit', repo, rev: e.oid });

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Tab never gets to do browser default focus-cycling in here
    if (e.key === 'Tab') { e.preventDefault(); return; }
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    const down = () => setPoint((i) => (i === null ? 0 : Math.min(entries.length - 1, i + 1)));
    const up = () => setPoint((i) => (i === null ? entries.length - 1 : Math.max(0, i - 1)));
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); down(); break;
      case 'ArrowUp': e.preventDefault(); up(); break;
      case 'j': if (keymap === 'vim') { e.preventDefault(); down(); } break;
      case 'k': if (keymap === 'vim') { e.preventDefault(); up(); } break;
      case 'n': if (keymap !== 'vim') { e.preventDefault(); down(); } break;
      case 'p': if (keymap !== 'vim') { e.preventDefault(); up(); } break;
      case 'Enter':
        if (point !== null && entries[point]) { e.preventDefault(); openCommit(entries[point]); }
        break;
      case 's': e.preventDefault(); ws.open({ kind: 'magit', repo }); break;
    }
  };

  return (
    <div className="log-buffer" tabIndex={0} ref={containerRef} onKeyDown={onKey}>
      <div className="log-head">
        <span className="log-title">
          {path ? <>History: <code className="mono">{path}</code></> : 'Commit log'}
        </span>
        {path && <span className="dim">follows renames</span>}
        <span className="toolbar-spacer" />
        <span className="magit-keys dim">
          {keymap === 'vim' ? 'j/k move' : 'n/p move'} · RET open · s status
        </span>
        <span className="log-repo dim">{repoLabel(repo)}</span>
      </div>
      {error && (
        <div className="magit-error">
          {error} <button className="btn btn-sm" onClick={() => void loadPage(0)}>Retry</button>
        </div>
      )}
      <div className="log-body">
        {entries.map((e, i) => (
          <div
            key={e.oid + ':' + i}
            className={'magit-row log-buffer-row' + (i === point ? ' point' : '')}
            ref={(el) => { if (el) rowEls.current.set(i, el); else rowEls.current.delete(i); }}
            onClick={() => {
              containerRef.current?.focus();
              setPoint(i);
              openCommit(e);
            }}
          >
            <span className="log-hash mono">{e.hash}</span>
            <span className="log-subject" title={e.subject}>{e.subject}</span>
            <span className="log-author dim">{e.author}</span>
            <span className="log-date dim">{fmtWhen(e.date)}</span>
          </div>
        ))}
        {entries.length === 0 && !loading && !error && (
          <div className="empty">No commits.</div>
        )}
        {loading && <div className="empty">Loading…</div>}
        {hasMore && !loading && (
          <button className="btn btn-sm log-more" onClick={() => void loadPage(entries.length)}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
