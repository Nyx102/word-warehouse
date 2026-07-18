import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DirEntry } from '../types';

interface NodeState { entries: DirEntry[]; loading: boolean; error?: boolean; }

/** Lazy, per-directory file tree over /api/fs/list. Directories load their
 * children on first expand; `refreshKey` bumps re-list the root + open dirs. */
export function FileTree({ selected, onSelect, refreshKey }: {
  selected: string | null;
  onSelect: (entry: DirEntry) => void;
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

  // (Re)load the root and any currently-expanded dirs when refreshKey changes.
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

  const renderDir = (path: string, depth: number): ReactNode => {
    const node = dirs[path];
    if (!node) return null;
    if (node.error) return <div className="tree-msg" style={{ paddingLeft: 8 + depth * 14 }}>failed to load</div>;
    return node.entries.map((e) => {
      const open = expanded.has(e.path);
      return (
        <div key={e.path}>
          <div
            className={'tree-row' + (selected === e.path ? ' selected' : '')}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => { if (e.is_dir) toggle(e.path); onSelect(e); }}
            title={e.path}
          >
            <span className="tree-caret">{e.is_dir ? (open ? '▾' : '▸') : ''}</span>
            <span className={'tree-name mono' + (e.is_dir ? ' is-dir' : '')}>{e.name}</span>
          </div>
          {e.is_dir && open && renderDir(e.path, depth + 1)}
        </div>
      );
    });
  };

  const root = dirs[''];
  return (
    <div className="file-tree">
      {!root || (root.loading && !root.entries.length)
        ? <div className="empty">Loading…</div>
        : renderDir('', 0)}
    </div>
  );
}
