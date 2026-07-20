import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { useSettings } from '@/context/settings';

/** Keyboard scrolling for read-only content that isn't line-structured text
 * (rendered markdown, the alignment matrix) — so there's no text cursor, but
 * the same keys still move you through it. Mirrors the CodeMirror viewer's
 * feel: arrows / PageUp-Down / Home-End always work; j/k/h/l and Ctrl-d/u/f/b
 * only in vim keymap, matching what those keys do in an editable buffer.
 *
 * Spread the result on the scroll container; it grabs focus whenever its
 * buffer becomes active (buffers stay mounted across tab switches, so without
 * this the first keypress after a switch would go nowhere). Keys typed in a
 * form control inside the container are left alone. */
export function useKeyboardScroll(active: boolean) {
  const { keymap } = useSettings();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (active) ref.current?.focus({ preventScroll: true }); }, [active]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const el = ref.current;
    if (!el) return;
    const vim = keymap === 'vim';
    const page = Math.max(40, el.clientHeight - 40);
    const step = 48;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case 'ArrowDown': dy = step; break;
      case 'ArrowUp': dy = -step; break;
      case 'ArrowRight': dx = step; break;
      case 'ArrowLeft': dx = -step; break;
      case 'PageDown': dy = page; break;
      case 'PageUp': dy = -page; break;
      case ' ': dy = e.shiftKey ? -page : page; break;
      case 'Home': e.preventDefault(); el.scrollTo({ top: 0 }); return;
      case 'End': e.preventDefault(); el.scrollTo({ top: el.scrollHeight }); return;
      case 'j': if (vim && !e.ctrlKey) dy = step; break;
      case 'k': if (vim && !e.ctrlKey) dy = -step; break;
      case 'l': if (vim && !e.ctrlKey) dx = step; break;
      case 'h': if (vim && !e.ctrlKey) dx = -step; break;
      case 'd': if (e.ctrlKey) dy = page / 2; break;
      case 'u': if (e.ctrlKey) dy = -page / 2; break;
      case 'f': if (e.ctrlKey) dy = page; break;
      case 'b': if (e.ctrlKey) dy = -page; break;
      case 'G': if (vim) { e.preventDefault(); el.scrollTo({ top: el.scrollHeight }); return; } break;
      default: return;
    }
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    el.scrollBy({ top: dy, left: dx });
  }, [keymap]);

  return { ref, onKeyDown, tabIndex: 0 as const };
}
