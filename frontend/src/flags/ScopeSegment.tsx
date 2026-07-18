import type { LintScope } from '../types';

const SCOPES: LintScope[] = ['raw', 'finished', 'all'];

export function ScopeSegment({ value, onChange }: {
  value: LintScope;
  onChange: (s: LintScope) => void;
}) {
  return (
    <div className="seg" role="group" aria-label="Lint scope">
      {SCOPES.map((s) => (
        <button
          key={s}
          className={'seg-btn' + (value === s ? ' active' : '')}
          onClick={() => onChange(s)}
        >{s}</button>
      ))}
    </div>
  );
}
