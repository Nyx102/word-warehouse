import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../app/workspace';
import { bufferId } from '../workspace/buffers';
import { useAsync } from '../hooks/useAsync';
import { MergeEditor } from '../diffs/MergeEditor';
import {
  gitStage,
  gitStatus,
  gitUnstage,
  notifyGitChanged,
  onGitMutate,
  type GitMutateResult,
} from '../git/gitApi';
import type { RepoName } from '../types';

/** Single-file diff/edit buffer: the shared MergeEditor (HEAD vs worktree,
 * sha256 save flow, per-chunk revert, >2MB DiffText fallback) plus a thin
 * git toolbar for history and index moves. */
export function DiffBuffer({ repo, path, line }: { repo: RepoName; path: string; line?: number | null }) {
  const ws = useWorkspace();
  const id = useMemo(() => bufferId({ kind: 'diff', repo, path }), [repo, path]);
  const active = ws.activeId === id;
  const status = useAsync(() => gitStatus(repo), [repo]);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => onGitMutate((r) => { if (r === repo) status.reload(); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repo, status.reload],
  );

  const entry = status.data?.files.find((f) => f.path === path) ?? null;
  const stageable = !!entry && (entry.untracked || entry.worktree !== '');
  const unstageable = !!entry && !entry.untracked && entry.index !== '';

  const act = async (fn: () => Promise<GitMutateResult>) => {
    setBusy(true);
    try {
      const r = await fn();
      // Success reloads via the mutation broadcast; failure resyncs here
      if (!r.ok) status.reload();
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
          onClick={() => void act(() => gitStage(repo, [path]))}
          title="Stage the whole file"
        >Stage file</button>
        <button
          className="btn btn-sm"
          disabled={busy || !unstageable}
          onClick={() => void act(() => gitUnstage(repo, [path]))}
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
        onChanged={() => notifyGitChanged(repo)}
        onClose={() => ws.close(id)}
      />
    </div>
  );
}
