import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { flagIdent } from './FlagCard';
import type { ClearedFlag } from './AiDismissedSection';
import type { LintFlag, LintReport, LintScope } from '../types';

export interface LintApi {
  report: LintReport | null;
  loading: boolean;
  rerunning: boolean;
  triaging: boolean;
  busyKeys: Set<string>;
  visibleFiles: { path: string; flags: LintFlag[] }[];
  cleared: ClearedFlag[];
  load: (silent?: boolean) => Promise<void>;
  rerun: () => Promise<void>;
  triageNow: () => Promise<void>;
  isDismissed: (f: LintFlag) => boolean;
  toggleDismiss: (f: LintFlag) => Promise<void>;
  restore: (f: LintFlag) => Promise<void>;
}

/** Lint report state for the Flags sidebar: fetch + reload, optimistic
 * dismiss/undismiss, triage restore, the 10s pending-triage poll, and the
 * visible/AI-cleared split. `active` gates the initial fetch (nothing loads
 * until the section is first shown) and triggers a silent refresh on
 * re-activation. */
export function useLint(scope: LintScope, showDismissed: boolean, active: boolean): LintApi {
  const [report, setReport] = useState<LintReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [triaging, setTriaging] = useState(false);
  // Optimistic dismissed-state overrides: ident -> dismissed?
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(active);
  const reqRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    const n = ++reqRef.current;
    if (!silent) setLoading(true);
    try {
      const url = `/api/lint?scope=${scope}` + (showDismissed ? '&include_dismissed=1' : '');
      const d = await api<LintReport>(url, { silent });
      if (reqRef.current === n) {
        setReport(d);
        setOverrides(new Map());
      }
    } catch {
      /* toast unless silent */
    } finally {
      if (reqRef.current === n) setLoading(false);
    }
  }, [scope, showDismissed]);

  useEffect(() => { if (active) setArmed(true); }, [active]);
  useEffect(() => { if (armed) void load(); }, [armed, load]);

  // Silently refresh when the section is re-activated with data already loaded
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (active && hadDataRef.current) void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => { if (report) hadDataRef.current = true; }, [report]);

  // Poll while triage has flags to work through, but stop if it reported an
  // error (the server won't auto-retry until backoff clears), so the spinner
  // can't spin forever. "Triage now" is the manual escape hatch.
  const triageErr = report?.triage?.last_error;
  useEffect(() => {
    if (!report?.triage_pending || triageErr) return;
    const t = window.setInterval(() => { void load(true); }, 10000);
    return () => window.clearInterval(t);
  }, [report?.triage_pending, triageErr, load]);

  const rerun = useCallback(async () => {
    setRerunning(true);
    try {
      await api('/api/reindex', { method: 'POST', body: {} });
      await load();
    } catch {
      /* toast shown */
    } finally {
      setRerunning(false);
    }
  }, [load]);

  const triageNow = useCallback(async () => {
    setTriaging(true);
    try {
      await api('/api/triage/run', { method: 'POST', body: {} });
      await load(true);
    } catch {
      /* toast shown */
    } finally {
      setTriaging(false);
    }
  }, [load]);

  const isDismissed = useCallback(
    (f: LintFlag) => overrides.get(flagIdent(f)) ?? !!f.dismissed,
    [overrides],
  );

  const toggleDismiss = useCallback(async (flag: LintFlag) => {
    const key = flagIdent(flag);
    const was = overrides.get(key) ?? !!flag.dismissed;
    setOverrides((m) => new Map(m).set(key, !was)); // optimistic flip
    try {
      await api('/api/lint/' + (was ? 'undismiss' : 'dismiss'), {
        method: 'POST',
        body: { category: flag.category, key: flag.key },
      });
      if (showDismissed) void load(true); // pick up the server's dismissed state
    } catch {
      setOverrides((m) => new Map(m).set(key, was)); // revert
    }
  }, [overrides, showDismissed, load]);

  const restore = useCallback(async (flag: LintFlag) => {
    const key = flagIdent(flag);
    setBusyKeys((s) => new Set(s).add(key));
    try {
      await api('/api/triage/reject', {
        method: 'POST',
        body: { category: flag.category, key: flag.key },
      });
      await load();
    } catch {
      /* toast shown */
    } finally {
      setBusyKeys((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [load]);

  // Split each file's flags: AI-cleared ones sink to the bottom section
  const cleared: ClearedFlag[] = [];
  const seenCleared = new Set<string>();
  const visibleFiles = (report?.files ?? [])
    .map((f) => {
      const flags = (f.flags || []).filter((fl) => {
        if (fl.ai?.verdict === 'clear') {
          const k = flagIdent(fl);
          if (!seenCleared.has(k)) {
            seenCleared.add(k);
            cleared.push({ filePath: f.path, flag: fl });
          }
          return false;
        }
        if (!showDismissed && isDismissed(fl)) return false;
        return true;
      });
      return { path: f.path, flags };
    })
    .filter((f) => f.flags.length > 0);

  return {
    report, loading, rerunning, triaging, busyKeys, visibleFiles, cleared,
    load, rerun, triageNow, isDismissed, toggleDismiss, restore,
  };
}
