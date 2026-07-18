import { useEffect, useState } from 'react';

/** Collapse whitespace and clip to n chars with an ellipsis. */
export function truncate(s: string, n: number): string {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Seconds -> compact age label (42s / 7m / 3h). */
export function fmtAge(s: number): string {
  const v = Math.max(0, Math.round(s));
  if (v < 120) return v + 's';
  if (v < 7200) return Math.round(v / 60) + 'm';
  return Math.round(v / 3600) + 'h';
}

/** Stable string -> hue (0..359); same subtitle_key gets the same tint. */
export function hashHue(str: string): number {
  let x = 7;
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
  return x % 360;
}

/** Reactive matchMedia hook (used for the desktop/mobile merge editor split). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    mq.addEventListener('change', onChange);
    setMatch(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return match;
}
