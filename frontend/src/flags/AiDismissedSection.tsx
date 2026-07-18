import { flagIdent } from './FlagCard';
import type { LintFlag } from '../types';

export interface ClearedFlag {
  filePath: string;
  flag: LintFlag;
}

/** Collapsible bottom section listing flags the AI triage judged 'clear'.
 * Restore (user disagrees) -> POST /api/triage/reject, then refetch. */
export function AiDismissedSection({ cleared, onRestore, busyKeys }: {
  cleared: ClearedFlag[];
  onRestore: (f: LintFlag) => void;
  busyKeys: Set<string>;
}) {
  if (!cleared.length) return null;
  return (
    <details className="ai-dismissed">
      <summary>AI dismissed ({cleared.length})</summary>
      <div className="ai-dismissed-list">
        {cleared.map(({ filePath, flag }) => (
          <div className="flag ai-cleared" key={flagIdent(flag)}>
            <div className="flag-head">
              <span className="chip chip-clear">{flag.category}</span>
              <span className="flag-title">
                <b>{flag.key}</b> <span className="dim mono">{filePath}</span>
              </span>
              <button
                className="btn btn-sm"
                disabled={busyKeys.has(flagIdent(flag))}
                title="Disagree with the AI verdict and restore this flag"
                onClick={() => onRestore(flag)}
              >Restore</button>
            </div>
            <div className="ai-note">
              AI: clear — {flag.ai?.reason || '(no reason given)'}
              {flag.ai?.judged_at ? <span className="dim"> · judged {flag.ai.judged_at}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
