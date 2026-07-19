import { api, ApiError } from '../api';
import type {
  GitBranchesResponse,
  GitCommitDetail,
  GitDiffMode,
  GitFileResponse,
  GitLogResponse,
  GitStatusResponse,
  RepoName,
} from '../types';

/* Typed wrappers over the git endpoints. Reads throw like api() does;
 * mutations never throw for HTTP failures, they resolve to a result the UI
 * can branch on (api() has already toasted). Every successful mutation is
 * broadcast so sidebars/buffers showing the same repo can refetch. */

export type GitMutateResult =
  | { ok: true; hash?: string }
  | { ok: false; conflict: boolean; message: string };

type GitMutateListener = (repo: RepoName) => void;
const mutateListeners = new Set<GitMutateListener>();

/** Subscribe to git-state changes; returns the unsubscribe function */
export function onGitMutate(fn: GitMutateListener): () => void {
  mutateListeners.add(fn);
  return () => { mutateListeners.delete(fn); };
}

/** Broadcast a git-state change (fired by mutations here; also callable for
 * out-of-band changes such as a file save that dirties the worktree) */
export function notifyGitChanged(repo: RepoName): void {
  for (const fn of [...mutateListeners]) fn(repo);
}

/* ---- reads ---- */

export const gitStatus = (repo: RepoName) =>
  api<GitStatusResponse>(`/api/git/status?repo=${repo}`);

export function gitLog(
  repo: RepoName,
  opts: { n?: number; skip?: number; path?: string | null } = {},
): Promise<GitLogResponse> {
  const q = new URLSearchParams({ repo });
  if (opts.n != null) q.set('n', String(opts.n));
  if (opts.skip) q.set('skip', String(opts.skip));
  if (opts.path) q.set('path', opts.path);
  return api<GitLogResponse>(`/api/git/log?${q.toString()}`);
}

export const gitShow = (repo: RepoName, rev: string) =>
  api<GitCommitDetail>(`/api/git/show?repo=${repo}&rev=${encodeURIComponent(rev)}`);

export const gitBranches = (repo: RepoName) =>
  api<GitBranchesResponse>(`/api/git/branches?repo=${repo}`);

export function gitDiffText(
  repo: RepoName,
  opts: { path?: string | null; mode?: GitDiffMode } = {},
): Promise<string> {
  const q = new URLSearchParams({ repo });
  if (opts.path) q.set('path', opts.path);
  if (opts.mode) q.set('mode', opts.mode);
  return api<{ diff: string }>(`/api/git/diff?${q.toString()}`).then((r) => r.diff);
}

export const gitFileAt = (repo: RepoName, path: string, rev = 'HEAD') =>
  api<GitFileResponse>(
    `/api/git/file?repo=${repo}&path=${encodeURIComponent(path)}&rev=${encodeURIComponent(rev)}`,
  );

/* ---- mutations ---- */

async function mutate(
  repo: RepoName,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<GitMutateResult> {
  try {
    const r = await api<{ ok: boolean; hash?: string }>(endpoint, {
      method: 'POST',
      body: { repo, ...body },
    });
    notifyGitChanged(repo);
    return { ok: true, hash: r.hash };
  } catch (e) {
    if (e instanceof ApiError) {
      return { ok: false, conflict: e.status === 409, message: e.message };
    }
    return { ok: false, conflict: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export const gitStage = (repo: RepoName, paths: string[]) =>
  mutate(repo, '/api/git/stage', { paths });

export const gitUnstage = (repo: RepoName, paths: string[]) =>
  mutate(repo, '/api/git/unstage', { paths });

export const gitApply = (repo: RepoName, patch: string, reverse = false) =>
  mutate(repo, '/api/git/apply', reverse ? { patch, reverse: true } : { patch });

/** Commit the staged set; deliberately sends no paths key */
export const gitCommitStaged = (repo: RepoName, message: string) =>
  mutate(repo, '/api/git/commit', { message });

export const gitSwitchBranch = (repo: RepoName, name: string, create = false) =>
  mutate(repo, '/api/git/branch', create ? { name, create: true } : { name });

export const gitRevert = (repo: RepoName, path: string) =>
  mutate(repo, '/api/git/revert', { path });

/* ---- path mapping ---- */

/* File buffers take project-root-relative paths; the nested translation repo
 * sits at this fixed relative location (mirrors config.py REPO) */
const REPO_FS_PREFIX: Record<RepoName, string> = {
  corpus: '',
  repo: 'corpus/worldend2/repo/',
};

/** Repo-relative git path -> project-root-relative file-buffer path */
export const repoFsPath = (repo: RepoName, path: string) => REPO_FS_PREFIX[repo] + path;
