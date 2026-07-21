import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from '@/components/Toasts';
import { flagIdent } from './FlagCard';
import type { ClearedFlag } from './AiDismissedSection';
import type { LintFlag, LintReport, LintScope } from '@/lib/types';

export interface LintApi {
  report: LintReport | null;
  loading: boolean;
  rerunning: boolean;
  triaging: boolean;
  busyKeys: Set<string>;
  visibleFiles: { path: string; flags: LintFlag[] }[];
  cleared: ClearedFlag[];
  rerun: () => Promise<void>;
  triageNow: () => Promise<void>;
  isDismissed: (f: LintFlag) => boolean;
  toggleDismiss: (f: LintFlag) => Promise<void>;
  restore: (f: LintFlag) => Promise<void>;
  fix: (path: string, f: LintFlag) => Promise<void>;
}

/** Lint report state for the Flags sidebar: fetch (react-query, keyed on
 * scope+dismissed), optimistic dismiss/undismiss, triage restore, the 10s
 * pending-triage poll (a conditional refetchInterval), and the visible/AI-
 * cleared split. `active` gates the initial fetch (nothing loads until the
 * section is first shown) and triggers a refresh on re-activation. */
export function useLint(scope: LintScope, showDismissed: boolean, active: boolean): LintApi {
  const qc = useQueryClient();
  // Optimistic dismissed-state overrides: ident -> dismissed?
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(active);

  const q = useQuery({
    queryKey: ['lint', scope, showDismissed],
    // Silent so the 10s triage poll can't spew a toast every tick on failure.
    queryFn: () =>
      api<LintReport>(`/api/lint?scope=${scope}` + (showDismissed ? '&include_dismissed=1' : ''), {
        silent: true,
      }),
    enabled: armed,
    // Poll while triage has flags to work through, but stop if it reported an
    // error (the server won't auto-retry until backoff clears) so the spinner
    // can't spin forever. "Triage now" is the manual escape hatch.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.triage_pending && !d?.triage?.last_error ? 10_000 : false;
    },
  });
  const report = q.data ?? null;
  const loading = q.isFetching;

  const invalidateLint = useCallback(
    () => { void qc.invalidateQueries({ queryKey: ['lint'] }); },
    [qc],
  );

  useEffect(() => { if (active) setArmed(true); }, [active]);

  // Fresh server data supersedes the optimistic overrides.
  useEffect(() => {
    if (q.data && overridesRef.current.size > 0) setOverrides(new Map());
  }, [q.data]);

  // Silently refresh when the section is re-activated with data already armed;
  // the first activation is handled by `armed` flipping the query on.
  useEffect(() => {
    if (active && armed) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const rerunMut = useMutation({
    mutationFn: () => api('/api/reindex', { method: 'POST', body: {} }),
    onSuccess: invalidateLint,
  });
  const rerun = useCallback(async () => {
    await rerunMut.mutateAsync().catch(() => { /* toast shown */ });
  }, [rerunMut]);

  const triageMut = useMutation({
    mutationFn: () => api('/api/triage/run', { method: 'POST', body: {} }),
    onSuccess: invalidateLint,
  });
  const triageNow = useCallback(async () => {
    await triageMut.mutateAsync().catch(() => { /* toast shown */ });
  }, [triageMut]);

  const isDismissed = useCallback(
    (f: LintFlag) => overrides.get(flagIdent(f)) ?? !!f.dismissed,
    [overrides],
  );

  // Optimistic flip in onMutate; revert in onError. Only pull the server's
  // dismissed state back in when the dismissed rows are actually on screen.
  const dismissMut = useMutation({
    mutationFn: (v: { flag: LintFlag; was: boolean }) =>
      api('/api/lint/' + (v.was ? 'undismiss' : 'dismiss'), {
        method: 'POST',
        body: { category: v.flag.category, key: v.flag.key },
      }),
    onMutate: (v) => {
      const key = flagIdent(v.flag);
      setOverrides((m) => new Map(m).set(key, !v.was));
      return { key, was: v.was };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) setOverrides((m) => new Map(m).set(ctx.key, ctx.was));
    },
    onSuccess: () => { if (showDismissed) invalidateLint(); },
  });
  const toggleDismiss = useCallback(async (flag: LintFlag) => {
    const was = overridesRef.current.get(flagIdent(flag)) ?? !!flag.dismissed;
    await dismissMut.mutateAsync({ flag, was }).catch(() => { /* reverted in onError */ });
  }, [dismissMut]);

  const restoreMut = useMutation({
    mutationFn: (flag: LintFlag) =>
      api('/api/triage/reject', { method: 'POST', body: { category: flag.category, key: flag.key } }),
    onMutate: (flag) => {
      const key = flagIdent(flag);
      setBusyKeys((s) => new Set(s).add(key));
      return { key };
    },
    onSettled: (_d, _e, _flag, ctx) => {
      if (ctx) setBusyKeys((s) => { const n = new Set(s); n.delete(ctx.key); return n; });
    },
    onSuccess: invalidateLint,
  });
  const restore = useCallback(async (flag: LintFlag) => {
    await restoreMut.mutateAsync(flag).catch(() => { /* toast shown */ });
  }, [restoreMut]);

  // Rewrites the file on disk, so no optimistic flip: the flag only goes away
  // once the server has re-linted.
  const fixMut = useMutation({
    mutationFn: (v: { path: string; flag: LintFlag }) =>
      api<{ count: number; change: string }>('/api/lint/fix', {
        method: 'POST',
        body: { path: v.path, category: v.flag.category, key: v.flag.key },
      }),
    onMutate: (v) => {
      const key = flagIdent(v.flag);
      setBusyKeys((s) => new Set(s).add(key));
      return { key };
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx) setBusyKeys((s) => { const n = new Set(s); n.delete(ctx.key); return n; });
    },
    onSuccess: (r) => {
      toast(`Fixed ${r.change} ×${r.count}`, 'ok');
      invalidateLint();
    },
  });
  const fix = useCallback(async (path: string, flag: LintFlag) => {
    await fixMut.mutateAsync({ path, flag }).catch(() => { /* toast shown */ });
  }, [fixMut]);

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
    report,
    loading,
    rerunning: rerunMut.isPending,
    triaging: triageMut.isPending,
    busyKeys,
    visibleFiles,
    cleared,
    rerun,
    triageNow,
    isDismissed,
    toggleDismiss,
    restore,
    fix,
  };
}
