import { fmtWhen } from '@/features/git/fmt';
import type { GitLogEntry } from '@/lib/types';
import type { CommitRowData, RowRenderCtx } from './types';

/** A recent-commit row; clicking or visiting opens the commit buffer. */
export function CommitRow({ entry, ctx }: { entry: GitLogEntry; ctx: RowRenderCtx }) {
  const key = 'commit:' + entry.oid;
  const row: CommitRowData = { type: 'commit', key, entry };
  return (
    <div
      className={'magit-row magit-commit-row' + (ctx.pointKey === key ? ' point' : '')}
      ref={ctx.setRowEl(key)}
      onClick={() => {
        // Pure navigation, unlike a file row's click-to-expand; don't pin it as
        // "selected" forever after you leave.
        ctx.focusSelf();
        ctx.onVisit(row);
      }}
    >
      <span className="log-hash mono">{entry.hash}</span>
      <span className="log-subject" title={entry.subject}>{entry.subject}</span>
      <span className="log-date dim">{fmtWhen(entry.date)}</span>
    </div>
  );
}
