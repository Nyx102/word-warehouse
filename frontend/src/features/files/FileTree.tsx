import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { IconChevronRight, IconFile, IconFolder } from '@/components/layout/icons';
import type { DirEntry } from '@/lib/types';

interface NodeState { entries: DirEntry[]; loading: boolean; error?: boolean; }

/** Lazy, per-directory file tree over /api/fs/list. Directories load their
 * children on first expand; `refreshKey` bumps re-list the root + open dirs.
 * `onMenu` (kebab click or right-click) receives viewport coordinates for a
 * caller-rendered context menu. */
export function FileTree({ selected, onSelect, onMenu, refreshKey }: {
  selected: string | null;
  onSelect: (entry: DirEntry) => void;
  onMenu?: (entry: DirEntry, x: number, y: number) => void;
  refreshKey: number;
}) {
  const [dirs, setDirs] = useState<Record<string, NodeState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const expandedRef = useRef<Set<string>>(new Set());
  expandedRef.current = expanded;

  const loadDir = useCallback(async (path: string) => {
    setDirs((d) => ({ ...d, [path]: { entries: d[path]?.entries ?? [], loading: true } }));
    try {
      const r = await api<{ entries: DirEntry[] }>(
        `/api/fs/list?path=${encodeURIComponent(path)}`, { silent: true });
      setDirs((d) => ({ ...d, [path]: { entries: r.entries, loading: false } }));
    } catch {
      setDirs((d) => ({ ...d, [path]: { entries: [], loading: false, error: true } }));
    }
  }, []);

  // (Re)load the root and any currently-expanded dirs when refreshKey changes
  useEffect(() => {
    void loadDir('');
    expandedRef.current.forEach((p) => void loadDir(p));
  }, [loadDir, refreshKey]);

  const toggle = useCallback((path: string) => {
    setExpanded((exp) => {
      const n = new Set(exp);
      if (n.has(path)) n.delete(path);
      else { n.add(path); if (!dirs[path]) void loadDir(path); }
      return n;
    });
  }, [dirs, loadDir]);

  const renderDir = (path: string): ReactNode => {
    const node = dirs[path];
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

  const root = dirs[''];
  return (
    <div className="file-tree">
      {!root || (root.loading && !root.entries.length)
        ? <div className="empty">Loading…</div>
        : renderDir('')}
    </div>
  );
}
