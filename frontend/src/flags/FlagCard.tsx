import type { ReactNode } from 'react';
import { esc } from '../markdown';
import type { LintFlag } from '../types';

/** Stable identity for dismiss/undismiss/triage calls. */
export function flagIdent(f: LintFlag): string {
  return f.category + '|' + f.key;
}

/** Highlight the flagged token inside a location snippet. Prefers the exact
 * occurrence at `col` (1-based) when the snippet is the full line; falls back
 * to marking every occurrence, then to marking the word at `col`. */
export function markLocation(snippet: string | null | undefined, token: string | null | undefined, col: number | null | undefined): string {
  const s = snippet == null ? '' : String(snippet);
  if (token) {
    if (col != null && col >= 1 && s.startsWith(token, col - 1)) {
      return esc(s.slice(0, col - 1)) + '<mark>' + esc(token) + '</mark>' + esc(s.slice(col - 1 + token.length));
    }
    if (s.includes(token)) {
      return s.split(token).map(esc).join('<mark>' + esc(token) + '</mark>');
    }
  }
  if (col != null && col >= 1 && col <= s.length) {
    const idx = col - 1;
    let end = idx;
    while (end < s.length && !/[\s.,;:!?"'()[\]{}]/.test(s.charAt(end))) end++;
    if (end > idx) {
      return esc(s.slice(0, idx)) + '<mark>' + esc(s.slice(idx, end)) + '</mark>' + esc(s.slice(end));
    }
  }
  return esc(s);
}

export function FlagCard({ flag, dismissed, onToggleDismiss, onOpen }: {
  flag: LintFlag;
  dismissed: boolean;
  onToggleDismiss: () => void;
  // Open the flagged file at a line in the Files editor. Flag paths are
  // CORPUS-relative; the Files editor is project-relative, so prefix 'corpus/'.
  onOpen: (path: string, line?: number | null) => void;
}) {
  const chipClass = 'chip '
    + (flag.category === 'nearmiss' ? 'chip-nearmiss' : 'chip-regression')
    + (flag.manual ? ' chip-striped' : '');

  let title: ReactNode;
  if (flag.category === 'nearmiss') {
    title = (
      <span className="flag-title">
        <b>{flag.key}</b>
        {flag.closest ? <> — did you mean <b>{flag.closest}</b>?</> : null}
      </span>
    );
  } else {
    const bits: string[] = [];
    if (flag.rule != null) bits.push('rule ' + flag.rule + ': ');
    bits.push(`'${flag.find != null ? flag.find : flag.key}' → '${flag.replace != null ? flag.replace : ''}'`);
    if (flag.matched) bits.push(`, matched '${flag.matched}'`);
    if (flag.count != null && flag.count > 1) bits.push(' ×' + flag.count);
    title = <span className="flag-title">{bits.join('')}</span>;
  }

  const token = flag.matched || flag.key || flag.find;

  return (
    <div className={'flag' + (dismissed ? ' dismissed' : '')}>
      <div className="flag-head">
        <span className={chipClass}>{flag.manual ? 'manual ' + flag.category : flag.category}</span>
        {title}
        <button className="btn btn-sm flag-btn" onClick={onToggleDismiss}>
          {dismissed ? 'Undismiss' : 'Dismiss'}
        </button>
      </div>
      {flag.ai?.verdict === 'keep' && (
        <div className="ai-note">AI: keep — {flag.ai.reason}</div>
      )}
      <div className="flag-locs">
        {(flag.locations || []).map((loc, i) => (
          <div className="loc" key={i}>
            <button
              className="loc-path mono loc-open"
              title="Open in editor"
              onClick={() => onOpen('corpus/' + loc.path, loc.line)}
            >{loc.path}:{loc.line}</button>
            <span
              className="loc-snippet"
              dangerouslySetInnerHTML={{ __html: markLocation(loc.snippet, token, loc.col) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
