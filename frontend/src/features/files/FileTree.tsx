import { type ReactNode, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { IconChevronRight, IconFile, IconFolder } from '@/components/layout/icons';
import type { DirEntry } from '@/lib/types';

interface NodeState { entries: DirEntry[]; loading: boolean; error: boolean; }

/** Lazy, per-directory file tree over /api/fs/list. Each visible directory is
 * one ['fs','list',path] query; expanding a dir mounts its query, collapsing
 * drops it. FS mutations invalidate ['fs','list'] to re-list the root and every
 * open dir at once. `onMenu` (kebab click or right-click) receives viewport
 * coordinates for a caller-rendered context menu. */
export function FileTree({ selected, onSelect, onMenu }: {
  selected: string | null;
  onSelect: (entry: DirEntry) => void;
  onMenu?: (entry: DirEntry, x: number, y: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The root plus every currently-expanded directory; useQueries takes this
  // dynamic array and keeps one cache entry per path.
  const paths = useMemo(() => ['', ...expanded], [expanded]);
  const results = useQueries({
    queries: paths.map((p) => ({
      queryKey: ['fs', 'list', p],
      queryFn: () =>
        api<{ entries: DirEntry[] }>(`/api/fs/list?path=${encodeURIComponent(p)}`, { silent: true }),
    })),
  });
  const nodeFor = (path: string): NodeState | null => {
    const i = paths.indexOf(path);
    if (i === -1) return null;
    const q = results[i];
    return { entries: q.data?.entries ?? [], loading: q.isFetching, error: q.isError };
  };

  const toggle = (path: string) => {
    setExpanded((exp) => {
      const n = new Set(exp);
      if (n.has(path)) n.delete(path);
      else n.add(path); // adding mounts the ['fs','list',path] query -> lazy load
      return n;
    });
  };

  const renderDir = (path: string): ReactNode => {
    const node = nodeFor(path);
    if (!node) return null;
    if (node.error) return <div className="tree-msg">failed to load</div>;
    return node.entries.map((e) => {
      const open = expanded.has(e.path);
      return (
        <div key={e.path}>
          <div
            className={'tree-row' + (selected === e.path ? ' selected' : '')}
            onClick={() => { if (e.is_dir) toggle(e.path); onSelect(e); }}
            onContextMenu={onMenu
              ? (ev) => { ev.preventDefault(); onMenu(e, ev.clientX, ev.clientY); }
              : undefined}
            title={e.path}
          >
            <span className={'tree-caret' + (open ? ' open' : '')}>
              {e.is_dir && <IconChevronRight />}
            </span>
            <span className={'tree-icon' + (e.is_dir ? ' is-dir' : '')}>
              {e.is_dir ? <IconFolder /> : <IconFile />}
            </span>
            <span className={'tree-name mono' + (e.is_dir ? ' is-dir' : '')}>{e.name}</span>
            {onMenu && (
              <button
                className="tree-kebab"
                title="Actions"
                aria-label={'Actions for ' + e.name}
                onClick={(ev) => {
                  ev.stopPropagation();
                  const r = ev.currentTarget.getBoundingClientRect();
                  onMenu(e, r.left, r.bottom);
                }}
              >⋯</button>
            )}
          </div>
          {e.is_dir && open && (
            <div className="tree-group">{renderDir(e.path)}</div>
          )}
        </div>
      );
    });
  };

  const root = nodeFor('');
  return (
    <div className="file-tree">
      {!root || (root.loading && !root.entries.length)
        ? <div className="empty">Loading…</div>
        : renderDir('')}
    </div>
  );
}
