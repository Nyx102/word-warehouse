import { Compartment, Prec, type Extension } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  keymap,
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
import { EmacsHandler, emacs } from '@replit/codemirror-emacs';
import { doomTheme } from './theme';
import type { KeymapName } from '../app/settings';

/* Both modal plugins process keys in a view-plugin keydown handler and their
 * command tables are module-level singletons, so per-editor save actions are
 * routed through this map (vim :w and emacs C-x C-s land here) */
const saveHooks = new WeakMap<EditorView, () => void>();

let modalSaveWired = false;
function wireModalSave() {
  if (modalSaveWired) return;
  modalSaveWired = true;
  Vim.defineEx('write', 'w', (cm: { cm6: EditorView }) => {
    saveHooks.get(cm.cm6)?.();
  });
  EmacsHandler.bindKey('C-x C-s', (view: EditorView) => {
    saveHooks.get(view)?.();
  });
}

const keymapCompartment = new Compartment();
const themeCompartment = new Compartment();

function modalExt(mode: KeymapName): Extension {
  if (mode === 'vim') return vim();
  if (mode === 'emacs') return emacs();
  return [];
}

const isMac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/* Mod-s must save even in emacs mode, whose plugin sees keydown ahead of every
 * keymap (C-s there is search). A raw handler at the highest precedence is the
 * only slot that reliably wins in all three modes. */
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
 * is bound to Mod-s (plus vim :w and emacs C-x C-s); `wrap` toggles line
 * wrapping (off = long lines scroll horizontally, the mobile-friendly default
 * for code); `keymap` picks the modal editing mode. */
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
