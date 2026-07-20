import { useLayoutEffect, type RefObject } from 'react';

/** Grow a textarea from one row up to maxRows, then scroll. Recomputes whenever
 * value changes; the height math reads the element's own computed line-height,
 * padding, and border, so it works for any field regardless of its font size. */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxRows: number,
) {
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const cs = window.getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const max = Math.round(lh * maxRows + pad + border);
    // Collapse first so scrollHeight reports the real content height
    ta.style.height = 'auto';
    const want = ta.scrollHeight + border;
    ta.style.height = Math.min(Math.max(want, lh + pad + border), max) + 'px';
    ta.style.overflowY = want > max ? 'auto' : 'hidden';
  }, [ref, value, maxRows]);
}
