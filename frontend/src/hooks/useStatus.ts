import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { StatusInfo } from '../types';

/** Poll /api/status every 10s; pauses while the browser tab is hidden. */
export function useStatus(): { status: StatusInfo | null; refresh: () => void } {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const timerRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      setStatus(await api<StatusInfo>('/api/status', { silent: true }));
    } catch {
      /* backend down; retry next tick */
    }
  }, []);

  useEffect(() => {
    const stop = () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    const start = () => {
      stop();
      void poll();
      timerRef.current = window.setInterval(() => { void poll(); }, 10000);
    };
    const onVis = () => { if (document.hidden) stop(); else start(); };
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [poll]);

  const refresh = useCallback(() => { void poll(); }, [poll]);
  return { status, refresh };
}
