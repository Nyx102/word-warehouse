import { api } from '@/lib/api';
import { useWorkspace } from '@/context/workspace';
import { useAsync } from '@/hooks/useAsync';
import { useKeyboardScroll } from '@/hooks/useKeyboardScroll';
import { Markdown } from '@/lib/markdown';

/** Help buffer: the server's help markdown on sans prose. */
export function HelpBuffer() {
  const ws = useWorkspace();
  const help = useAsync(() => api<{ markdown: string }>('/api/help'), []);
  const scroll = useKeyboardScroll(ws.activeId === 'help');
  return (
    <div className="doc-buffer" {...scroll}>
      <div className="doc-tools">
        <span className="dim">Word Warehouse help</span>
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
