import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useSettings } from '@/context/settings';
import { useWorkspace } from '@/context/workspace';
import { fmtWhen, repoLabel } from '@/features/git/fmt';
import { gitLog } from '@/features/git/gitApi';
import { gitKeys } from '@/features/git/gitKeys';
import type { GitLogEntry, RepoName } from '@/lib/types';
import { bufferId } from './buffers';

const PAGE = 30;

/** Paged commit log; with a path it becomes that file's history (--follow).
 * Rows open the commit buffer; keyboard n/p (or j/k in vim keymap)/RET on
 * the container. */
export function LogBuffer({ repo, path }: { repo: RepoName; path?: string | null }) {
  const ws = useWorkspace();
  const { keymap } = useSettings();
  // null = nothing pointed at yet; don't highlight a row until the user
  // actually clicks or presses a nav key
  const [point, setPoint] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());

  // pageParam is the skip offset (0, PAGE, 2*PAGE, …); each page is the total
  // rows loaded so far, so the next skip is that running count.
  const q = useInfiniteQuery({
    queryKey: gitKeys.log(repo, { path: path ?? null }),
    queryFn: ({ pageParam }) => gitLog(repo, { n: PAGE, skip: pageParam, path: path ?? null }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.has_more ? pages.reduce((n, p) => n + p.log.length, 0) : undefined,
    placeholderData: keepPreviousData, // keep the current list while a new repo/path loads
  });

  const entries: GitLogEntry[] = q.data?.pages.flatMap((p) => p.log) ?? [];
  const hasMore = q.hasNextPage;
  const loading = q.isFetching;
  const error = q.error ? q.error.message : null;

  // Roving point is an index into `entries`; a new repo/path is a new list.
  useEffect(() => { setPoint(null); }, [repo, path]);

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
          {error} <button className="btn btn-sm" onClick={() => void q.refetch()}>Retry</button>
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
          <button className="btn btn-sm log-more" onClick={() => void q.fetchNextPage()}>
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
