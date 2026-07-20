import type { GitDiffMode, RepoName } from '@/lib/types';

/* Central git query-key factory. REPO IS THE 2nd SEGMENT on every key so that
 * react-query's prefix matching lets invalidateQueries({queryKey: gitKeys.all(repo)})
 * ( = ['git', repo] ) match every sub-resource of one repo — the exact
 * functional replacement for the old git-change broadcast. A
 * mis-ordered key would silently escape that invalidation, so all git reads
 * MUST build their key here. */
export const gitKeys = {
  /** Prefix for one repo; invalidating this catches all of its sub-resources */
  all: (repo: RepoName) => ['git', repo] as const,
  status: (repo: RepoName) => ['git', repo, 'status'] as const,
  branches: (repo: RepoName) => ['git', repo, 'branches'] as const,
  log: (repo: RepoName, opts: { path?: string | null; n?: number }) =>
    ['git', repo, 'log', { path: opts.path ?? null, n: opts.n }] as const,
  diff: (repo: RepoName, mode: GitDiffMode, path: string | null) =>
    ['git', repo, 'diff', mode, path] as const,
  show: (repo: RepoName, rev: string) => ['git', repo, 'show', rev] as const,
  file: (repo: RepoName, path: string, rev: string) =>
    ['git', repo, 'file', path, rev] as const,
  /** Composite Magit snapshot (status + log + worktree/staged diffs) */
  magit: (repo: RepoName) => ['git', repo, 'magit'] as const,
};
