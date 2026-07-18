import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAsync } from '../hooks/useAsync';
import { CommitBox } from './CommitBox';
import { CoverageModal } from './CoverageModal';
import { FileListPane } from './FileListPane';
import { MergeEditor } from './MergeEditor';
import type { GitStatusFile, RepoName } from '../types';

export function DiffsPanel({ repo, onRepoChange, active, onGlobalRefresh }: {
  repo: RepoName;
  onRepoChange: (r: RepoName) => void;
  active: boolean;
  onGlobalRefresh: () => void; // re-poll /api/status so the dirty pills update
}) {
  const [tick, setTick] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const status = useAsync(
    () => api<{ files: GitStatusFile[] }>(`/api/git/status?repo=${repo}`),
    [repo, tick],
  );
  const files = status.data?.files ?? [];

  // whenever the list reloads: everything checked by default, selection pruned
  useEffect(() => {
    const fs = status.data?.files ?? [];
    setChecked(new Set(fs.map((f) => f.path)));
    setSelected((sel) => (sel != null && fs.some((f) => f.path === sel) ? sel : null));
  }, [status.data]);

  useEffect(() => { setSelected(null); }, [repo]);

  // refresh git state each time the tab is opened
  useEffect(() => {
    if (active) setTick((t) => t + 1);
  }, [active]);

  const refresh = () => {
    setTick((t) => t + 1);
    onGlobalRefresh();
  };

  return (
    <div className="diffs-panel">
      <div className="diffs-toolbar">
        <div className="seg" role="group" aria-label="Repository">
          <button
            className={'seg-btn' + (repo === 'corpus' ? ' active' : '')}
            onClick={() => onRepoChange('corpus')}
          >Corpus</button>
          <button
            className={'seg-btn' + (repo === 'repo' ? ' active' : '')}
            onClick={() => onRepoChange('repo')}
          >Translation repo</button>
        </div>
        <span className="toolbar-spacer" />
        <button className="btn" onClick={() => setCoverageOpen(true)}>Coverage</button>
      </div>
      <div className={'diffs-body' + (selected ? ' has-editor' : '')}>
        <div className="diffs-left">
          {status.loading && !status.data
            ? <div className="empty">Loading…</div>
            : (
              <FileListPane
                files={files}
                checked={checked}
                selected={selected}
                onToggle={(p, on) => setChecked((s) => {
                  const n = new Set(s);
                  if (on) n.add(p); else n.delete(p);
                  return n;
                })}
                onSelect={setSelected}
              />
            )}
          <CommitBox
            repo={repo}
            checkedPaths={files.filter((f) => checked.has(f.path)).map((f) => f.path)}
            refreshKey={tick}
            onCommitted={refresh}
          />
        </div>
        <div className="diffs-right">
          {selected ? (
            <MergeEditor
              key={repo + ':' + selected}
              repo={repo}
              path={selected}
              status={files.find((f) => f.path === selected)?.status ?? 'M'}
              onChanged={refresh}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="empty pad">Select a file to view and edit its diff.</div>
          )}
        </div>
      </div>
      {coverageOpen && <CoverageModal onClose={() => setCoverageOpen(false)} />}
    </div>
  );
}
