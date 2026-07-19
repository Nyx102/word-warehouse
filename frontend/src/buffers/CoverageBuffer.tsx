import { api } from '../api';
import { useAsync } from '../hooks/useAsync';
import { Markdown } from '../markdown';

/** Coverage report buffer: server-generated markdown on sans prose. */
export function CoverageBuffer() {
  const cov = useAsync(() => api<{ markdown: string }>('/api/coverage'), []);
  return (
    <div className="doc-buffer">
      <div className="doc-tools">
        <span className="dim">Translation coverage</span>
        <span className="toolbar-spacer" />
        <button className="btn btn-sm" onClick={cov.reload} disabled={cov.loading}>
          {cov.loading ? 'Loading…' : 'Reload'}
        </button>
      </div>
      {cov.loading && !cov.data && <div className="empty">Loading…</div>}
      {cov.error && !cov.loading && <div className="empty">Failed to load coverage.</div>}
      {cov.data && <Markdown className="coverage" text={cov.data.markdown || ''} />}
    </div>
  );
}
