import { useState } from 'react';
import { useWorkspace } from '@/context/workspace';
import { AiDismissedSection } from '@/features/flags/AiDismissedSection';
import { FlagCard, flagIdent } from '@/features/flags/FlagCard';
import { ScopeSegment } from '@/features/flags/ScopeSegment';
import { useLint } from '@/features/flags/useLint';
import type { LintScope } from '@/lib/types';

/** Flags section: lint scope + triage controls up top, per-file flag groups
 * below. Stays mounted across section switches, so the report (and the 10s
 * pending-triage poll) survives; the first activation triggers the fetch.
 * Flag locations open file buffers at the flagged line. */
export function FlagsSidebar() {
  const ws = useWorkspace();
  const [scope, setScope] = useState<LintScope>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const lint = useLint(scope, showDismissed, ws.rail === 'flags');
  const { report } = lint;
  const triageErr = report?.triage?.last_error;

  const openFile = (path: string, line?: number | null) => {
    ws.open({ kind: 'file', path, line: line ?? null });
    ws.setDrawerOpen(false);
  };

  return (
    <div className="flags-side">
      <div className="fl-tools">
        <div className="fl-row">
          <ScopeSegment value={scope} onChange={setScope} />
          <span className="fl-total">
            {report ? `${report.total} flag${report.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        {(!!report?.triage_pending || triageErr) && (
          <div className="fl-row">
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
          </div>
        )}
        <div className="fl-row">
          {!!report?.triage_pending && (
            <button
              className="btn btn-sm"
              onClick={() => void lint.triageNow()}
              disabled={lint.triaging || report.triage?.running}
            >
              {lint.triaging || report.triage?.running ? 'Reviewing…' : triageErr ? 'Retry review' : 'Triage now'}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => void lint.rerun()} disabled={lint.rerunning}>
            {lint.rerunning ? 'Running…' : 'Re-run'}
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
            /> dismissed
          </label>
        </div>
      </div>
      <div className="fl-list">
        {lint.loading && !report && <div className="empty">Loading…</div>}
        {report && lint.visibleFiles.length === 0 && lint.cleared.length === 0 && (
          <div className="empty">No flags. Clean corpus.</div>
        )}
        {lint.visibleFiles.map((f) => (
          <details key={f.path} className="flag-file" open>
            <summary>
              <span className="mono ff-path" title={f.path}>{f.path}</span>
              <span className="count-pill">{f.flags.length}</span>
            </summary>
            {f.flags.map((fl) => (
              <FlagCard
                key={flagIdent(fl)}
                flag={fl}
                dismissed={lint.isDismissed(fl)}
                onToggleDismiss={() => void lint.toggleDismiss(fl)}
                onOpen={openFile}
              />
            ))}
          </details>
        ))}
        <AiDismissedSection
          cleared={lint.cleared}
          onRestore={(f) => void lint.restore(f)}
          onOpen={openFile}
          busyKeys={lint.busyKeys}
        />
      </div>
    </div>
  );
}
