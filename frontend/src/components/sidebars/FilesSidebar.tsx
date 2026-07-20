import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/components/Toasts';
import { Modal } from '@/components/Modal';
import { FileTree } from '@/features/files/FileTree';
import { useWorkspace } from '@/context/workspace';
import { IconChart, IconFilePlus, IconFolderPlus, IconRefresh, IconUpload } from '@/components/layout/icons';
import type { DirEntry } from '@/lib/types';

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const joinPath = (dir: string, name: string) => (dir ? dir + '/' + name : name);
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1) || p;

type Dialog = { kind: 'newfile' | 'newfolder' | 'rename' | 'delete'; path?: string } | null;
type Menu = { entry: DirEntry; x: number; y: number } | null;

/** Files section: lazy tree with a create/upload toolbar plus per-entry
 * actions (rename/delete/download) on a kebab or right-click menu. Clicking
 * a file opens it as a workspace buffer. The coverage report lives in this
 * toolbar too — it's a corpus-content report, not a git operation. */
export function FilesSidebar() {
  const ws = useWorkspace();
  const qc = useQueryClient();
  const [sel, setSel] = useState<DirEntry | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dval, setDval] = useState('');
  const [menu, setMenu] = useState<Menu>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-list the root and every open dir (replaces the old refreshKey bump).
  const invalidateFs = useCallback(
    () => { void qc.invalidateQueries({ queryKey: ['fs', 'list'] }); },
    [qc],
  );

  const createMut = useMutation({
    mutationFn: (v: { path: string; dir: boolean }) =>
      api(v.dir ? '/api/fs/mkdir' : '/api/fs/create', { method: 'POST', body: { path: v.path } }),
    onSuccess: invalidateFs,
  });
  const renameMut = useMutation({
    mutationFn: (v: { path: string; to: string }) =>
      api('/api/fs/rename', { method: 'POST', body: { path: v.path, to: v.to } }),
    onSuccess: invalidateFs,
  });
  const deleteMut = useMutation({
    mutationFn: (path: string) => api('/api/fs/delete', { method: 'POST', body: { path } }),
    onSuccess: invalidateFs,
  });

  const contextDir = sel ? (sel.is_dir ? sel.path : parentOf(sel.path)) : '';

  // Refresh the tree each time the section is opened
  useEffect(() => { if (ws.rail === 'files') invalidateFs(); }, [ws.rail, invalidateFs]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const openFile = useCallback((path: string) => {
    ws.open({ kind: 'file', path });
    ws.setDrawerOpen(false);
  }, [ws]);

  const onTreeSelect = (e: DirEntry) => {
    setSel(e);
    if (!e.is_dir) openFile(e.path);
  };

  const onTreeMenu = (entry: DirEntry, x: number, y: number) => {
    setSel(entry);
    setMenu({ entry, x, y });
  };

  const submit = useCallback(async () => {
    if (!dialog) return;
    const name = dval.trim();
    // Each mutation invalidates ['fs','list'] onSuccess (the old bump()); the
    // await only proceeds past a rejection, so post-success UI stays gated.
    try {
      if (dialog.kind === 'newfile' || dialog.kind === 'newfolder') {
        if (!name) return;
        const p = joinPath(contextDir, name);
        await createMut.mutateAsync({ path: p, dir: dialog.kind === 'newfolder' });
        setDialog(null);
        if (dialog.kind === 'newfile') openFile(p);
      } else if (dialog.kind === 'rename') {
        if (!name || !dialog.path) return;
        const to = joinPath(parentOf(dialog.path), name);
        await renameMut.mutateAsync({ path: dialog.path, to });
        const was = dialog.path;
        setDialog(null);
        // A buffer keyed on the old path is stale; swap it for the new one
        ws.close('file:' + was);
        if (sel?.path === was) setSel({ ...sel, path: to, name });
        toast('Renamed', 'ok');
      } else if (dialog.kind === 'delete') {
        if (!dialog.path) return;
        const was = dialog.path;
        await deleteMut.mutateAsync(was);
        setDialog(null);
        ws.close('file:' + was);
        if (sel?.path === was) setSel(null);
        toast('Deleted', 'ok');
      }
    } catch { /* api() toasts the error */ }
  }, [dialog, dval, contextDir, sel, openFile, ws, createMut, renameMut, deleteMut]);

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
    invalidateFs();
  };

  const menuStyle = menu
    ? {
      left: Math.max(4, Math.min(menu.x, window.innerWidth - 170)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - 140)),
    }
    : undefined;

  return (
    <div className="fs-side">
      <div className="fs-tools">
        <button
          className="icon-btn fs-tool-btn"
          title="New file" aria-label="New file"
          onClick={() => { setDval(''); setDialog({ kind: 'newfile' }); }}
        ><IconFilePlus /></button>
        <button
          className="icon-btn fs-tool-btn"
          title="New folder" aria-label="New folder"
          onClick={() => { setDval(''); setDialog({ kind: 'newfolder' }); }}
        ><IconFolderPlus /></button>
        <button
          className="icon-btn fs-tool-btn"
          title="Upload" aria-label="Upload"
          onClick={() => fileInputRef.current?.click()}
        ><IconUpload /></button>
        <span className="toolbar-spacer" />
        <button
          className="icon-btn fs-tool-btn"
          title="Translation coverage report" aria-label="Translation coverage report"
          onClick={() => { ws.open({ kind: 'coverage' }); ws.setDrawerOpen(false); }}
        ><IconChart /></button>
        <button
          className="icon-btn fs-tool-btn"
          title="Refresh tree" aria-label="Refresh tree"
          onClick={invalidateFs}
        ><IconRefresh /></button>
        <input
          ref={fileInputRef} type="file" multiple hidden
          onChange={(e) => { if (e.target.files?.length) void onUpload(e.target.files); e.target.value = ''; }}
        />
      </div>
      <div className="fs-ctx dim mono" title="New files and uploads land here">{contextDir || '(root)'}</div>
      <div className="fs-tree">
        <FileTree
          selected={sel?.path ?? null}
          onSelect={onTreeSelect}
          onMenu={onTreeMenu}
        />
      </div>

      {menu && (
        <div
          className="ctx-overlay"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
        >
          <div className="ctx-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
            <div className="ctx-title mono" title={menu.entry.path}>{menu.entry.name}</div>
            <button
              className="ctx-item"
              onClick={() => {
                setDval(menu.entry.name);
                setDialog({ kind: 'rename', path: menu.entry.path });
                setMenu(null);
              }}
            >Rename</button>
            {!menu.entry.is_dir && (
              <a
                className="ctx-item"
                href={`/api/fs/download?path=${encodeURIComponent(menu.entry.path)}`}
                onClick={() => setMenu(null)}
              >Download</a>
            )}
            <button
              className="ctx-item danger"
              onClick={() => { setDialog({ kind: 'delete', path: menu.entry.path }); setMenu(null); }}
            >Delete</button>
          </div>
        </div>
      )}

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
          {dialog.kind === 'rename'
            ? <p className="dim">Renaming <code>{baseName(dialog.path || '')}</code></p>
            : <p className="dim">In <code>{contextDir || '(root)'}</code></p>}
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
