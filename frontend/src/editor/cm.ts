import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  RectangleMarker,
  ViewPlugin,
  type ViewUpdate,
  drawSelection,
  highlightActiveLine,
  keymap,
  layer,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';
import { Vim, getCM, vim } from '@replit/codemirror-vim';
import { doomTheme } from './theme';
import type { CursorPos } from './cursorStore';
import type { KeymapName } from '../app/settings';

/** 1-based line/col of the primary cursor, for the modeline readout. Shared by
 * the editable file editor and the read-only viewer so both report position
 * the same way. */
export function cursorFromState(state: EditorState): CursorPos {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, col: head - line.from + 1 };
}

/* The vim modal plugin processes keys in a view-plugin keydown handler and
 * its command table is a module-level singleton, so per-editor save actions
 * are routed through this map (vim :w lands here) */
const saveHooks = new WeakMap<EditorView, () => void>();

let modalSaveWired = false;
function wireModalSave() {
  if (modalSaveWired) return;
  modalSaveWired = true;
  Vim.defineEx('write', 'w', (cm: { cm6: EditorView }) => {
    saveHooks.get(cm.cm6)?.();
  });
}

const keymapCompartment = new Compartment();
const themeCompartment = new Compartment();

/* Flash-line: an overlay rectangle painted the same way CodeMirror's own
 * selection layer is (RectangleMarker, same as drawSelection()) — visually
 * as strong as a real selection, but it's cosmetic only. Unlike an actual
 * selection, it can never collapse/hijack the cursor when the user moves or
 * types, because state.selection is never touched. */
const setFlashRange = StateEffect.define<{ from: number; to: number } | null>();

const flashRangeField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFlashRange)) value = e.value;
    if (value && tr.docChanged) {
      value = { from: tr.changes.mapPos(value.from), to: tr.changes.mapPos(value.to) };
    }
    return value;
  },
});

const flashLayer = layer({
  above: false,
  class: 'cm-flashLayer',
  update: (update) => update.state.field(flashRangeField) !== update.startState.field(flashRangeField)
    || update.docChanged || update.viewportChanged,
  markers: (view) => {
    const range = view.state.field(flashRangeField, false);
    if (!range) return [];
    return RectangleMarker.forRange(view, 'cm-flash-rect', EditorSelection.range(range.from, range.to));
  },
});

export function flashLineExt(): Extension {
  return [flashRangeField, flashLayer];
}

/** Scroll to a line, place the real cursor there (so moving afterward
 * continues from the flash target instead of wherever it happened to be
 * before), and briefly highlight it. The highlight is a cosmetic overlay,
 * not a spanning selection, so it can't hijack the next arrow key into
 * collapsing a range — but the cursor placement itself is real and stays
 * put after the flash fades. `ms` must match the `.cm-flash-rect` fade
 * duration (editor.css) so removal lines up with the animation finishing
 * instead of an abrupt cut. */
export function flashLine(view: EditorView, pos: number, ms = 1200): void {
  const line = view.state.doc.lineAt(pos);
  view.dispatch({
    selection: { anchor: line.from },
    effects: [
      EditorView.scrollIntoView(line.from, { y: 'center' }),
      setFlashRange.of({ from: line.from, to: line.to }),
    ],
  });
  window.setTimeout(() => {
    view.dispatch({ effects: setFlashRange.of(null) });
  }, ms);
}

function modalExt(mode: KeymapName): Extension {
  if (mode === 'vim') return vim();
  return [];
}

const isMac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/* Mod-s must save even in vim mode, whose plugin sees keydown ahead of every
 * keymap (C-s there is search). A raw handler at the highest precedence is the
 * only slot that reliably wins in both modes. */
function saveKeyExt(onSave: () => void): Extension {
  return Prec.highest(EditorView.domEventHandlers({
    keydown(e) {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        onSave();
        return true;
      }
      return false;
    },
  }));
}

/** Shared CodeMirror base extensions for the Diffs and Files editors. `onSave`
 * is bound to Mod-s (plus vim :w); `wrap` toggles line wrapping (off = long
 * lines scroll horizontally, the mobile-friendly default for code); `keymap`
 * picks the modal editing mode. */
export function baseExtensions({ onSave, wrap, keymap: mode }: {
  onSave: () => void;
  wrap: boolean;
  keymap: KeymapName;
}): Extension[] {
  wireModalSave();
  const ext: Extension[] = [
    saveKeyExt(onSave),
    // CodeMirror mounts same-precedence stylesheets in REVERSE encounter
    // order, so our Prec.highest theme has to be encountered before vim's
    // own (also Prec.highest) fat-cursor theme to win the cascade -> this
    // must stay ahead of keymapCompartment below.
    themeCompartment.of(doomTheme),
    // Modal plugins must precede every other keymap or they never see keys
    keymapCompartment.of(modalExt(mode)),
    ViewPlugin.define((view) => {
      saveHooks.set(view, onSave);
      return {};
    }),
    lineNumbers(),
    highlightActiveLine(),
    drawSelection(),
    flashLineExt(),
    history(),
    highlightSelectionMatches(),
    keymap.of([
      { key: 'Mod-s', run: () => { onSave(); return true; } },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
  ];
  if (wrap) ext.push(EditorView.lineWrapping);
  return ext;
}

/** Switch a live editor's keymap mode without rebuilding it. */
export function applyKeymap(view: EditorView, mode: KeymapName): void {
  view.dispatch({ effects: keymapCompartment.reconfigure(modalExt(mode)) });
}

/** Read-only but fully navigable editor extensions: a real cursor and the
 * same modal keymap the file editor uses (vim motions / normal caret), search,
 * active-line highlight and scrolling — minus the write path (no history, save
 * or indent binding). Edits are blocked by EditorState.readOnly while the view
 * stays focusable, so arrows/j/k/Ctrl-d/Ctrl-u drive a point exactly as they
 * do in an editable buffer. Reconfigure the mode later with applyKeymap (the
 * keymapCompartment is shared with the editable editors). */
export function readOnlyExtensions({ wrap, keymap: mode }: {
  wrap: boolean;
  keymap: KeymapName;
}): Extension[] {
  const ext: Extension[] = [
    EditorState.readOnly.of(true),
    // Same reverse-order-mount reasoning as baseExtensions: our theme must be
    // encountered before vim's own fat-cursor theme to win the cascade.
    themeCompartment.of(doomTheme),
    keymapCompartment.of(modalExt(mode)),
    lineNumbers(),
    highlightActiveLine(),
    drawSelection(),
    flashLineExt(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...searchKeymap]),
  ];
  if (wrap) ext.push(EditorView.lineWrapping);
  return ext;
}

/* Diff colorization for the read-only viewer: line decorations mirroring
 * git/DiffText's lineClass exactly (same +/-/@@/meta buckets, same tokens) so
 * a diff shown in CodeMirror reads identically to the plain-div renderer, just
 * navigable. Only visible lines are decorated (the doc never changes). */
const DIFF_META_RE = /^(diff --git|index |new file|deleted file|old mode|new mode|similarity|dissimilarity|rename|copy (from|to)|Binary files |GIT binary)/;

const diffDeco = {
  add: Decoration.line({ class: 'cm-diff-add' }),
  del: Decoration.line({ class: 'cm-diff-del' }),
  hunk: Decoration.line({ class: 'cm-diff-hunk' }),
  meta: Decoration.line({ class: 'cm-diff-meta' }),
};

function diffDecoForLine(line: string): Decoration | null {
  if (DIFF_META_RE.test(line)) return diffDeco.meta;
  if (line.startsWith('+++') || line.startsWith('---')) return diffDeco.meta;
  if (line.startsWith('@@')) return diffDeco.hunk;
  if (line.startsWith('\\')) return diffDeco.meta;
  if (line.startsWith('+')) return diffDeco.add;
  if (line.startsWith('-')) return diffDeco.del;
  return null;
}

function buildDiffDeco(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      const deco = diffDecoForLine(line.text);
      if (deco) builder.add(line.from, line.from, deco);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Colorize a read-only diff (used with readOnlyExtensions). */
export function diffColorsExt(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDiffDeco(view); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = buildDiffDeco(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Escape hatch: swap the theme extension on a live editor. The doom theme
 * itself never needs this (palette flips are pure CSS). */
export function applyEditorTheme(view: EditorView, theme: Extension): void {
  view.dispatch({ effects: themeCompartment.reconfigure(theme) });
}

/** Subscribe to a vim-mode editor's live modal state (normal/insert/visual)
 * for the modeline. No-op (immediately reports null) outside vim mode.
 * Returns the unsubscribe function. */
export function wireVimModeIndicator(
  view: EditorView,
  onChange: (m: { mode: string; subMode?: string } | null) => void,
): () => void {
  const cm = getCM(view);
  if (!cm) { onChange(null); return () => {}; }
  const handler = (e: { mode: string; subMode?: string }) => onChange({ mode: e.mode, subMode: e.subMode });
  cm.on('vim-mode-change', handler);
  onChange({ mode: 'normal' });
  return () => cm.off('vim-mode-change', handler);
}

/** Language extension chosen from the file extension; null for plaintext. */
export function languageForPath(path: string): Extension | null {
  const p = path.toLowerCase();
  const ext = p.slice(p.lastIndexOf('.') + 1);
  switch (ext) {
    case 'md':
    case 'markdown':
      return markdown();
    case 'py':
      return python();
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: true });
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'json':
    case 'webmanifest':
      return json();
    case 'css':
      return css();
    case 'html':
    case 'htm':
      return html();
    case 'yaml':
    case 'yml':
      return yaml();
    default:
      return null;
  }
}

/** Human-readable language label for the modeline (mirrors languageForPath). */
export function languageLabelForPath(path: string): string {
  const p = path.toLowerCase();
  const ext = p.slice(p.lastIndexOf('.') + 1);
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'Markdown';
    case 'py':
      return 'Python';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'JavaScript';
    case 'jsx':
      return 'JSX';
    case 'ts':
      return 'TypeScript';
    case 'tsx':
      return 'TSX';
    case 'json':
    case 'webmanifest':
      return 'JSON';
    case 'css':
      return 'CSS';
    case 'html':
    case 'htm':
      return 'HTML';
    case 'yaml':
    case 'yml':
      return 'YAML';
    case 'sh':
    case 'bash':
      return 'Shell';
    default:
      return 'Text';
  }
}
