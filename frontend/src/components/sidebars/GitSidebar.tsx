import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '@/context/workspace';
import { toast } from '@/components/Toasts';
import { fileLabel, repoLabel, statusClass } from '@/features/git/fmt';
import { gitBranches, gitStatus } from '@/features/git/gitApi';
import { gitKeys } from '@/features/git/gitKeys';
import { useGitMutations } from '@/features/git/useGitMutations';
import { Select } from '@/components/Select';
import { IconGit, IconHistory } from '@/components/layout/icons';
import type { GitStatusFile, RepoName } from '@/lib/types';

/** Git section: repo picker, branch block (switch/create), dirty summary,
 * status/log launchers, compact changed-file list. (Coverage isn't a git
 * operation — it lives in Files, next to the corpus content it reports on.)
 * Clicking the Git rail icon also jumps straight to status, but the button
 * stays here too — opening a diff or commit from this same sidebar leaves
 * the rail on 'git' the whole time, so the rail click alone isn't a
 * reliable way back. */
export function GitSidebar() {
  const ws = useWorkspace();
  const repo = ws.gitRepo;
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [switching, setSwitching] = useState(false);

  const status = useQuery({
    queryKey: gitKeys.status(repo),
    queryFn: () => gitStatus(repo),
  });
  const branches = useQuery({
    queryKey: gitKeys.branches(repo),
    queryFn: () => gitBranches(repo),
  });
  const git = useGitMutations(repo);

  // Mutations invalidate ['git', repo] (refreshing both queries) and the
  // QueryClient's refetchOnWindowFocus covers the old window-focus resync.
  // Re-opening the Git section still forces a fresh read of the two cheap
  // queries.
  useEffect(() => {
    if (ws.rail === 'git') {
      void status.refetch();
      void branches.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.rail]);

  const openStatus = () => { ws.open({ kind: 'magit', repo }); ws.setDrawerOpen(false); };
  const openLog = () => { ws.open({ kind: 'log', repo }); ws.setDrawerOpen(false); };
  // Switching which repo you're looking at should show that repo's status,
  // not silently leave whatever buffer happened to be open
  const selectRepo = (r: RepoName) => {
    ws.setGitRepo(r);
    ws.open({ kind: 'magit', repo: r });
    ws.setDrawerOpen(false);
  };

  const doSwitch = async (name: string) => {
    if (!name || name === branches.data?.current || switching) return;
    setSwitching(true);
    const r = await git.switchBranch(name);
    setSwitching(false);
    if (r.ok) {
      toast('Switched to ' + name, 'ok');
      openStatus();
    }
    // Conflict path (409 toasted by api) resyncs via the mutation's onSettled
    // invalidation of ['git', repo].
  };

  const doCreate = async () => {
    const name = newBranch.trim();
    if (!name || switching) return;
    setSwitching(true);
    const r = await git.switchBranch(name, true);
    setSwitching(false);
    if (r.ok) {
      toast('Created ' + name, 'ok');
      setCreating(false);
      setNewBranch('');
      openStatus();
    }
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
          onClick={() => selectRepo('corpus')}
        >{repoLabel('corpus')}</button>
        <button
          className={'seg-btn' + (repo === 'repo' ? ' active' : '')}
          onClick={() => selectRepo('repo')}
        >{repoLabel('repo')}</button>
      </div>

      <div className="git-branchblock">
        <div className="git-branch-row">
          <Select
            className="git-branch-select mono"
            value={cur ?? ''}
            disabled={switching || !branches.data}
            onChange={(name) => void doSwitch(name)}
            ariaLabel="Switch branch"
            title="Switch branch"
            placeholder={branches.data ? 'detached' : '…'}
            options={(branches.data?.branches ?? []).map((br) => ({ value: br.name, label: br.name }))}
          />
          {b && b.ahead != null && (b.ahead > 0 || (b.behind ?? 0) > 0) && (
            <span className="magit-ab" title={`ahead ${b.ahead}, behind ${b.behind}`}>
              ↑{b.ahead} ↓{b.behind}
            </span>
          )}
          <button
            className={'git-branch-new' + (creating ? ' active' : '')}
            onClick={() => { setCreating((v) => !v); setNewBranch(''); }}
            title={creating ? 'Cancel' : 'New branch'}
            aria-label={creating ? 'Cancel' : 'New branch'}
          >{creating ? '×' : '+'}</button>
        </div>
        {creating && (
          <div className="git-branch-row">
            <input
              className="git-branch-input mono"
              value={newBranch}
              placeholder="new branch name"
              autoFocus
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doCreate();
                if (e.key === 'Escape') { setCreating(false); setNewBranch(''); }
              }}
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
        <button className="btn btn-sm git-action" onClick={openStatus} title="Open the status view">
          <IconGit /><span>Status</span>
        </button>
        <button className="btn btn-sm git-action" onClick={openLog} title="Full commit history">
          <IconHistory /><span>Log</span>
        </button>
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
