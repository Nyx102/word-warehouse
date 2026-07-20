import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '@/context/workspace';
import { toast } from '@/components/Toasts';
import { fileLabel, repoLabel, statusClass } from '@/features/git/fmt';
import { gitBranches, gitStatus, type GitMutateResult } from '@/features/git/gitApi';
import { gitKeys } from '@/features/git/gitKeys';
import { useGitMutations } from '@/features/git/useGitMutations';
import { Select } from '@/components/Select';
import { Modal } from '@/components/Modal';
import { IconGit, IconHistory, IconMinus, IconPlus } from '@/components/layout/icons';
import type { GitStatusFile, RepoName } from '@/lib/types';

type SideGroup = 'staged' | 'unstaged' | 'untracked';
type RowMenu = { file: GitStatusFile; group: SideGroup; x: number; y: number } | null;

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
  const [menu, setMenu] = useState<RowMenu>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [discard, setDiscard] = useState<GitStatusFile | null>(null);

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

  // Esc dismisses the row context menu
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

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
  const openHistory = (f: GitStatusFile) => {
    ws.open({ kind: 'log', repo, path: f.path });
    ws.setDrawerOpen(false);
  };

  // Per-file index moves. The mutation invalidates ['git', repo], so the row
  // just hops to the right section on the refetch; busyPath disables its own
  // buttons in the meantime.
  const act = async (path: string, fn: () => Promise<GitMutateResult>) => {
    setBusyPath(path);
    try { await fn(); } finally { setBusyPath(null); }
  };
  const doStage = (f: GitStatusFile) => void act(f.path, () => git.stage([f.path]));
  const doUnstage = (f: GitStatusFile) => void act(f.path, () => git.unstage([f.path]));
  const doDiscard = (f: GitStatusFile) => { setDiscard(null); void act(f.path, () => git.revert(f.path)); };

  const openMenu = (f: GitStatusFile, g: SideGroup, x: number, y: number) => setMenu({ file: f, group: g, x, y });
  const menuStyle = menu
    ? {
      left: Math.max(4, Math.min(menu.x, window.innerWidth - 180)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - 170)),
    }
    : undefined;

  const group = (title: string, g: SideGroup, list: GitStatusFile[], ch: (f: GitStatusFile) => string) =>
    list.length > 0 && (
      <div className="git-side-group">
        <div className="side-h">{title} ({list.length})</div>
        {list.map((f) => (
          <div
            key={f.path}
            className="file-row"
            onClick={() => openDiff(f)}
            onContextMenu={(e) => { e.preventDefault(); openMenu(f, g, e.clientX, e.clientY); }}
          >
            <span className={'git-st ' + statusClass(ch(f))}>{ch(f)}</span>
            <span className="file-path mono" title={f.path}>{fileLabel(f)}</span>
            <span className="row-actions">
              {g === 'staged' ? (
                <button
                  className="row-act"
                  disabled={busyPath === f.path}
                  onClick={(e) => { e.stopPropagation(); doUnstage(f); }}
                  title="Unstage" aria-label={'Unstage ' + f.path}
                ><IconMinus /></button>
              ) : (
                <button
                  className="row-act"
                  disabled={busyPath === f.path}
                  onClick={(e) => { e.stopPropagation(); doStage(f); }}
                  title={g === 'untracked' ? 'Stage (add file)' : 'Stage'} aria-label={'Stage ' + f.path}
                ><IconPlus /></button>
              )}
              <button
                className="row-act kebab"
                onClick={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  openMenu(f, g, r.left, r.bottom);
                }}
                title="More actions" aria-label={'More actions for ' + f.path}
              >⋯</button>
            </span>
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
              ↑<span className="magit-ab-n">{b.ahead}</span> ↓<span className="magit-ab-n">{b.behind}</span>
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
        {group('Staged', 'staged', staged, (f) => f.index)}
        {group('Unstaged', 'unstaged', unstaged, (f) => f.worktree)}
        {group('Untracked', 'untracked', untracked, () => '?')}
        {status.data && files.length === 0 && (
          <div className="magit-empty dim">working tree clean</div>
        )}
      </div>

      {menu && (
        <div
          className="ctx-overlay"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
        >
          <div className="ctx-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
            <div className="ctx-title mono" title={menu.file.path}>{fileLabel(menu.file)}</div>
            <button className="ctx-item" onClick={() => { openDiff(menu.file); setMenu(null); }}>Open diff</button>
            {menu.group === 'staged' ? (
              <button className="ctx-item" onClick={() => { doUnstage(menu.file); setMenu(null); }}>Unstage</button>
            ) : (
              <button className="ctx-item" onClick={() => { doStage(menu.file); setMenu(null); }}>
                {menu.group === 'untracked' ? 'Stage (add file)' : 'Stage'}
              </button>
            )}
            {menu.group !== 'untracked' && (
              <button className="ctx-item" onClick={() => { openHistory(menu.file); setMenu(null); }}>File history</button>
            )}
            {/* Restore needs a HEAD version; a newly-added file (index 'A') has
                none, so discarding it would mean deletion, which the server
                refuses. Hide it rather than offer a guaranteed error. */}
            {menu.group !== 'untracked' && menu.file.index !== 'A' && (
              <button className="ctx-item danger" onClick={() => { setDiscard(menu.file); setMenu(null); }}>Discard changes…</button>
            )}
          </div>
        </div>
      )}

      {discard && (
        <Modal
          title="Discard changes"
          onClose={() => setDiscard(null)}
          footer={(
            <>
              <button className="btn" onClick={() => setDiscard(null)}>Cancel</button>
              <button className="btn danger" onClick={() => doDiscard(discard)}>Discard</button>
            </>
          )}
        >
          <p>Discard working changes to <code>{discard.path}</code> and restore the committed version? This can't be undone.</p>
        </Modal>
      )}
    </div>
  );
}
