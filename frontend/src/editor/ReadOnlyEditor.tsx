import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useSettings } from '../app/settings';
import {
  applyKeymap,
  cursorFromState,
  diffColorsExt,
  flashLine,
  readOnlyExtensions,
  wireVimModeIndicator,
} from './cm';
import { setCursorPos } from './cursorStore';
import { setVimMode } from './vimModeStore';

export interface ReadOnlyHandle {
  /** Scroll a 1-based line into view; flashes it (like a jump-to-line) unless
   * flash is false, in which case it just parks the cursor there. */
  scrollToLine: (line: number, flash?: boolean) => void;
  view: EditorView | null;
}

/** Read-only but fully navigable CodeMirror viewer. Same cursor, modal keymap
 * (vim motions / normal caret), search and scrolling as the file editor — the
 * text just can't be changed. Used wherever content is shown but not edited
 * (commit patches, oversized-file diffs) so arrows/j/k/Ctrl-d/Ctrl-u move a
 * real point exactly as they do in an editable buffer. Honors the same
 * vim/normal setting and drives the modeline cursor + mode readout while it's
 * the active buffer, same as FileEditor.
 *
 * Not wrapped by default: diffs read better with long lines intact and a
 * horizontal scroll, matching the plain-div renderer they replace. */
export const ReadOnlyEditor = forwardRef<ReadOnlyHandle, {
  text: string;
  diff?: boolean;              // colorize +/-/@@/meta lines
  language?: Extension | null; // syntax highlight (omit for diffs)
  wrap?: boolean;              // default false: long lines scroll horizontally
  active?: boolean;            // is this the visible buffer? drives focus + modeline
  gotoLine?: number | null;    // 1-based line to scroll to + flash on mount
  className?: string;
}>(function ReadOnlyEditor(
  { text, diff, language, wrap = false, active, gotoLine, className },
  ref,
) {
  const { keymap: keymapMode } = useSettings();
  const keymapRef = useRef(keymapMode);
  keymapRef.current = keymapMode;
  const activeRef = useRef(active);
  activeRef.current = active;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimUnsubRef = useRef<(() => void) | null>(null);

  // Same guard as FileEditor: only the instance that holds the wiring may
  // clear the global vim-mode store, so an inactive/closing viewer never
  // clobbers a different active buffer's readout.
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

  useImperativeHandle(ref, () => ({
    scrollToLine: (line: number, flash = true) => {
      const v = viewRef.current;
      if (!v || line < 1 || line > v.state.doc.lines) return;
      const pos = v.state.doc.line(line).from;
      if (flash) {
        flashLine(v, pos);
      } else {
        v.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: 'start' }),
        });
      }
    },
    get view() { return viewRef.current; },
  }), []);

  // Build / rebuild when the content or rendering options change
  useEffect(() => {
    if (!hostRef.current) return;
    const parent = hostRef.current;
    parent.replaceChildren();
    const ext = readOnlyExtensions({ wrap, keymap: keymapRef.current });
    if (diff) ext.push(diffColorsExt());
    if (language) ext.push(language);
    ext.push(EditorView.updateListener.of((u) => {
      if (activeRef.current && u.selectionSet) setCursorPos(cursorFromState(u.state));
    }));
    const view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: ext }) });
    viewRef.current = view;
    if (activeRef.current) {
      setCursorPos(cursorFromState(view.state));
      view.focus();
    }
    rewireVimMode(view);
    return () => { view.destroy(); viewRef.current = null; rewireVimMode(null); };
  }, [text, wrap, diff, language, rewireVimMode]);

  // Buffer switched to active (tab click) without a rebuild -> grab focus and
  // resync the modeline, same as the editors
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

  // Scroll to + flash a deep-linked line once the view exists
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !gotoLine || gotoLine < 1 || gotoLine > v.state.doc.lines) return;
    flashLine(v, v.state.doc.line(gotoLine).from);
  }, [gotoLine, text]);

  return <div className={'ro-editor-host' + (className ? ' ' + className : '')} ref={hostRef} />;
});
