import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { fmtWhen } from '../git/fmt';
import { gitLog } from '../git/gitApi';
import type { GitLogEntry, RepoName } from '../types';

const PAGE = 30;

/** Paged commit log; with a path it becomes that file's history (--follow).
 * Rows open the commit buffer; keyboard n/p/RET on the container. */
export function LogBuffer({ repo, path }: { repo: RepoName; path?: string | null }) {
  const ws = useWorkspace();
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [point, setPoint] = useState(0);
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
    setPoint(0);
    void loadPage(0);
  }, [loadPage]);

  useEffect(() => {
    rowEls.current.get(point)?.scrollIntoView({ block: 'nearest' });
  }, [point]);

  const openCommit = (e: GitLogEntry) => ws.open({ kind: 'commit', repo, rev: e.oid });

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    switch (e.key) {
      case 'n': case 'ArrowDown':
        e.preventDefault();
        setPoint((i) => Math.min(entries.length - 1, i + 1));
        break;
      case 'p': case 'ArrowUp':
        e.preventDefault();
        setPoint((i) => Math.max(0, i - 1));
        break;
      case 'Enter':
        if (entries[point]) { e.preventDefault(); openCommit(entries[point]); }
        break;
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
        <span className="log-repo dim">{repo === 'corpus' ? 'Corpus' : 'Translation'}</span>
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
