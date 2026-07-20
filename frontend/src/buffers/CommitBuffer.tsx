import { useMemo, useRef } from 'react';
import { useWorkspace } from '../app/workspace';
import { useAsync } from '../hooks/useAsync';
import { ReadOnlyEditor, type ReadOnlyHandle } from '../editor/ReadOnlyEditor';
import { buildFilePatch, parseDiff } from '../git/diffParse';
import { gitShow } from '../git/gitApi';
import { bufferId } from '../workspace/buffers';
import type { RepoName } from '../types';

/** Concatenate the per-file patches into one document and record the 1-based
 * line each file's section starts on, so the numstat list can scroll the
 * viewer straight to a file. Blocks are normalized to end in a newline so a
 * missing-trailing-newline file can't run the next file's header onto its
 * last line. */
function joinPatch(patches: string[]): { text: string; starts: number[] } {
  const starts: number[] = [];
  let acc = '';
  for (const p of patches) {
    starts.push(acc.length === 0 ? 1 : acc.split('\n').length);
    acc += p.endsWith('\n') ? p : p + '\n';
  }
  return { text: acc.replace(/\n$/, ''), starts };
}

/** Commit detail: meta header, numstat file list (click scrolls the patch to
 * that file), and the full patch in a read-only but navigable editor — a real
 * cursor with the same arrows/j/k/Ctrl-d/Ctrl-u scrolling as an editable
 * file, it just can't be changed. */
export function CommitBuffer({ repo, rev }: { repo: RepoName; rev: string }) {
  const ws = useWorkspace();
  const active = ws.activeId === bufferId({ kind: 'commit', repo, rev });
  const detail = useAsync(() => gitShow(repo, rev), [repo, rev]);
  const patch = useMemo(() => {
    if (!detail.data) return { text: '', starts: [] as number[] };
    return joinPatch(parseDiff(detail.data.patch).files.map(buildFilePatch));
  }, [detail.data]);
  const editorRef = useRef<ReadOnlyHandle>(null);

  if (detail.error) {
    return (
      <div className="commit-buffer">
        <div className="magit-error">
          {detail.error.message} <button className="btn btn-sm" onClick={detail.reload}>Retry</button>
        </div>
      </div>
    );
  }
  if (!detail.data) return <div className="empty">Loading…</div>;

  const { meta, stat } = detail.data;

  return (
    <div className="commit-buffer">
      <div className="commit-header">
        <div className="commit-meta">
          <div className="commit-meta-row">
            <span className="log-hash mono">{meta.short}</span>
            <span className="commit-author">{meta.author} <span className="dim">&lt;{meta.email}&gt;</span></span>
            <span className="commit-date dim mono">{meta.date}</span>
          </div>
          {meta.parents.length > 0 && (
            <div className="commit-meta-row dim">
              parent{meta.parents.length > 1 ? 's' : ''}
              {meta.parents.map((p) => (
                <button
                  key={p}
                  className="commit-parent mono"
                  onClick={() => ws.open({ kind: 'commit', repo, rev: p })}
                >{p.slice(0, 8)}</button>
              ))}
            </div>
          )}
          <h3 className="commit-subject">{meta.subject}</h3>
          {meta.body && <pre className="commit-body mono">{meta.body}</pre>}
        </div>
        <div className="commit-stat">
          {stat.map((s, i) => (
            <div
              key={s.path + ':' + i}
              className="commit-stat-row"
              onClick={() => editorRef.current?.scrollToLine(patch.starts[i] ?? 1)}
            >
              <span className="magit-path mono" title={s.path}>{s.path}</span>
              <span className="stat-add">{s.added == null ? 'bin' : '+' + s.added}</span>
              <span className="stat-del">{s.deleted == null ? '' : '−' + s.deleted}</span>
            </div>
          ))}
          {stat.length === 0 && <div className="magit-empty dim">no file changes</div>}
        </div>
      </div>
      {patch.text
        ? <ReadOnlyEditor ref={editorRef} className="commit-patch" text={patch.text} diff active={active} />
        : <div className="empty">No patch.</div>}
    </div>
  );
}
