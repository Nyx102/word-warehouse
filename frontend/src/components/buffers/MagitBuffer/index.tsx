import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSettings } from '@/context/settings';
import { useWorkspace } from '@/context/workspace';
import { toast } from '@/components/Toasts';
import { buildHunkPatch, parseDiff, type DiffFile } from '@/features/git/diffParse';
import { repoLabel, type GitSection } from '@/features/git/fmt';
import {
  gitDiffText,
  gitLog,
  gitStatus,
  repoFsPath,
  type GitMutateResult,
} from '@/features/git/gitApi';
import { gitKeys } from '@/features/git/gitKeys';
import { useGitMutations } from '@/features/git/useGitMutations';
import { useAutoGrow } from '@/hooks/useAutoGrow';
import { IconRefresh, IconCheck } from '@/components/layout/icons';
import type { GitStatusFile, RepoName } from '@/lib/types';
import { CommitRow } from './CommitRow';
import { Section } from './Section';
import { useRovingPoint } from './useRovingPoint';
import type { Data, Row, RowRenderCtx } from './types';

const byPath = (files: DiffFile[]) => new Map(files.map((f) => [f.path, f]));
const COMMIT_MAX_ROWS = 12;

/** Magit-style status buffer: sections for untracked/unstaged/staged files
 * with inline expandable hunks, recent commits, and a commit editor for the
 * staged set. Roving point keyboard model bound on the buffer container. */
export function MagitBuffer({ repo }: { repo: RepoName }) {
  const ws = useWorkspace();
  const { keymap } = useSettings();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const commitRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(commitRef, msg, COMMIT_MAX_ROWS);

  // One composite key holds the atomic 4-way snapshot; react-query's own
  // request bookkeeping replaces the old seqRef out-of-order guard. Any git
  // mutation invalidates ['git', repo], which prefix-matches this key.
  const q = useQuery({
    queryKey: gitKeys.magit(repo),
    queryFn: async (): Promise<Data> => {
      const [status, logRes, wt, st] = await Promise.all([
        gitStatus(repo),
        gitLog(repo, { n: 10 }),
        gitDiffText(repo, { mode: 'worktree' }),
        gitDiffText(repo, { mode: 'staged' }),
      ]);
      return {
        status,
        log: logRes.log,
        worktree: byPath(parseDiff(wt).files),
        staged: byPath(parseDiff(st).files),
      };
    },
  });
  const git = useGitMutations(repo);
  const data = q.data ?? null;
  const loading = q.isFetching;
  const error = q.error ? q.error.message : null;
  const refetch = q.refetch;

  const files = data?.status.files ?? [];
  const untrackedFiles = files.filter((f) => f.untracked);
  const unstagedFiles = files.filter((f) => !f.untracked && f.worktree !== '');
  const stagedFiles = files.filter((f) => !f.untracked && f.index !== '');

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    const pushFiles = (section: GitSection, list: GitStatusFile[], diffs: Map<string, DiffFile> | null) => {
      for (const f of list) {
        const key = section + ':' + f.path;
        const diff = diffs?.get(f.path) ?? null;
        out.push({ type: 'file', key, section, entry: f, diff });
        if (diff && expanded.has(key) && section !== 'untracked') {
          diff.hunks.forEach((h, n) => out.push({
            type: 'hunk',
            key: key + '#' + n,
            section,
            path: f.path,
            file: diff,
            hunk: h,
          }));
        }
      }
    };
    pushFiles('untracked', untrackedFiles, null);
    pushFiles('unstaged', unstagedFiles, data.worktree);
    pushFiles('staged', stagedFiles, data.staged);
    for (const e of data.log) out.push({ type: 'commit', key: 'commit:' + e.oid, entry: e });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, expanded]);

  const { pointRow, setPointKey, move, setRowEl, focusSelf, containerRef } = useRovingPoint(rows);

  // Re-poll whenever the buffer becomes the active tab
  const active = ws.activeId === 'magit:' + repo;
  useEffect(() => { if (active) void refetch(); }, [active, refetch]);
  // Buffers stay mounted (CSS-hidden) across tab switches, so keyboard nav
  // (n/p/j/k, TAB to expand) only works if we grab focus on activation;
  // otherwise the first keypress after switching tabs falls through to
  // whatever the browser's default tab order last focused.
  useEffect(() => { if (active) containerRef.current?.focus(); }, [active, containerRef]);

  const toggleExpand = (key: string, only?: 'open') => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) { if (only !== 'open') n.delete(key); }
      else n.add(key);
      return n;
    });
  };

  const run = useCallback(async (key: string, fn: () => Promise<GitMutateResult>) => {
    setBusy(key);
    try {
      // Both the success refresh and any failure resync come from the
      // mutation's onSettled invalidation of ['git', repo].
      await fn();
    } finally {
      setBusy(null);
    }
  }, []);

  const stageAt = (row: Row) => {
    if (busy) return;
    if (row.type === 'file' && row.section !== 'staged') {
      void run(row.key, () => git.stage([row.entry.path]));
    } else if (row.type === 'hunk' && row.section === 'unstaged') {
      void run(row.key, () => git.apply(buildHunkPatch(row.file, row.hunk)));
    }
  };

  const unstageAt = (row: Row) => {
    if (busy) return;
    if (row.type === 'file' && row.section === 'staged') {
      void run(row.key, () => git.unstage([row.entry.path]));
    } else if (row.type === 'hunk' && row.section === 'staged') {
      void run(row.key, () => git.apply(buildHunkPatch(row.file, row.hunk), true));
    }
  };

  const visit = (row: Row) => {
    if (row.type === 'commit') {
      ws.open({ kind: 'commit', repo, rev: row.entry.oid });
    } else if (row.type === 'hunk') {
      // A hunk means "show me that change": the merge editor, scrolled to and
      // briefly flashing that exact line.
      ws.open({ kind: 'diff', repo, path: row.path, line: row.hunk.newStart });
    } else {
      // The filename itself just means "open the file": plain editor, top of
      // file, no target line.
      ws.open({ kind: 'file', path: repoFsPath(repo, row.entry.path) });
    }
  };

  const stagedCount = stagedFiles.length;
  const canCommit = stagedCount > 0 && msg.trim() !== '' && !busy;

  const doCommit = async () => {
    if (!canCommit) return;
    const message = msg.trim();
    setBusy('commit');
    try {
      const r = await git.commit(message);
      if (r.ok) {
        toast(`Committed ${r.hash ?? ''}`.trim(), 'ok');
        setMsg('');
      }
      // Failure resyncs via the mutation's onSettled invalidation.
    } finally {
      setBusy(null);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    // Tab never gets to do browser default focus-cycling in here, even from a
    // focused button; it's either "expand this row" or nothing.
    if (e.key === 'Tab') {
      e.preventDefault();
      if (pointRow?.type === 'file' && pointRow.diff?.hunks.length && pointRow.section !== 'untracked') {
        toggleExpand(pointRow.key);
      }
      return;
    }
    if (tag === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'j': if (keymap === 'vim') { e.preventDefault(); move(1); } break;
      case 'k': if (keymap === 'vim') { e.preventDefault(); move(-1); } break;
      case 'n': if (keymap !== 'vim') { e.preventDefault(); move(1); } break;
      case 'p': if (keymap !== 'vim') { e.preventDefault(); move(-1); } break;
      case 'd':
        if (pointRow?.type === 'file' && pointRow.diff?.hunks.length && pointRow.section !== 'untracked') {
          toggleExpand(pointRow.key, 'open');
        }
        break;
      case 's': if (pointRow) stageAt(pointRow); break;
      case 'u': if (pointRow) unstageAt(pointRow); break;
      case 'g': void refetch(); break;
      case 'l': e.preventDefault(); ws.open({ kind: 'log', repo }); break;
      case 'Enter': if (pointRow) { e.preventDefault(); visit(pointRow); } break;
      case 'c': e.preventDefault(); commitRef.current?.focus(); break;
    }
  };

  const ctx: RowRenderCtx = {
    expanded,
    pointKey: pointRow?.key ?? null,
    busy,
    setRowEl,
    focusSelf,
    setPoint: setPointKey,
    toggleExpand,
    onStage: stageAt,
    onUnstage: unstageAt,
    onVisit: visit,
  };

  const b = data?.status.branch;
  return (
    <div className="magit" tabIndex={0} ref={containerRef} onKeyDown={onKey}>
      <div className="magit-head">
        <span className="magit-repo">{repoLabel(repo)}</span>
        <span className="magit-branch mono">{b ? (b.head ?? 'detached') : '…'}</span>
        {b && b.ahead != null && (b.ahead > 0 || (b.behind ?? 0) > 0) && (
          <span className="magit-ab" title={`ahead ${b.ahead}, behind ${b.behind} of ${b.upstream ?? 'upstream'}`}>
            ↑<span className="magit-ab-n">{b.ahead}</span> ↓<span className="magit-ab-n">{b.behind}</span>
          </span>
        )}
        <span className="toolbar-spacer" />
        <span className="magit-keys dim">
          {keymap === 'vim' ? 'j/k move' : 'n/p move'} · TAB expand · s/u stage/unstage · RET visit · l log · c commit · g refresh
        </span>
        <button
          className={'icon-btn magit-refresh' + (loading ? ' loading' : '')}
          onClick={() => void refetch()}
          disabled={loading}
          title="Refresh (g)"
          aria-label="Refresh"
        ><IconRefresh /></button>
      </div>
      {error && (
        <div className="magit-error">
          {error} <button className="btn btn-sm" onClick={() => void refetch()}>Retry</button>
        </div>
      )}
      {!data && !error && <div className="empty">Loading…</div>}
      {data && (
        <div className="magit-body">
          <Section title="Untracked" id="untracked" list={untrackedFiles} note="whole-file staging only" data={data} ctx={ctx} />
          <Section title="Unstaged" id="unstaged" list={unstagedFiles} data={data} ctx={ctx} />
          <Section title="Staged" id="staged" list={stagedFiles} data={data} ctx={ctx} />
          <div className="magit-section">
            <div className="magit-section-h">Recent commits</div>
            {data.log.length === 0
              ? <div className="magit-empty dim">no commits yet</div>
              : data.log.map((e) => <CommitRow key={'commit:' + e.oid} entry={e} ctx={ctx} />)}
            <button
              className="btn btn-sm magit-more"
              onClick={() => ws.open({ kind: 'log', repo })}
            >Full log</button>
          </div>
        </div>
      )}
      <div className="magit-commitbox">
        <div className="field-box">
          <textarea
            ref={commitRef}
            className="magit-msg mono"
            value={msg}
            placeholder="Commit message…"
            rows={1}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void doCommit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                containerRef.current?.focus();
              }
            }}
          />
          <div className="field-bar">
            <span className="magit-commit-hint dim">
              {stagedCount === 0
                ? 'Nothing staged — stage changes first'
                : `${stagedCount} staged · Ctrl+Enter · Esc exits`}
            </span>
            <button
              className={'field-send commit' + (busy === 'commit' ? ' loading' : '')}
              disabled={!canCommit}
              onClick={() => void doCommit()}
              aria-label="Commit staged"
              title={`Commit staged (${stagedCount}) · Ctrl+Enter`}
            >{busy === 'commit' ? <IconRefresh /> : <IconCheck />}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
