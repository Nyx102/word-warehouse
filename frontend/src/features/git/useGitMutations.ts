import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  gitApply,
  gitCommitStaged,
  gitRevert,
  gitStage,
  gitSwitchBranch,
  gitUnstage,
  type GitMutateResult,
} from './gitApi';
import { gitKeys } from './gitKeys';
import type { RepoName } from '@/lib/types';

/* Git mutations bound to one repo. Every mutation invalidates ['git', repo]
 * onSettled — the exact replacement for the deleted git-change broadcast —
 * so every ['git', repo, ...] query (status, branches, log, diff,
 * magit) of that repo refetches. commit/revert also touch the worktree's dirty
 * counts, so they additionally invalidate the global ['status'] poll.
 *
 * The wrappers never throw for HTTP failures (they resolve to GitMutateResult),
 * so onSettled always fires and callers still branch on r.ok. No optimism here
 * by design — staging/commit reflect only confirmed server state. */
export function useGitMutations(repo: RepoName) {
  const qc = useQueryClient();
  const invalidateGit = () => { void qc.invalidateQueries({ queryKey: gitKeys.all(repo) }); };
  const invalidateGitAndStatus = () => {
    void qc.invalidateQueries({ queryKey: gitKeys.all(repo) });
    void qc.invalidateQueries({ queryKey: ['status'] });
  };

  const stageMut = useMutation({
    mutationFn: (paths: string[]) => gitStage(repo, paths),
    onSettled: invalidateGit,
  });
  const unstageMut = useMutation({
    mutationFn: (paths: string[]) => gitUnstage(repo, paths),
    onSettled: invalidateGit,
  });
  const applyMut = useMutation({
    mutationFn: (v: { patch: string; reverse?: boolean }) => gitApply(repo, v.patch, v.reverse),
    onSettled: invalidateGit,
  });
  const commitMut = useMutation({
    mutationFn: (message: string) => gitCommitStaged(repo, message),
    onSettled: invalidateGitAndStatus,
  });
  const switchMut = useMutation({
    mutationFn: (v: { name: string; create?: boolean }) => gitSwitchBranch(repo, v.name, v.create),
    onSettled: invalidateGit,
  });
  const revertMut = useMutation({
    mutationFn: (path: string) => gitRevert(repo, path),
    onSettled: invalidateGitAndStatus,
  });

  return {
    stage: (paths: string[]): Promise<GitMutateResult> => stageMut.mutateAsync(paths),
    unstage: (paths: string[]): Promise<GitMutateResult> => unstageMut.mutateAsync(paths),
    apply: (patch: string, reverse = false): Promise<GitMutateResult> =>
      applyMut.mutateAsync({ patch, reverse }),
    commit: (message: string): Promise<GitMutateResult> => commitMut.mutateAsync(message),
    switchBranch: (name: string, create = false): Promise<GitMutateResult> =>
      switchMut.mutateAsync({ name, create }),
    revert: (path: string): Promise<GitMutateResult> => revertMut.mutateAsync(path),
  };
}
