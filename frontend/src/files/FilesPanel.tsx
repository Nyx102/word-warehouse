import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../components/Toasts';
import { Modal } from '../components/Modal';
import { FileTree } from './FileTree';
import { FileEditor } from './FileEditor';
import type { DirEntry } from '../types';

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'pdf', 'zip', 'gz', 'tgz',
  'tar', 'bz2', 'xz', '7z', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3',
  'mp4', 'm4a', 'wav', 'ogg', 'webm', 'mov', 'avi', 'mkv', 'bin', 'exe', 'dll',
  'so', 'dylib', 'class', 'pyc', 'wasm', 'db', 'sqlite',
]);

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const joinPath = (dir: string, name: string) => (dir ? dir + '/' + name : name);
const dlHref = (p: string) => `/api/fs/download?path=${encodeURIComponent(p)}`;
const isBinaryFile = (name: string, size: number) => {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return BINARY_EXT.has(ext) || size > 2 * 1024 * 1024;
};

type Dialog = { kind: 'newfile' | 'newfolder' | 'rename' | 'delete'; path?: string } | null;

/** Files tab: lazy tree (left) + editor (right), with file management and
 * programmatic open-at-line via `target` (used by flags / search deep-links). */
export function FilesPanel({ active, target, onConsumeTarget }: {
  active: boolean;
  target: { path: string; line?: number | null } | null;
  onConsumeTarget: () => void;
}) {
  const [sel, setSel] = useState<DirEntry | null>(null);      // selected tree node
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<DirEntry | null>(null);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dval, setDval] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const contextDir = sel ? (sel.is_dir ? sel.path : parentOf(sel.path)) : '';

  const openFile = useCallback((path: string, entry: DirEntry | null, line: number | null) => {
    setOpenPath(path); setOpenEntry(entry); setOpenLine(line);
  }, []);
  const closeEditor = useCallback(() => {
    setOpenPath(null); setOpenEntry(null); setOpenLine(null);
  }, []);

  // Refresh the tree each time the tab is opened.
  useEffect(() => { if (active) bump(); }, [active, bump]);

  // Deep-link: open a file (optionally at a line) requested from another tab.
  useEffect(() => {
    if (!target) return;
    setSel(null);
    openFile(target.path, null, target.line ?? null);
    onConsumeTarget();
  }, [target, onConsumeTarget, openFile]);

  const onTreeSelect = (e: DirEntry) => {
    setSel(e);
    if (!e.is_dir) openFile(e.path, e, null);
  };

  const submit = useCallback(async () => {
    if (!dialog) return;
    const name = dval.trim();
    try {
      if (dialog.kind === 'newfile' || dialog.kind === 'newfolder') {
        if (!name) return;
        const p = joinPath(contextDir, name);
        await api(dialog.kind === 'newfolder' ? '/api/fs/mkdir' : '/api/fs/create',
          { method: 'POST', body: { path: p } });
        setDialog(null); bump();
        if (dialog.kind === 'newfile') openFile(p, { name, path: p, is_dir: false, size: 0, mtime: 0 }, null);
      } else if (dialog.kind === 'rename') {
        if (!name || !dialog.path) return;
        const to = joinPath(parentOf(dialog.path), name);
        await api('/api/fs/rename', { method: 'POST', body: { path: dialog.path, to } });
        const was = dialog.path;
        setDialog(null); bump();
        if (openPath === was) setOpenPath(to);
        if (sel?.path === was) setSel({ ...sel, path: to, name });
        toast('Renamed', 'ok');
      } else if (dialog.kind === 'delete') {
        if (!dialog.path) return;
        const was = dialog.path;
        await api('/api/fs/delete', { method: 'POST', body: { path: was } });
        setDialog(null); bump();
        if (openPath === was) closeEditor();
        if (sel?.path === was) setSel(null);
        toast('Deleted', 'ok');
      }
    } catch { /* api() toasts the error */ }
  }, [dialog, dval, contextDir, openPath, sel, bump, openFile, closeEditor]);

  const onUpload = async (files: FileList) => {
    let ok = 0;
    for (const f of Array.from(files)) {
      const dest = joinPath(contextDir, f.name);
      try {
        const res = await fetch(`/api/fs/upload?path=${encodeURIComponent(dest)}`, { method: 'POST', body: f });
        if (res.ok) ok++;
      } catch { /* ignore per-file */ }
    }
    if (ok) toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}`, 'ok');
    else toast('Upload failed', 'error');
    bump();
  };

  const showBinary = openEntry ? isBinaryFile(openEntry.name, openEntry.size) : false;

  return (
    <div className="diffs-panel">
      <div className="files-toolbar">
        <button className="btn btn-sm" onClick={() => { setDval(''); setDialog({ kind: 'newfile' }); }}>New file</button>
        <button className="btn btn-sm" onClick={() => { setDval(''); setDialog({ kind: 'newfolder' }); }}>New folder</button>
        <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>Upload</button>
        <span className="toolbar-spacer" />
        <span className="dim files-ctx mono" title="Actions target this location">{contextDir || '(root)'}</span>
        <button className="btn btn-sm" disabled={!sel} onClick={() => { setDval(sel!.name); setDialog({ kind: 'rename', path: sel!.path }); }}>Rename</button>
        <button className="btn btn-sm danger" disabled={!sel} onClick={() => setDialog({ kind: 'delete', path: sel!.path })}>Delete</button>
        <button className="btn btn-sm" onClick={bump} title="Refresh tree">↻</button>
        <input
          ref={fileInputRef} type="file" multiple hidden
          onChange={(e) => { if (e.target.files?.length) void onUpload(e.target.files); e.target.value = ''; }}
        />
      </div>
      <div className={'files-body' + (openPath ? ' has-editor' : '')}>
        <div className="files-left">
          <FileTree selected={sel?.path ?? null} onSelect={onTreeSelect} refreshKey={refreshKey} />
        </div>
        <div className="files-right">
          {openPath == null ? (
            <div className="empty pad">Select a file to view and edit.</div>
          ) : showBinary ? (
            <div className="merge-editor">
              <div className="editor-toolbar">
                <span className="editor-path mono" title={openPath}>{openPath}</span>
                <span className="toolbar-spacer" />
                <a className="btn btn-sm" href={dlHref(openPath)}>Download</a>
                <button className="btn btn-sm" onClick={closeEditor}>Close</button>
              </div>
              <div className="empty pad">
                Binary or large file — not editable here. <a href={dlHref(openPath)}>Download</a> instead.
              </div>
            </div>
          ) : (
            <FileEditor key={openPath} path={openPath} gotoLine={openLine} onSaved={bump} onClose={closeEditor} />
          )}
        </div>
      </div>

      {dialog && dialog.kind === 'delete' && (
        <Modal
          title="Delete"
          onClose={() => setDialog(null)}
          footer={(
            <>
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn danger" onClick={() => void submit()}>Delete</button>
            </>
          )}
        >
          <p>Delete <code>{dialog.path}</code>? This cannot be undone.</p>
        </Modal>
      )}
      {dialog && dialog.kind !== 'delete' && (
        <Modal
          title={dialog.kind === 'newfile' ? 'New file' : dialog.kind === 'newfolder' ? 'New folder' : 'Rename'}
          onClose={() => setDialog(null)}
          footer={(
            <>
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn primary" onClick={() => void submit()}>
                {dialog.kind === 'rename' ? 'Rename' : 'Create'}
              </button>
            </>
          )}
        >
          {dialog.kind !== 'rename' && (
            <p className="dim">In <code>{contextDir || '(root)'}</code></p>
          )}
          <input
            className="fs-name-input"
            autoFocus
            value={dval}
            placeholder={dialog.kind === 'newfolder' ? 'folder name' : 'file name'}
            onChange={(e) => setDval(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        </Modal>
      )}
    </div>
  );
}
