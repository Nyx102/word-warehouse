import { useSyncExternalStore } from 'react';

export interface CursorPos { line: number; col: number; }

/* Module-level store for the active file editor's cursor position, read by
 * the modeline. A React context would re-render the whole tree on every
 * keystroke; this only wakes subscribers (just the modeline). */
let pos: CursorPos | null = null;
const listeners = new Set<() => void>();

export function setCursorPos(next: CursorPos | null): void {
  pos = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useCursorPos(): CursorPos | null {
  return useSyncExternalStore(subscribe, () => pos);
}
