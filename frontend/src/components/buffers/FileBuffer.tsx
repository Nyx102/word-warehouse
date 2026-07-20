import { useCallback } from 'react';
import { FileEditor } from '@/features/files/FileEditor';
import { useWorkspace } from '@/context/workspace';
import { NESTED_REPO_PREFIX } from './buffers';

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'tgz',
  'tar', 'bz2', 'xz', '7z', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3',
  'mp4', 'm4a', 'wav', 'ogg', 'webm', 'mov', 'avi', 'mkv', 'bin', 'exe', 'dll',
  'so', 'dylib', 'class', 'pyc', 'wasm', 'db', 'sqlite',
]);

const isBinaryPath = (p: string) =>
  BINARY_EXT.has(p.slice(p.lastIndexOf('.') + 1).toLowerCase());

/** File buffer: the shared sha256-tracked editor, or a download stub for
 * binary files. Oversized text files hit FileEditor's own 413 fallback. */
export function FileBuffer({ bufferId, path, line }: {
  bufferId: string;
  path: string;
  line?: number | null;
}) {
  const ws = useWorkspace();
  const dlHref = `/api/fs/download?path=${encodeURIComponent(path)}`;
  const active = ws.activeId === bufferId;

  const openHistory = useCallback(() => {
    if (path.startsWith(NESTED_REPO_PREFIX)) {
      ws.open({ kind: 'log', repo: 'repo', path: path.slice(NESTED_REPO_PREFIX.length) });
    } else {
      ws.open({ kind: 'log', repo: 'corpus', path });
    }
  }, [ws, path]);

  const setDirty = useCallback(
    (d: boolean) => ws.setDirty(bufferId, d),
    [ws, bufferId],
  );

  if (isBinaryPath(path)) {
    return (
      <div className="merge-editor">
        <div className="editor-toolbar">
          <span className="editor-path mono" title={path}>{path}</span>
          <span className="toolbar-spacer" />
          <button className="btn btn-sm" onClick={openHistory} title="File history">History</button>
          <a className="btn btn-sm" href={dlHref}>Download</a>
          <button className="btn btn-sm" onClick={() => ws.close(bufferId)}>Close</button>
        </div>
        <div className="empty pad">
          Binary file—not editable here. <a href={dlHref}>Download</a> instead.
        </div>
      </div>
    );
  }

  return (
    <FileEditor
      path={path}
      gotoLine={line ?? null}
      active={active}
      onClose={() => ws.close(bufferId)}
      onDirtyChange={setDirty}
      onHistory={openHistory}
    />
  );
}
