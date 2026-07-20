import { api } from '@/lib/api';
import { useWorkspace } from '@/context/workspace';
import { useAsync } from '@/hooks/useAsync';
import { useKeyboardScroll } from '@/hooks/useKeyboardScroll';
import { Markdown } from '@/lib/markdown';

/** Coverage report buffer: server-generated markdown on sans prose. */
export function CoverageBuffer() {
  const ws = useWorkspace();
  const cov = useAsync(() => api<{ markdown: string }>('/api/coverage'), []);
  const scroll = useKeyboardScroll(ws.activeId === 'coverage');
  return (
    <div className="doc-buffer" {...scroll}>
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
