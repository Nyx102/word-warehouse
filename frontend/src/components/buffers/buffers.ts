import { languageLabelForPath } from '@/features/editor/cm';
import type { RepoName } from '@/lib/types';

/* Buffer descriptors for the IDE workspace. Ids derive from the desc so the
 * same target always maps to the same buffer */

export type BufferDesc =
  | { kind: 'file'; path: string; line?: number | null }
  | { kind: 'diff'; repo: RepoName; path: string; line?: number | null }
  | { kind: 'magit'; repo: RepoName }
  | { kind: 'log'; repo: RepoName; path?: string | null }
  | { kind: 'commit'; repo: RepoName; rev: string }
  | { kind: 'align' }
  | { kind: 'coverage' }
  | { kind: 'help' };

export function bufferId(d: BufferDesc): string {
  switch (d.kind) {
    case 'file': return 'file:' + d.path;
    case 'diff': return `diff:${d.repo}:${d.path}`;
    case 'magit': return 'magit:' + d.repo;
    case 'log': return d.path ? `log:${d.repo}:${d.path}` : 'log:' + d.repo;
    case 'commit': return `commit:${d.repo}:${d.rev}`;
    default: return d.kind;
  }
}

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1) || p;

export function bufferTitle(d: BufferDesc): string {
  switch (d.kind) {
    case 'file': return basename(d.path);
    case 'diff': return 'diff: ' + basename(d.path);
    case 'magit': return 'magit: ' + d.repo;
    case 'log': return 'log: ' + (d.path ? basename(d.path) : d.repo);
    case 'commit': return d.rev.slice(0, 8);
    case 'align': return 'Alignment';
    case 'coverage': return 'Coverage';
    case 'help': return 'Help';
  }
}

/* The nested translation repo has its own git history; files under it map to
 * repo 'repo' with the prefix stripped, everything else logs against 'corpus' */
export const NESTED_REPO_PREFIX = 'corpus/worldend2/repo/';

export function repoForPath(path: string): RepoName {
  return path.startsWith(NESTED_REPO_PREFIX) ? 'repo' : 'corpus';
}

/** The repo a buffer's git state (branch/dirty) belongs to, if any. */
export function repoForBuffer(d: BufferDesc): RepoName | null {
  switch (d.kind) {
    case 'file': return repoForPath(d.path);
    case 'diff':
    case 'magit':
    case 'log':
    case 'commit':
      return d.repo;
    default:
      return null;
  }
}

/** "Major mode" label for the modeline. */
export function bufferModeLabel(d: BufferDesc): string {
  switch (d.kind) {
    case 'file': return languageLabelForPath(d.path);
    case 'diff': return 'Diff';
    case 'magit': return 'Magit';
    case 'log': return 'Log';
    case 'commit': return 'Commit';
    case 'align': return 'Alignment';
    case 'coverage': return 'Coverage';
    case 'help': return 'Help';
  }
}

const isRepo = (v: unknown): v is RepoName => v === 'corpus' || v === 'repo';
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validate a persisted descriptor; null drops bad/stale entries fail-soft. */
export function sanitizeDesc(raw: unknown): BufferDesc | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  switch (d.kind) {
    case 'file':
      return isStr(d.path)
        ? { kind: 'file', path: d.path, line: typeof d.line === 'number' ? d.line : null }
        : null;
    case 'diff':
      return isRepo(d.repo) && isStr(d.path)
        ? { kind: 'diff', repo: d.repo, path: d.path, line: typeof d.line === 'number' ? d.line : null }
        : null;
    case 'magit':
      return isRepo(d.repo) ? { kind: 'magit', repo: d.repo } : null;
    case 'log':
      return isRepo(d.repo)
        ? { kind: 'log', repo: d.repo, path: isStr(d.path) ? d.path : null }
        : null;
    case 'commit':
      return isRepo(d.repo) && isStr(d.rev) ? { kind: 'commit', repo: d.repo, rev: d.rev } : null;
    case 'align':
    case 'coverage':
    case 'help':
      return { kind: d.kind };
    default:
      return null;
  }
}
