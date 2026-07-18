import { type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';

/** Shared CodeMirror base extensions for both the Diffs merge editor and the
 * Files editor. `onSave` is bound to Mod-s; `wrap` toggles line wrapping (off =
 * long lines scroll horizontally, the mobile-friendly default for code). */
export function baseExtensions({ onSave, wrap }: { onSave: () => void; wrap: boolean }): Extension[] {
  const ext: Extension[] = [
    lineNumbers(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
