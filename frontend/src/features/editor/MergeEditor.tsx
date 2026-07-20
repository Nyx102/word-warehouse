import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  MergeView,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from '@codemirror/merge';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { toast } from '@/components/Toasts';
import { useMediaQuery } from '@/lib/util';
import { useSettings } from '@/context/settings';
import { applyKeymap, baseExtensions, flashLine, languageForPath, wireVimModeIndicator } from './cm';
import { setVimMode } from './vimModeStore';
import { ReadOnlyEditor } from './ReadOnlyEditor';
import type { FileFull, GitFileResponse, RepoName } from '@/lib/types';

interface Loaded {
  key: number;                 // bumps per (re)load -> editor rebuild
  original: string;            // HEAD content ('' when untracked)
  content: string;             // working copy at load time
  fallbackDiff: string | null; // non-null -> read-only diff-text mode
  fallbackReason: string | null;
}

/** HEAD-vs-worktree editor hosted by DiffBuffer.
 * Desktop (>=1024px): two-pane MergeView, HEAD read-only on the left,
 * working copy editable on the right, per-chunk revert arrows.
 * Mobile: single editable editor with a unified merge view and per-chunk
 * accept/reject controls.
 *
 * `path` is repo-relative; both the git endpoints and /api/file take (repo,
 * path) and resolve it under that repo's root, so any file in the repo's git
 * status is loadable/editable (including code at the project root). */
export function MergeEditor({ repo, path, status, gotoLine, active, onChanged, onClose }: {
  repo: RepoName;
  path: string;
  status: string;
  gotoLine?: number | null;
  active?: boolean; // is this the visible buffer? drives modeline vim-mode + autofocus
  onChanged: () => void;
  onClose: () => void;
}) {
  const untracked = status.trim() === '??';
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { keymap: keymapMode } = useSettings();
  const keymapRef = useRef(keymapMode);
  keymapRef.current = keymapMode;
  const activeRef = useRef(active);
  activeRef.current = active;
  const vimUnsubRef = useRef<(() => void) | null>(null);

  const [file, setFile] = useState<Loaded | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{
    getDoc: () => string;
    goPrev: () => void; // jump to previous changed chunk (no focus: keeps the
    goNext: () => void; // mobile keyboard closed while stepping through diffs)
    views: EditorView[]; // every pane, for live keymap reconfiguration
    destroy: () => void;
  } | null>(null);
  const fileRef = useRef<Loaded | null>(null);
  fileRef.current = file;
  const savedRef = useRef('');            // last loaded/saved content
  const shaRef = useRef<string | null>(null);
  const lastDocRef = useRef<string | null>(null); // survives editor rebuilds
  const keyRef = useRef(0);

  const load = useCallback(async () => {
    setFile(null);
    setLoadErr(null);
    setDirty(false);
    setConflict(false);
    lastDocRef.current = null;
    let original = '';
    try {
      const g = await api<GitFileResponse>(
        `/api/git/file?repo=${repo}&path=${encodeURIComponent(path)}&rev=HEAD`,
        { silent: true },
      );
      original = g.exists ? (g.content ?? '') : '';
    } catch {
      original = ''; // untracked / no HEAD version -> everything reads as added
    }
    try {
      const f = await api<FileFull>(
        `/api/file?repo=${repo}&path=${encodeURIComponent(path)}&full=1`,
        { silent: true },
      );
      savedRef.current = f.content;
      shaRef.current = f.sha256;
      setFile({
        key: ++keyRef.current,
        original,
        content: f.content,
        fallbackDiff: null,
        fallbackReason: null,
      });
    } catch (e) {
      const reason = e instanceof ApiError
        ? (e.status === 413
          ? 'File is too large to edit here—showing the diff read-only.'
          : e.message + '—showing the diff read-only.')
        : 'Failed to load file—showing the diff read-only.';
      try {
        const d = await api<{ diff: string }>(
          `/api/git/diff?repo=${repo}&path=${encodeURIComponent(path)}`,
          { silent: true },
        );
        setFile({
          key: ++keyRef.current,
          original,
          content: '',
          fallbackDiff: d.diff || '',
          fallbackReason: reason,
        });
      } catch {
        setLoadErr(reason);
      }
    }
  }, [repo, path]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    const f = fileRef.current;
    const v = viewRef.current;
    if (!f || f.fallbackDiff != null || !v) return;
    const content = v.getDoc();
    setSaving(true);
    try {
      const body: { repo: RepoName; path: string; content: string; expect_sha256?: string } = {
        repo,
        path,
        content,
      };
      if (shaRef.current) body.expect_sha256 = shaRef.current;
      const r = await api<{ ok: boolean; sha256: string }>('/api/file', { method: 'PUT', body });
      shaRef.current = r.sha256;
      savedRef.current = content;
      setDirty(false);
      setConflict(false);
      toast('Saved ' + path, 'ok');
      onChanged();
    } catch (e) {
      // 409: file changed on disk since we loaded it (toast already shown);
      // surface a reload offer instead of silently clobbering
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setSaving(false);
    }
  }, [repo, path, onChanged]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Wires/unwires the modeline's live vim-state readout against the
  // editable pane (mv.b desktop / the single view on mobile — mv.a is
  // read-only and can never be in insert mode). Same guard as FileEditor:
  // only the instance holding the wiring may clear the (global) store.
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

  // Build / rebuild the editor when the file loads or the layout mode flips
  useEffect(() => {
    if (!file || file.fallbackDiff != null || !hostRef.current) return;
    const parent = hostRef.current;
    parent.replaceChildren();
    const doc = lastDocRef.current ?? file.content; // keep edits across desktop/mobile flips
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        const d = u.state.doc.toString();
        lastDocRef.current = d;
        setDirty(d !== savedRef.current);
      }
    });
    // Desktop wraps to fit the pane; mobile leaves long lines intact so the
    // diff scrolls horizontally to reveal the full line.
    const base: Extension[] = baseExtensions({
      onSave: () => { void saveRef.current(); },
      wrap: isDesktop,
      keymap: keymapRef.current,
    });
    const lang = languageForPath(path);
    if (lang) base.push(lang);

    if (isDesktop) {
      const mv = new MergeView({
        parent,
        a: {
          // readOnly (not editable:false) keeps the HEAD side focusable, so
          // the cursor and every motion work there too — you just can't type.
          doc: file.original,
          extensions: [...base, EditorState.readOnly.of(true)],
        },
        b: { doc, extensions: [...base, listener] },
        revertControls: 'a-to-b',
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
      viewRef.current = {
        getDoc: () => mv.b.state.doc.toString(),
        goPrev: () => { goToPreviousChunk(mv.b); },
        goNext: () => { goToNextChunk(mv.b); },
        views: [mv.a, mv.b],
        destroy: () => mv.destroy(),
      };
    } else {
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [
            ...base,
            listener,
            unifiedMergeView({
              original: file.original,
              mergeControls: true,
              // Fold away unchanged runs so the diffs are on screen at once
              // instead of buried in a full-file scroll (mobile's main pain).
              collapseUnchanged: { margin: 3, minSize: 4 },
            }),
          ],
        }),
      });
      viewRef.current = {
        getDoc: () => view.state.doc.toString(),
        goPrev: () => { goToPreviousChunk(view); },
        goNext: () => { goToNextChunk(view); },
        views: [view],
        destroy: () => view.destroy(),
      };
    }
    // The editable pane is always last: [a, b] on desktop, [view] on mobile
    const target = viewRef.current.views[viewRef.current.views.length - 1];
    rewireVimMode(target);
    if (activeRef.current) target.focus();
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
      rewireVimMode(null);
    };
  }, [file, isDesktop, path, rewireVimMode]);

  // Buffer switched to active (tab click) without a rebuild -> grab focus
  // and resync the modeline, same as FileEditor
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const target = v.views[v.views.length - 1];
    if (active) target.focus();
    rewireVimMode(target);
  }, [active, rewireVimMode]);

  // Live keymap switch on every pane; rebuilds pick the mode up via keymapRef
  useEffect(() => {
    viewRef.current?.views.forEach((v) => applyKeymap(v, keymapMode));
    const v = viewRef.current;
    if (v) rewireVimMode(v.views[v.views.length - 1]);
  }, [keymapMode, rewireVimMode]);

  // Scroll to and briefly flash the requested line (e.g. a Magit hunk
  // visit) — same selection-based highlight as any other jump-to-line in
  // this app, just cleared afterward instead of left stuck. Runs after the
  // view (re)builds and again whenever a new target line lands on the same
  // open diff.
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !gotoLine || gotoLine < 1) return;
    // Desktop pairs [HEAD (read-only), working copy]; the target line is
    // against the working copy, same side the mobile unified view edits.
    const target = v.views[v.views.length - 1];
    if (gotoLine > target.state.doc.lines) return;
    flashLine(target, target.state.doc.line(gotoLine).from);
  }, [gotoLine, file, isDesktop]);

  const doRevert = useCallback(async () => {
    setConfirmRevert(false);
    try {
      await api<{ ok: boolean }>('/api/git/revert', { method: 'POST', body: { repo, path } });
      toast('Reverted ' + path, 'ok');
      onChanged();
      await load();
    } catch {
      // 409 untracked-refusal (or other): the server's message was toasted
    }
  }, [repo, path, onChanged, load]);

  const editable = !!file && file.fallbackDiff == null;

  return (
    <div className="merge-editor">
      <div className="editor-toolbar">
        <span className="editor-path mono" title={path}>{path}</span>
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        <span className="toolbar-spacer" />
        {!isDesktop && editable && (
          <span className="chunk-nav" role="group" aria-label="Jump between changes">
            <button
              className="btn btn-sm"
              onClick={() => viewRef.current?.goPrev()}
              title="Previous change"
              aria-label="Previous change"
            >↑</button>
            <button
              className="btn btn-sm"
              onClick={() => viewRef.current?.goNext()}
              title="Next change"
              aria-label="Next change"
            >↓</button>
          </span>
        )}
        <button
          className="btn btn-sm primary"
          onClick={() => void save()}
          disabled={!editable || saving || !dirty}
          title="Save (Ctrl/Cmd+S)"
        >{saving ? 'Saving…' : 'Save'}</button>
        <button
          className="btn btn-sm"
          onClick={() => setConfirmRevert(true)}
          disabled={untracked || !file}
          title={untracked ? 'Untracked file—nothing in git to revert to' : 'Revert file to HEAD'}
        >Revert</button>
        <button className="btn btn-sm" onClick={onClose} title="Close editor">Close</button>
      </div>
      {conflict && (
        <div className="conflict-bar">
          <span>File changed on disk since it was loaded here.</span>
          <button className="btn btn-sm" onClick={() => void load()}>Reload (discard my edits)</button>
        </div>
      )}
      {loadErr && <div className="empty">{loadErr}</div>}
      {!file && !loadErr && <div className="empty">Loading…</div>}
      {file?.fallbackDiff != null && (
        <div className="fallback-diff">
          <div className="fallback-note">{file.fallbackReason}</div>
          {file.fallbackDiff.trim()
            ? <ReadOnlyEditor text={file.fallbackDiff} diff active={active} />
            : <div className="empty">No diff.</div>}
        </div>
      )}
      <div className={'merge-host' + (editable ? '' : ' hidden')} ref={hostRef} />
      {confirmRevert && (
        <Modal
          title="Revert file"
          onClose={() => setConfirmRevert(false)}
          footer={(
            <>
              <button className="btn" onClick={() => setConfirmRevert(false)}>Cancel</button>
              <button className="btn danger" onClick={() => void doRevert()}>Revert</button>
            </>
          )}
        >
          <p>
            Discard working changes to <code>{path}</code> and restore the committed version?
          </p>
        </Modal>
      )}
    </div>
  );
}
