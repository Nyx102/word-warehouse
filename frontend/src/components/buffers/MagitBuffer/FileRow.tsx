import { IconChevronRight } from '@/components/layout/icons';
import { fileLabel, statusChar, statusClass } from '@/features/git/fmt';
import { HunkBlock } from './HunkBlock';
import type { FileRowData, RowRenderCtx } from './types';

/** One file in a section: status char, path, stage/unstage + open actions, and
 * its expanded hunks when open. Clicking the row toggles its hunks. */
export function FileRow({ row, ctx }: { row: FileRowData; ctx: RowRenderCtx }) {
  const { key, section, entry: f, diff } = row;
  const canExpand = section !== 'untracked' && !!diff && diff.hunks.length > 0;
  const isOpen = canExpand && ctx.expanded.has(key);
  const ch = statusChar(section, f);
  return (
    <div>
      <div
        className={'magit-row magit-file-row' + (ctx.pointKey === key ? ' point' : '')}
        ref={ctx.setRowEl(key)}
        onClick={() => {
          ctx.focusSelf();
          ctx.setPoint(key);
          if (canExpand) ctx.toggleExpand(key);
        }}
      >
        <span className={'magit-expander' + (isOpen ? ' open' : '')}>
          {canExpand && <IconChevronRight />}
        </span>
        <span className={'git-st ' + statusClass(ch)}>{ch}</span>
        <span className="magit-path mono" title={f.path}>{fileLabel(f)}</span>
        <span className="row-actions">
          {section !== 'staged' && (
            <button
              className="btn btn-sm"
              disabled={!!ctx.busy}
              onClick={(e) => { e.stopPropagation(); ctx.onStage(row); }}
            >Stage</button>
          )}
          {section === 'staged' && (
            <button
              className="btn btn-sm"
              disabled={!!ctx.busy}
              onClick={(e) => { e.stopPropagation(); ctx.onUnstage(row); }}
            >Unstage</button>
          )}
          <button
            className="btn btn-sm"
            onClick={(e) => { e.stopPropagation(); ctx.onVisit(row); }}
          >Open</button>
        </span>
      </div>
      {isOpen && diff && diff.hunks.map((h, n) => (
        <HunkBlock
          key={key + '#' + n}
          section={section as 'unstaged' | 'staged'}
          path={f.path}
          file={diff}
          hunk={h}
          n={n}
          ctx={ctx}
        />
      ))}
    </div>
  );
}
