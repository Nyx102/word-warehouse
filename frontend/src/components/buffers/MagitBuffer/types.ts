import type { DiffFile, DiffHunk } from '@/features/git/diffParse';
import type { GitSection } from '@/features/git/fmt';
import type { GitLogEntry, GitStatusFile, GitStatusResponse } from '@/lib/types';

/** Atomic 4-way snapshot the magit buffer renders from. */
export interface Data {
  status: GitStatusResponse;
  log: GitLogEntry[];
  worktree: Map<string, DiffFile>;
  staged: Map<string, DiffFile>;
}

export interface FileRowData {
  type: 'file';
  key: string;
  section: GitSection;
  entry: GitStatusFile;
  diff: DiffFile | null;
}
export interface HunkRowData {
  type: 'hunk';
  key: string;
  section: 'unstaged' | 'staged';
  path: string;
  file: DiffFile;
  hunk: DiffHunk;
}
export interface CommitRowData {
  type: 'commit';
  key: string;
  entry: GitLogEntry;
}
export type Row = FileRowData | HunkRowData | CommitRowData;

/** Shared wiring the presentational rows need from the buffer: the roving-point
 * cursor, expand state, and the action callbacks that touch git. Bundled so a
 * row (and its nested hunks) can be handed one prop instead of a dozen. */
export interface RowRenderCtx {
  expanded: Set<string>;
  /** Key of the currently pointed row, drives the `.point` highlight. */
  pointKey: string | null;
  busy: string | null;
  setRowEl: (key: string) => (el: HTMLDivElement | null) => void;
  focusSelf: () => void;
  setPoint: (key: string) => void;
  toggleExpand: (key: string, only?: 'open') => void;
  onStage: (row: Row) => void;
  onUnstage: (row: Row) => void;
  onVisit: (row: Row) => void;
}
