import { api } from '../api';
import { useAsync } from '../hooks/useAsync';
import { Markdown } from '../markdown';

/** Help buffer: the server's help markdown on sans prose. */
export function HelpBuffer() {
  const help = useAsync(() => api<{ markdown: string }>('/api/help'), []);
  return (
    <div className="doc-buffer">
      <div className="doc-tools">
        <span className="dim">Workbench help</span>
        <span className="toolbar-spacer" />
        <button className="btn btn-sm" onClick={help.reload} disabled={help.loading}>
          {help.loading ? 'Loading…' : 'Reload'}
        </button>
      </div>
      {help.loading && !help.data && <div className="empty">Loading…</div>}
      {help.error && !help.loading && <div className="empty">Failed to load help.</div>}
      {help.data && <Markdown className="coverage" text={help.data.markdown || ''} />}
    </div>
  );
}
