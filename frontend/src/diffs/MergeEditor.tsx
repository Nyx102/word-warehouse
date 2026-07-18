import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  MergeView,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
} from '@codemirror/merge';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toasts';
import { useMediaQuery } from '../util';
import { baseExtensions, languageForPath } from '../editor/cm';
import type { FileFull, GitFileResponse, RepoName } from '../types';

interface Loaded {
  key: number;                 // bumps per (re)load -> editor rebuild
  original: string;            // HEAD content ('' when untracked)
  content: string;             // working copy at load time
  fallbackDiff: string | null; // non-null -> read-only diff-text mode
  fallbackReason: string | null;
}

/** Simple colorized unified-diff text (read-only fallback for >2MB files). */
function DiffText({ text }: { text: string }) {
  if (!text.trim()) return <div className="empty">No diff.</div>;
  return (
    <div className="diff-text mono">
      {text.split('\n').map((line, i) => {
        let cls = 'ctx';
        if (/^(diff --git|index |new file|deleted file|similarity|rename)/.test(line)) cls = 'meta';
        else if (line.startsWith('+++') || line.startsWith('---')) cls = 'file';
        else if (line.startsWith('@@')) cls = 'hunk';
        else if (line.startsWith('+')) cls = 'add';
        else if (line.startsWith('-')) cls = 'del';
        return <div key={i} className={'dl ' + cls}>{line || ' '}</div>;
      })}
    </div>
  );
}

/** File editor for the Diffs tab.
 * Desktop (>=1024px): two-pane MergeView, HEAD read-only on the left,
 * working copy editable on the right, per-chunk revert arrows.
 * Mobile: single editable editor with a unified merge view and per-chunk
 * accept/reject controls.
 *
 * `path` is repo-relative; both the git endpoints and /api/file take (repo,
 * path) and resolve it under that repo's root, so any file in the repo's git
 * status is loadable/editable (including code at the project root). */
export function MergeEditor({ repo, path, status, onChanged, onClose }: {
  repo: RepoName;
  path: string;
  status: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const untracked = status.trim() === '??';
  const isDesktop = useMediaQuery('(min-width: 1024px)');

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
          ? 'File is too large to edit here — showing the diff read-only.'
          : e.message + ' — showing the diff read-only.')
        : 'Failed to load file — showing the diff read-only.';
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
      // surface a reload offer instead of silently clobbering.
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setSaving(false);
    }
  }, [repo, path, onChanged]);
  const saveRef = useRef(save);
  saveRef.current = save;

  // Build / rebuild the editor when the file loads or the layout mode flips.
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
    });
    const lang = languageForPath(path);
    if (lang) base.push(lang);

    if (isDesktop) {
      const mv = new MergeView({
        parent,
        a: {
          doc: file.original,
          extensions: [...base, EditorState.readOnly.of(true), EditorView.editable.of(false)],
        },
        b: { doc, extensions: [...base, listener] },
        revertControls: 'a-to-b',
        collapseUnchanged: { margin: 3, minSize: 4 },
      });
      viewRef.current = {
        getDoc: () => mv.b.state.doc.toString(),
        goPrev: () => { goToPreviousChunk(mv.b); },
        goNext: () => { goToNextChunk(mv.b); },
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
        destroy: () => view.destroy(),
      };
    }
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [file, isDesktop, path]);

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
          title={untracked ? 'Untracked file — nothing in git to revert to' : 'Revert file to HEAD'}
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
          <DiffText text={file.fallbackDiff} />
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
