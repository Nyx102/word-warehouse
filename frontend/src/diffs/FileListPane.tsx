import type { GitStatusFile } from '../types';

/** Dirty-file list: git status chars, per-file commit checkboxes (default
 * checked) and click-to-open-editor selection. */
export function FileListPane({ files, checked, onToggle, selected, onSelect }: {
  files: GitStatusFile[];
  checked: Set<string>;
  onToggle: (path: string, on: boolean) => void;
  selected: string | null;
  onSelect: (path: string | null) => void;
}) {
  if (!files.length) return <div className="empty">Working tree clean.</div>;
  return (
    <div className="diff-files">
      {files.map((f) => {
        const st = (f.status || 'M').trim() || 'M';
        return (
          <div
            key={f.path}
            className={'file-row' + (selected === f.path ? ' selected' : '')}
            onClick={() => onSelect(selected === f.path ? null : f.path)}
          >
            <input
              type="checkbox"
              checked={checked.has(f.path)}
              title="Include in commit"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggle(f.path, e.target.checked)}
            />
            <span className={'git-st st-' + st.replace(/\?/g, 'q')}>{st}</span>
            <span className="mono file-path" title={f.path}>{f.path}</span>
          </div>
        );
      })}
    </div>
  );
}
