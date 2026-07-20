import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/Toasts';
import { useMediaQuery } from '@/lib/util';
import { useSettings } from '@/context/settings';
import { applyKeymap, baseExtensions, cursorFromState, flashLine, languageForPath, wireVimModeIndicator } from '@/features/editor/cm';
import { setCursorPos } from '@/features/editor/cursorStore';
import { setVimMode } from '@/features/editor/vimModeStore';
import type { FileFull } from '@/lib/types';

/** Breadcrumb path: the directory part shrinks with an ellipsis, the file
 * name always stays visible. */
function Crumbs({ path }: { path: string }) {
  const cut = path.lastIndexOf('/');
  const dir = cut === -1 ? '' : path.slice(0, cut + 1);
  const base = cut === -1 ? path : path.slice(cut + 1);
  return (
    <span className="fb-crumbs mono" title={path}>
      {dir && <span className="crumb-dir">{dir}</span>}
      <span className="crumb-file">{base}</span>
    </span>
  );
}

/** Plain editable file editor for file buffers. Loads/saves via the same
 * (repo=corpus) /api/file contract the Diffs editor uses (sha256 optimistic
 * concurrency), with an optional jump-to-line for flag/search deep-links. */
export function FileEditor({ path, gotoLine, active, onSaved, onClose, onDirtyChange, onHistory }: {
  path: string;                  // project-relative (under FS_ROOT / ROOT)
  gotoLine?: number | null;      // 1-based line to scroll to + select on open
  active?: boolean;               // is this the visible buffer? drives the modeline cursor readout
  onSaved?: () => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void; // drives the buffer tab dirty dot
  onHistory?: () => void;        // History toolbar button -> log buffer
}) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { keymap: keymapMode } = useSettings();
  const keymapRef = useRef(keymapMode);
  keymapRef.current = keymapMode;
  const activeRef = useRef(active);
  activeRef.current = active;
  const [content, setContent] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [wrapOverride, setWrapOverride] = useState<boolean | null>(null);
  const wrap = wrapOverride ?? isDesktop;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef('');
  const shaRef = useRef<string | null>(null);
  const vimUnsubRef = useRef<(() => void) | null>(null);
  const dlHref = `/api/fs/download?path=${encodeURIComponent(path)}`;

  // Wires/unwires the modeline's live vim-state readout. Only the instance
  // that actually holds the wiring is allowed to clear the (global) store,
  // so an inactive/closing buffer never clobbers a different active one's
  // display.
  const rewireVimMode = useCallback((view: EditorView | null) => {
    const hadWiring = vimUnsubRef.current !== null;
    vimUnsubRef.current?.();
    vimUnsubRef.current = null;
    if (view && activeRef.current && keymapRef.current === 'vim') {
      vimUnsubRef.current = wireVimModeIndicator(view, setVimMode);
    } else if (hadWiring) {
      setVimMode(null);
    }
  }, []);

  const load = useCallback(async () => {
    setContent(null); setLoadErr(null); setDirty(false); setConflict(false);
    try {
      const f = await api<FileFull>(
        `/api/file?repo=corpus&path=${encodeURIComponent(path)}&full=1`, { silent: true });
      savedRef.current = f.content;
      shaRef.current = f.sha256;
      setContent(f.content);
    } catch (e) {
      setLoadErr(e instanceof ApiError
        ? (e.status === 413 ? 'File is too large to edit here—download it instead.' : e.message)
        : 'Failed to load file.');
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const save = useCallback(async () => {
    const v = viewRef.current;
    if (!v) return;
    const text = v.state.doc.toString();
    setSaving(true);
    try {
      const body: { repo: string; path: string; content: string; expect_sha256?: string } = {
        repo: 'corpus', path, content: text,
      };
      if (shaRef.current) body.expect_sha256 = shaRef.current;
      const r = await api<{ ok: boolean; sha256: string }>('/api/file', { method: 'PUT', body });
      shaRef.current = r.sha256;
      savedRef.current = text;
      setDirty(false); setConflict(false);
      toast('Saved ' + path, 'ok');
      onSaved?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setSaving(false);
    }
  }, [path, onSaved]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Build / rebuild the editor when the file loads or wrap mode flips
  useEffect(() => {
    if (content == null || !hostRef.current) return;
    const parent = hostRef.current;
    parent.replaceChildren();
    const ext = baseExtensions({
      onSave: () => { void saveRef.current(); },
      wrap,
      keymap: keymapRef.current,
    });
    const lang = languageForPath(path);
    if (lang) ext.push(lang);
    ext.push(EditorView.updateListener.of((u) => {
      if (u.docChanged) setDirty(u.state.doc.toString() !== savedRef.current);
      if (activeRef.current && (u.docChanged || u.selectionSet)) setCursorPos(cursorFromState(u.state));
    }));
    const view = new EditorView({ parent, state: EditorState.create({ doc: content, extensions: ext }) });
    viewRef.current = view;
    if (activeRef.current) {
      setCursorPos(cursorFromState(view.state));
      view.focus();
    }
    rewireVimMode(view);
    return () => { view.destroy(); viewRef.current = null; rewireVimMode(null); };
  }, [content, wrap, path, rewireVimMode]);

  // Buffer switched to active (tab click) without a rebuild -> grab focus
  // and resync the modeline
  useEffect(() => {
    if (active && viewRef.current) {
      setCursorPos(cursorFromState(viewRef.current.state));
      viewRef.current.focus();
    }
    rewireVimMode(viewRef.current);
  }, [active, rewireVimMode]);

  // Live keymap switch; rebuilds pick the current mode up via keymapRef
  useEffect(() => {
    if (viewRef.current) applyKeymap(viewRef.current, keymapMode);
    rewireVimMode(viewRef.current);
  }, [keymapMode, rewireVimMode]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v || content == null || !gotoLine || gotoLine < 1 || gotoLine > v.state.doc.lines) return;
    flashLine(v, v.state.doc.line(gotoLine).from);
  }, [gotoLine, content]);

  return (
    <div className="merge-editor">
      <div className="editor-toolbar">
        <Crumbs path={path} />
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="toolbar-spacer" />
        <button
          className={'btn btn-sm' + (wrap ? ' toggled' : '')}
          onClick={() => setWrapOverride(!wrap)}
          title="Toggle line wrapping"
        >Wrap</button>
        {onHistory && (
          <button className="btn btn-sm" onClick={onHistory} title="File history">History</button>
        )}
        <a className="btn btn-sm" href={dlHref} title="Download this file">Download</a>
        <button
          className="btn btn-sm primary"
          onClick={() => void save()}
          disabled={content == null || saving || !dirty}
          title="Save (Ctrl/Cmd+S)"
        >{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-sm" onClick={onClose} title="Close editor">Close</button>
      </div>
      {conflict && (
        <div className="conflict-bar">
          <span>File changed on disk since it was loaded here.</span>
          <button className="btn btn-sm" onClick={() => void load()}>Reload (discard my edits)</button>
        </div>
      )}
      {loadErr && (
        <div className="empty pad">
          {loadErr} <a href={dlHref}>Download</a>
        </div>
      )}
      {content == null && !loadErr && <div className="empty">Loading…</div>}
      <div className={'merge-host' + (content != null ? '' : ' hidden')} ref={hostRef} />
    </div>
  );
}
