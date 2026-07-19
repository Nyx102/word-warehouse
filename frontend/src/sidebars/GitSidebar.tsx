import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { useAsync } from '../hooks/useAsync';
import { toast } from '../components/Toasts';
import { fileLabel, statusClass } from '../git/fmt';
import { gitBranches, gitStatus, gitSwitchBranch, onGitMutate } from '../git/gitApi';
import type { GitStatusFile, RepoName } from '../types';

/** Git section: repo picker, branch block (switch/create), dirty summary,
 * magit/log/coverage launchers, compact changed-file list. */
export function GitSidebar() {
  const ws = useWorkspace();
  const [repo, setRepo] = useState<RepoName>('corpus');
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [switching, setSwitching] = useState(false);

  const status = useAsync(() => gitStatus(repo), [repo]);
  const branches = useAsync(() => gitBranches(repo), [repo]);
  const statusReload = status.reload;
  const branchesReload = branches.reload;
  const reloadAll = useCallback(() => {
    statusReload();
    branchesReload();
  }, [statusReload, branchesReload]);

  useEffect(() => onGitMutate((r) => { if (r === repo) reloadAll(); }), [repo, reloadAll]);
  useEffect(() => {
    window.addEventListener('focus', reloadAll);
    return () => window.removeEventListener('focus', reloadAll);
  }, [reloadAll]);
  useEffect(() => { if (ws.rail === 'git') reloadAll(); }, [ws.rail, reloadAll]);

  const openBuffer = (kind: 'magit' | 'log' | 'coverage') => {
    if (kind === 'coverage') ws.open({ kind: 'coverage' });
    else ws.open(kind === 'magit' ? { kind: 'magit', repo } : { kind: 'log', repo });
    ws.setDrawerOpen(false);
  };

  const doSwitch = async (name: string) => {
    if (!name || name === branches.data?.current || switching) return;
    setSwitching(true);
    const r = await gitSwitchBranch(repo, name);
    setSwitching(false);
    if (r.ok) toast('Switched to ' + name, 'ok');
    // Conflict path (409 toasted by api) still needs a resync
    reloadAll();
  };

  const doCreate = async () => {
    const name = newBranch.trim();
    if (!name || switching) return;
    setSwitching(true);
    const r = await gitSwitchBranch(repo, name, true);
    setSwitching(false);
    if (r.ok) {
      toast('Created ' + name, 'ok');
      setCreating(false);
      setNewBranch('');
    }
    reloadAll();
  };

  const files = status.data?.files ?? [];
  const staged = files.filter((f) => !f.untracked && f.index !== '');
  const unstaged = files.filter((f) => !f.untracked && f.worktree !== '');
  const untracked = files.filter((f) => f.untracked);

  const openDiff = (f: GitStatusFile) => {
    ws.open({ kind: 'diff', repo, path: f.path });
    ws.setDrawerOpen(false);
  };

  const group = (title: string, list: GitStatusFile[], ch: (f: GitStatusFile) => string) =>
    list.length > 0 && (
      <div className="git-side-group">
        <div className="side-h">{title} ({list.length})</div>
        {list.map((f) => (
          <div key={f.path} className="file-row" onClick={() => openDiff(f)}>
            <span className={'git-st ' + statusClass(ch(f))}>{ch(f)}</span>
            <span className="file-path mono" title={f.path}>{fileLabel(f)}</span>
          </div>
        ))}
      </div>
    );

  const cur = branches.data?.current ?? null;
  const b = status.data?.branch;
  return (
    <div className="git-side">
      <div className="seg" role="group" aria-label="Repository">
        <button
          className={'seg-btn' + (repo === 'corpus' ? ' active' : '')}
          onClick={() => setRepo('corpus')}
        >Corpus</button>
        <button
          className={'seg-btn' + (repo === 'repo' ? ' active' : '')}
          onClick={() => setRepo('repo')}
        >Translation</button>
      </div>

      <div className="git-branchblock">
        <div className="git-branch-row">
          <span className="git-branch-name mono" title="Current branch">
            {cur ?? (branches.data ? 'detached' : '…')}
          </span>
          {b && b.ahead != null && (b.ahead > 0 || (b.behind ?? 0) > 0) && (
            <span className="magit-ab" title={`ahead ${b.ahead}, behind ${b.behind}`}>
              ↑{b.ahead} ↓{b.behind}
            </span>
          )}
        </div>
        <div className="git-branch-row">
          <select
            className="git-branch-select"
            value={cur ?? ''}
            disabled={switching || !branches.data}
            onChange={(e) => void doSwitch(e.target.value)}
            aria-label="Switch branch"
          >
            {cur === null && <option value="" disabled hidden>—</option>}
            {(branches.data?.branches ?? []).map((br) => (
              <option key={br.name} value={br.name}>{br.name}</option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            onClick={() => setCreating((v) => !v)}
            title="Create a new branch"
          >New</button>
        </div>
        {creating && (
          <div className="git-branch-row">
            <input
              className="git-branch-input mono"
              value={newBranch}
              placeholder="new branch name"
              autoFocus
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void doCreate(); }}
            />
            <button
              className="btn btn-sm primary"
              disabled={!newBranch.trim() || switching}
              onClick={() => void doCreate()}
            >Create</button>
          </div>
        )}
      </div>

      <div className="git-summary dim">
        <span className="git-sum-item"><b>{staged.length}</b> staged</span>
        <span className="git-sum-item"><b>{unstaged.length}</b> unstaged</span>
        <span className="git-sum-item"><b>{untracked.length}</b> untracked</span>
      </div>

      <div className="git-actions">
        <button className="btn btn-sm primary" onClick={() => openBuffer('magit')}>Status</button>
        <button className="btn btn-sm" onClick={() => openBuffer('log')}>Log</button>
        <button className="btn btn-sm" onClick={() => openBuffer('coverage')}>Coverage</button>
      </div>

      <div className="git-filelist">
        {group('Staged', staged, (f) => f.index)}
        {group('Unstaged', unstaged, (f) => f.worktree)}
        {group('Untracked', untracked, () => '?')}
        {status.data && files.length === 0 && (
          <div className="magit-empty dim">working tree clean</div>
        )}
      </div>
    </div>
  );
}
