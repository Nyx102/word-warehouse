import type { GitSection } from '@/features/git/fmt';
import type { GitStatusFile } from '@/lib/types';
import { FileRow } from './FileRow';
import type { Data, FileRowData, RowRenderCtx } from './types';

interface Props {
  title: string;
  id: GitSection;
  list: GitStatusFile[];
  note?: string;
  data: Data;
  ctx: RowRenderCtx;
}

/** A titled file section (untracked/unstaged/staged) with its count, optional
 * note, and file rows. */
export function Section({ title, id, list, note, data, ctx }: Props) {
  return (
    <div className="magit-section">
      <div className="magit-section-h">
        {title} <span className="magit-count">{list.length}</span>
        {note && list.length > 0 && <span className="magit-note dim">{note}</span>}
      </div>
      {list.length === 0
        ? <div className="magit-empty dim">nothing</div>
        : list.map((f) => {
          const key = id + ':' + f.path;
          const diff = id === 'unstaged' ? data.worktree.get(f.path)
            : id === 'staged' ? data.staged.get(f.path)
              : null;
          const row: FileRowData = { type: 'file', key, section: id, entry: f, diff: diff ?? null };
          return <FileRow key={key} row={row} ctx={ctx} />;
        })}
    </div>
  );
}
