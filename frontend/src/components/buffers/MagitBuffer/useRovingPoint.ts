import { useEffect, useRef, useState } from 'react';
import type { Row } from './types';

/** Roving-point cursor over the flat row list: tracks the pointed row by key,
 * keeps it scrolled into view, and moves the point by row deltas. The key
 * handlers that act on the point (stage/unstage/visit/expand) stay in
 * MagitBuffer since they're wired to git mutations and the commit box; this
 * owns only the cursor itself. */
export function useRovingPoint(rows: Row[]) {
  const [pointKey, setPointKey] = useState<string | null>(null);
  const lastIdxRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());

  // pointKey stays null (nothing highlighted) until the user actually clicks a
  // row or presses a nav key. A fallback-to-row-0 default read as "one row is
  // randomly stuck selected" before any interaction happened.
  const foundIdx = pointKey === null ? -1 : rows.findIndex((r) => r.key === pointKey);
  const pointIndex = pointKey === null || rows.length === 0 ? -1
    : foundIdx === -1 ? Math.min(lastIdxRef.current, rows.length - 1) : foundIdx;
  if (pointIndex >= 0) lastIdxRef.current = pointIndex;
  const pointRow = pointIndex >= 0 ? rows[pointIndex] : null;

  useEffect(() => {
    if (pointKey) rowEls.current.get(pointKey)?.scrollIntoView({ block: 'nearest' });
  }, [pointKey]);

  const setRowEl = (key: string) => (el: HTMLDivElement | null) => {
    if (el) rowEls.current.set(key, el);
    else rowEls.current.delete(key);
  };
  const focusSelf = () => containerRef.current?.focus();

  const move = (delta: number) => {
    if (!rows.length) return;
    const next = pointIndex < 0
      ? (delta > 0 ? 0 : rows.length - 1)
      : Math.max(0, Math.min(rows.length - 1, pointIndex + delta));
    setPointKey(rows[next].key);
  };

  return { pointRow, setPointKey, move, setRowEl, focusSelf, containerRef };
}
