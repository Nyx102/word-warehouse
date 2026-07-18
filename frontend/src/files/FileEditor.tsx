import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { api, ApiError } from '../api';
import { toast } from '../components/Toasts';
import { useMediaQuery } from '../util';
import { baseExtensions, languageForPath } from '../editor/cm';
import type { FileFull } from '../types';

/** Plain editable file editor for the Files tab. Loads/saves via the same
 * (repo=corpus) /api/file contract the Diffs editor uses (sha256 optimistic
 * concurrency), with an optional jump-to-line for flag/search deep-links. */
export function FileEditor({ path, gotoLine, onSaved, onClose }: {
  path: string;                  // project-relative (under FS_ROOT / ROOT)
  gotoLine?: number | null;      // 1-based line to scroll to + select on open
  onSaved?: () => void;
  onClose: () => void;
}) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [content, setContent] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedRef = useRef('');
  const shaRef = useRef<string | null>(null);
  const dlHref = `/api/fs/download?path=${encodeURIComponent(path)}`;

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
        ? (e.status === 413 ? 'File is too large to edit here — download it instead.' : e.message)
        : 'Failed to load file.');
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

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

  // Build / rebuild the editor when the file loads or the layout mode flips.
  useEffect(() => {
    if (content == null || !hostRef.current) return;
    const parent = hostRef.current;
    parent.replaceChildren();
    const ext = baseExtensions({ onSave: () => { void saveRef.current(); }, wrap: isDesktop });
    const lang = languageForPath(path);
    if (lang) ext.push(lang);
    ext.push(EditorView.updateListener.of((u) => {
      if (u.docChanged) setDirty(u.state.doc.toString() !== savedRef.current);
    }));
    const view = new EditorView({ parent, state: EditorState.create({ doc: content, extensions: ext }) });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [content, isDesktop, path]);

  // Scroll to (and select) the requested line — runs after the view is built
  // and again whenever a new deep-link target lands on the same open file.
  useEffect(() => {
    const v = viewRef.current;
    if (!v || content == null || !gotoLine || gotoLine < 1 || gotoLine > v.state.doc.lines) return;
    const line = v.state.doc.line(gotoLine);
    v.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [gotoLine, content]);

  return (
    <div className="merge-editor">
      <div className="editor-toolbar">
        <span className="editor-path mono" title={path}>{path}</span>
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="toolbar-spacer" />
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
