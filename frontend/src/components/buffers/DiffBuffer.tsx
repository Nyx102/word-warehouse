import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '@/context/workspace';
import { bufferId } from './buffers';
import { MergeEditor } from '@/features/editor/MergeEditor';
import { gitStatus, type GitMutateResult } from '@/features/git/gitApi';
import { gitKeys } from '@/features/git/gitKeys';
import { useGitMutations } from '@/features/git/useGitMutations';
import { queryClient } from '@/lib/queryClient';
import type { RepoName } from '@/lib/types';

/** Single-file diff/edit buffer: the shared MergeEditor (HEAD vs worktree,
 * sha256 save flow, per-chunk revert, >2MB DiffText fallback) plus a thin
 * git toolbar for history and index moves. */
export function DiffBuffer({ repo, path, line }: { repo: RepoName; path: string; line?: number | null }) {
  const ws = useWorkspace();
  const id = useMemo(() => bufferId({ kind: 'diff', repo, path }), [repo, path]);
  const active = ws.activeId === id;
  const status = useQuery({
    queryKey: gitKeys.status(repo),
    queryFn: () => gitStatus(repo),
  });
  const git = useGitMutations(repo);
  const [busy, setBusy] = useState(false);

  const entry = status.data?.files.find((f) => f.path === path) ?? null;
  const stageable = !!entry && (entry.untracked || entry.worktree !== '');
  const unstageable = !!entry && !entry.untracked && entry.index !== '';

  // The mutations invalidate ['git', repo] onSettled, so both the success
  // refresh and any failure resync happen automatically; this just tracks the
  // in-flight button-disable state.
  const act = async (fn: () => Promise<GitMutateResult>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="diff-buffer">
      <div className="diffbuf-bar">
        <button
          className="btn btn-sm"
          onClick={() => ws.open({ kind: 'log', repo, path })}
          title="Commit history for this file"
        >History</button>
        <button
          className="btn btn-sm"
          disabled={busy || !stageable}
          onClick={() => void act(() => git.stage([path]))}
          title="Stage the whole file"
        >Stage file</button>
        <button
          className="btn btn-sm"
          disabled={busy || !unstageable}
          onClick={() => void act(() => git.unstage([path]))}
          title="Unstage the whole file (index only)"
        >Unstage file</button>
        <span className="toolbar-spacer" />
        {status.data && !entry && <span className="dim">clean</span>}
        {entry && <span className="git-st">{entry.status}</span>}
      </div>
      <MergeEditor
        repo={repo}
        path={path}
        status={entry?.status ?? ''}
        gotoLine={line ?? null}
        active={active}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: gitKeys.all(repo) })}
        onClose={() => ws.close(id)}
      />
    </div>
  );
}
