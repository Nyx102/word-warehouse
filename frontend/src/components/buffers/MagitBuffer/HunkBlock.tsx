import { DiffText } from '@/features/git/DiffText';
import { hunkBody, type DiffFile, type DiffHunk } from '@/features/git/diffParse';
import type { HunkRowData, RowRenderCtx } from './types';

interface Props {
  section: 'unstaged' | 'staged';
  path: string;
  file: DiffFile;
  hunk: DiffHunk;
  n: number;
  ctx: RowRenderCtx;
}

/** One diff hunk inside an expanded file row, with its own stage/unstage and
 * open actions. */
export function HunkBlock({ section, path, file, hunk, n, ctx }: Props) {
  const key = section + ':' + path + '#' + n;
  const row: HunkRowData = { type: 'hunk', key, section, path, file, hunk };
  return (
    <div
      className={'magit-hunk' + (ctx.pointKey === key ? ' point' : '')}
      ref={ctx.setRowEl(key)}
      onClick={() => { ctx.focusSelf(); ctx.setPoint(key); }}
    >
      <div className="magit-hunk-head">
        <span className="magit-hunk-label mono">{hunk.header}</span>
        <span className="row-actions">
          <button
            className="btn btn-sm"
            disabled={!!ctx.busy}
            onClick={(e) => {
              e.stopPropagation();
              if (section === 'unstaged') ctx.onStage(row); else ctx.onUnstage(row);
            }}
          >{section === 'unstaged' ? 'Stage' : 'Unstage'}</button>
          <button
            className="btn btn-sm"
            onClick={(e) => { e.stopPropagation(); ctx.onVisit(row); }}
          >Open</button>
        </span>
      </div>
      <DiffText text={hunkBody(hunk)} />
    </div>
  );
}
