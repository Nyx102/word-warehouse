import { useEffect } from 'react';
import { useWorkspace } from '../app/workspace';
import { useSettings, type KeymapName } from '../app/settings';
import { useAsync } from '../hooks/useAsync';
import { useCursorPos } from '../editor/cursorStore';
import { formatVimMode, useVimMode, vimModeLetter } from '../editor/vimModeStore';
import { gitStatus, onGitMutate } from '../git/gitApi';
import { bufferModeLabel, repoForBuffer } from '../workspace/buffers';
import { IconGit } from './icons';
import type { StatusInfo } from '../types';

/** Global modeline: always mounted, one row, independent of buffer kind or
 * editor keymap. Shows what's open, where the cursor is, the relevant repo's
 * branch, and the editing/keymap mode — the usual Emacs-modeline staples. */
export function ModeLine({ status, busy }: { status: StatusInfo | null; busy: boolean }) {
  const ws = useWorkspace();
  const { keymap, setKeymap } = useSettings();
  const cursor = useCursorPos();
  const vimMode = useVimMode();

  const active = ws.buffers.find((b) => b.id === ws.activeId) ?? null;
  const desc = active?.desc ?? null;
  const repo = desc ? repoForBuffer(desc) : null;

  const branch = useAsync(
    () => (repo ? gitStatus(repo) : Promise.resolve(null)),
    [repo],
  );
  const reloadBranch = branch.reload;
  useEffect(() => {
    if (!repo) return;
    return onGitMutate((r) => { if (r === repo) reloadBranch(); });
  }, [repo, reloadBranch]);

  return (
    <div className="modeline mono">
      {vimMode && (
        <span className={'ml-vim ml-vim-' + vimMode.mode} title={formatVimMode(vimMode)}>
          {vimModeLetter(vimMode)}
        </span>
      )}
      <span className="ml-buffer">
        {active?.dirty && <span className="dirty-dot" title="Unsaved changes" />}
        {active ? active.title : 'no buffer'}
      </span>
      {desc && <span className="ml-mode">{bufferModeLabel(desc)}</span>}
      {desc?.kind === 'file' && cursor && (
        <span className="ml-pos">{cursor.line}:{cursor.col}</span>
      )}
      <span className="toolbar-spacer" />
      {repo && branch.data && (
        <span className="ml-git" title={`${repo} repo`}>
          <IconGit />
          {branch.data.branch.head ?? 'detached'}
          {branch.data.files.length > 0 && (
            <span className="ml-git-dirty">{branch.data.files.length}</span>
          )}
        </span>
      )}
      {status && (
        <span className="ml-index" title="Search index">
          {status.index.files} files
        </span>
      )}
      <select
        className="ml-keymap"
        value={keymap}
        onChange={(e) => setKeymap(e.target.value as KeymapName)}
        title="Editor keymap"
        aria-label="Editor keymap"
      >
        <option value="normal">Normal</option>
        <option value="vim">Vim</option>
      </select>
      <span className={'ml-busy' + (busy ? ' active' : '')} title={busy ? 'AI working' : 'Idle'} />
    </div>
  );
}
