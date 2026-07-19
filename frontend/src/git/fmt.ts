import { fmtAge } from '../util';
import type { GitStatusFile, RepoName } from '../types';

/** Display name for a repo tab/header; 'corpus' is this app's own unified
 * repo (code + corpus data), not the corpus content itself */
export function repoLabel(repo: RepoName): string {
  return repo === 'corpus' ? 'App' : 'Translation';
}

/** Iso date -> compact relative age for recent commits, else YYYY-MM-DD */
export function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const age = (Date.now() - t) / 1000;
  if (age >= 0 && age < 48 * 3600) return fmtAge(age);
  return iso.slice(0, 10);
}

export type GitSection = 'untracked' | 'unstaged' | 'staged';

/** Single status char shown for a file in the given section */
export function statusChar(section: GitSection, f: GitStatusFile): string {
  if (section === 'untracked') return '?';
  return (section === 'staged' ? f.index : f.worktree) || ' ';
}

/** Badge class for a status char, matching git.css .git-st variants */
export function statusClass(ch: string): string {
  if (ch === '?') return 'st-qq';
  if (/^[A-Z]$/.test(ch)) return 'st-' + ch;
  return '';
}

/** Display label for a status row; renames show origin -> target */
export function fileLabel(f: GitStatusFile): string {
  return f.orig_path ? `${f.orig_path} → ${f.path}` : f.path;
}
