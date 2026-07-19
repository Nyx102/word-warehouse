import { useSyncExternalStore } from 'react';

export interface VimModeState { mode: string; subMode?: string; }

/* Same external-store trick as cursorStore: only the modeline re-renders
 * when vim's modal state (normal/insert/visual) changes. Null whenever the
 * active buffer isn't in vim mode. */
let state: VimModeState | null = null;
const listeners = new Set<() => void>();

export function setVimMode(next: VimModeState | null): void {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useVimMode(): VimModeState | null {
  return useSyncExternalStore(subscribe, () => state);
}

export function formatVimMode(v: VimModeState): string {
  if (v.mode === 'visual') {
    if (v.subMode === 'linewise') return 'VISUAL LINE';
    if (v.subMode === 'blockwise') return 'VISUAL BLOCK';
    return 'VISUAL';
  }
  return v.mode.toUpperCase();
}

/** Single-letter badge glyph (N/I/V/R), airline/lightline-style. */
export function vimModeLetter(v: VimModeState): string {
  return v.mode.charAt(0).toUpperCase();
}
