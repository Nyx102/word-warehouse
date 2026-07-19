import { useMemo, useRef } from 'react';
import { useWorkspace } from '../app/workspace';
import { useAsync } from '../hooks/useAsync';
import { DiffText } from '../git/DiffText';
import { buildFilePatch, parseDiff } from '../git/diffParse';
import { gitShow } from '../git/gitApi';
import type { RepoName } from '../types';

/** Commit detail: meta header, numstat file list (click scrolls to that
 * file's patch section), full patch rendered per file via DiffText. */
export function CommitBuffer({ repo, rev }: { repo: RepoName; rev: string }) {
  const ws = useWorkspace();
  const detail = useAsync(() => gitShow(repo, rev), [repo, rev]);
  const parsed = useMemo(
    () => (detail.data ? parseDiff(detail.data.patch) : null),
    [detail.data],
  );
  const fileEls = useRef(new Map<number, HTMLElement>());

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
  const scrollTo = (i: number) =>
    fileEls.current.get(i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="commit-buffer">
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
          <div key={s.path + ':' + i} className="commit-stat-row" onClick={() => scrollTo(i)}>
            <span className="magit-path mono" title={s.path}>{s.path}</span>
            <span className="stat-add">{s.added == null ? 'bin' : '+' + s.added}</span>
            <span className="stat-del">{s.deleted == null ? '' : '−' + s.deleted}</span>
          </div>
        ))}
        {stat.length === 0 && <div className="magit-empty dim">no file changes</div>}
      </div>
      <div className="commit-patch">
        {parsed?.files.map((f, i) => (
          <section
            key={f.path + ':' + i}
            className="commit-patch-file"
            ref={(el) => { if (el) fileEls.current.set(i, el); else fileEls.current.delete(i); }}
          >
            <DiffText text={buildFilePatch(f)} />
          </section>
        ))}
        {(!parsed || parsed.files.length === 0) && <div className="empty">No patch.</div>}
      </div>
    </div>
  );
}
