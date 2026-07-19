/* Shared API types for the WorldEnd Translation Workbench.
 * These mirror the backend contract exactly; loose where the backend is loose. */

export type ThreadId = number | string;
export type RepoName = 'corpus' | 'repo';
export type ModelName = 'haiku' | 'sonnet' | 'opus' | 'default';
export type LintScope = 'raw' | 'finished' | 'all';

/* ---- files tab ---- */
export interface DirEntry {
  name: string;
  path: string;      // FS_ROOT-relative (posix)
  is_dir: boolean;
  size: number;
  mtime: number;
}

/* ---- status ---- */

export interface StatusInfo {
  index: { files: number; chunks: number; last_scan_age_s: number | null };
  git: { corpus: { dirty: number }; repo: { dirty: number } };
  chat_active: number;
}

/* ---- search ---- */

export interface SearchResult {
  chunk_id: number;
  path: string;
  source: string;
  lang: string;
  series: number | string | null;
  volume: number | string | null;
  chapter_label: string | null;
  chapter_title: string | null;
  subtitle: string | null;
  part_title: string | null;
  start_line: number;
  end_line: number;
  kind: string;
  snippet: string;
}

export interface ChunkNeighbor {
  id: number;
  ord: number;
  start_line: number;
  end_line: number;
  text: string;
}

export interface ChunkRow {
  chunk_id?: number;
  ord?: number;
  path: string;
  start_line: number;
  end_line: number;
  text: string;
  [key: string]: unknown;
}

export interface ChunkResponse {
  row: ChunkRow;
  neighbors: ChunkNeighbor[];
}

export interface AlignRow {
  path: string;
  source: string;
  lang: string;
  volume: number | string | null;
  ord: number;
  chapter_label: string | null;
  title: string | null;
  subtitle: string | null;
  subtitle_key: string | null;
  part_title: string | null;
  start_line: number;
  end_line: number;
}

/* ---- files ---- */

export interface FilePage {
  path: string;
  total_lines: number;
  start: number;
  lines: string[];
}

export interface FileFull {
  path: string;
  content: string;
  sha256: string;
  total_lines: number;
}

/* ---- git ---- */

export interface GitFileResponse {
  path: string;
  rev: string;
  exists: boolean;
  content: string;
}

export interface GitBranchState {
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

export interface GitStatusFile {
  path: string;
  orig_path: string | null; // rename/copy source, else null
  index: string;            // one status char; '' when unchanged
  worktree: string;         // one status char; '' when unchanged
  untracked: boolean;
  status: string;           // legacy porcelain-v1 code ('M', '??', ...)
}

export interface GitStatusResponse {
  branch: GitBranchState;
  files: GitStatusFile[];
}

export interface GitLogEntry {
  hash: string;   // short sha
  oid: string;    // full sha
  author: string;
  date: string;   // iso-strict
  subject: string;
}

export interface GitLogResponse {
  log: GitLogEntry[];
  has_more: boolean;
}

export interface GitCommitMeta {
  hash: string;   // full sha
  short: string;
  author: string;
  email: string;
  date: string;   // iso-strict
  parents: string[];
  subject: string;
  body: string;
}

export interface GitDiffStat {
  path: string;
  added: number | null;   // null for binary files
  deleted: number | null;
}

export interface GitCommitDetail {
  meta: GitCommitMeta;
  stat: GitDiffStat[];
  patch: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  short: string;  // short sha of the tip
  subject: string;
}

export interface GitBranchesResponse {
  current: string | null;
  branches: GitBranch[];
}

export type GitDiffMode = 'head' | 'worktree' | 'staged';

/* ---- lint / flags ---- */

export interface LintLocation {
  path: string;
  line: number;
  col?: number | null;
  snippet: string;
}

export interface LintAi {
  verdict: 'clear' | 'keep';
  reason: string;
  judged_at: string;
}

export interface LintFlag {
  category: 'nearmiss' | 'regression';
  key: string;
  closest?: string | null;
  rule?: number | string | null;
  find?: string | null;
  replace?: string | null;
  manual?: boolean;
  matched?: string | null;
  count?: number;
  dismissed?: boolean;
  ai?: LintAi | null;
  locations: LintLocation[];
}

export interface LintFile {
  path: string;
  flags: LintFlag[];
}

export interface LintReport {
  generated_at: string;
  scope: string;
  total: number;
  triage_pending?: number;
  triage?: { running: boolean; in_backoff: boolean; last_error: string | null };
  files: LintFile[];
}

/* ---- chat ---- */

export interface Thread {
  id: ThreadId;
  title: string | null;
  claude_session_id?: string | null;
  model: ModelName | null;
  created_at: number;        // epoch seconds
  last_active: number | null;
  pinned: number;
  archived: number;
}

export interface ThreadMessage {
  id: number;
  turn: number;
  seq: number;
  kind: string;
  content: string; // JSON string, parses to ChatEventPayload
  created_at: number;
}

/* One SSE/replayed chat event. Kinds: user_text, init, text_delta,
 * assistant_text, tool_use, tool_result, thinking, result, error, done. */
export interface ChatEventPayload {
  kind: string;
  turn?: number;
  seq?: number;
  text?: string;
  session_id?: string;
  name?: string;
  input_preview?: string;
  preview?: string;
  is_error?: boolean;
  ok?: boolean;
  duration_s?: number;
  message?: string;
}
