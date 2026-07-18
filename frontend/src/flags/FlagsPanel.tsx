import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { AiDismissedSection, type ClearedFlag } from './AiDismissedSection';
import { FlagCard, flagIdent } from './FlagCard';
import { ScopeSegment } from './ScopeSegment';
import type { LintFlag, LintReport, LintScope } from '../types';

export function FlagsPanel({ active, onOpenFile }: {
  active: boolean;
  onOpenFile: (path: string, line?: number | null) => void;
}) {
  const [scope, setScope] = useState<LintScope>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [report, setReport] = useState<LintReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [triaging, setTriaging] = useState(false);
  // optimistic dismissed-state overrides: ident -> dismissed?
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
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

  useEffect(() => { void load(); }, [load]);

  // silently refresh when the tab is re-activated with data already loaded
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (active && hadDataRef.current) void load(true);
    if (report) hadDataRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Poll while triage has flags to work through — but stop if it reported an
  // error (the server won't auto-retry until backoff clears), so the spinner
  // can't spin forever. "Triage now" is the manual escape hatch.
  const triageErr = report?.triage?.last_error;
  useEffect(() => {
    if (!report?.triage_pending || triageErr) return;
    const t = window.setInterval(() => { void load(true); }, 10000);
    return () => window.clearInterval(t);
  }, [report?.triage_pending, triageErr, load]);

  const rerun = async () => {
    setRerunning(true);
    try {
      await api('/api/reindex', { method: 'POST', body: {} });
      await load();
    } catch {
      /* toast shown */
    } finally {
      setRerunning(false);
    }
  };

  const triageNow = async () => {
    setTriaging(true);
    try {
      await api('/api/triage/run', { method: 'POST', body: {} });
      await load(true);
    } catch {
      /* toast shown */
    } finally {
      setTriaging(false);
    }
  };

  const isDismissed = useCallback(
    (f: LintFlag) => overrides.get(flagIdent(f)) ?? !!f.dismissed,
    [overrides],
  );

  const toggleDismiss = async (flag: LintFlag) => {
    const key = flagIdent(flag);
    const was = isDismissed(flag);
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
  };

  const restore = async (flag: LintFlag) => {
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
  };

  // Split each file's flags: AI-cleared ones sink to the bottom section.
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

  return (
    <div className="flags-panel">
      <div className="flags-toolbar">
        <ScopeSegment value={scope} onChange={setScope} />
        <span className="flags-total">
          {report ? `${report.total} flag${report.total === 1 ? '' : 's'}` : ''}
        </span>
        {!!report?.triage_pending && (
          <span
            className="triage-pending"
            title="A cheap model (haiku) reviews each flag and clears the clearly-intentional ones"
          >
            {report.triage?.running && !triageErr && <span className="spinner" />}
            {report.triage_pending} awaiting AI review
          </span>
        )}
        {triageErr && (
          <span className="triage-error" title={triageErr}>AI review failed</span>
        )}
        {!!report?.triage_pending && (
          <button className="btn" onClick={() => void triageNow()} disabled={triaging || report.triage?.running}>
            {triaging || report.triage?.running ? 'Reviewing…' : triageErr ? 'Retry review' : 'Triage now'}
          </button>
        )}
        <button className="btn" onClick={() => void rerun()} disabled={rerunning}>
          {rerunning ? 'Running…' : 'Re-run'}
        </button>
        <label className="check-label">
          <input
            type="checkbox"
            checked={showDismissed}
            onChange={(e) => setShowDismissed(e.target.checked)}
          /> show dismissed
        </label>
        <span className="dim flags-generated">
          {report?.generated_at ? 'generated ' + report.generated_at : ''}
        </span>
      </div>
      <div className="flags-list">
        {loading && !report && <div className="empty">Loading…</div>}
        {report && visibleFiles.length === 0 && cleared.length === 0 && (
          <div className="empty">No flags. Clean corpus.</div>
        )}
        {visibleFiles.map((f) => (
          <details key={f.path} className="flag-file" open>
            <summary>
              <span className="mono">{f.path}</span>
              <span className="count-pill">{f.flags.length}</span>
            </summary>
            {f.flags.map((fl) => (
              <FlagCard
                key={flagIdent(fl)}
                flag={fl}
                dismissed={isDismissed(fl)}
                onToggleDismiss={() => void toggleDismiss(fl)}
                onOpen={onOpenFile}
              />
            ))}
          </details>
        ))}
        <AiDismissedSection
          cleared={cleared}
          onRestore={(f) => void restore(f)}
          busyKeys={busyKeys}
        />
      </div>
    </div>
  );
}
