import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkspace } from '@/context/workspace';
import { useKeyboardScroll } from '@/hooks/useKeyboardScroll';
import { Markdown } from '@/lib/markdown';
import { IconRefresh } from '@/components/layout/icons';

/** Help buffer: the server's help markdown on sans prose. */
export function HelpBuffer() {
  const ws = useWorkspace();
  const help = useQuery({
    queryKey: ['help'],
    queryFn: () => api<{ markdown: string }>('/api/help'),
  });
  const scroll = useKeyboardScroll(ws.activeId === 'help');
  return (
    <div className="doc-buffer" {...scroll}>
      <div className="doc-tools">
        <span className="dim">Word Warehouse help</span>
        <span className="toolbar-spacer" />
        <button
          className={'icon-btn doc-refresh' + (help.isFetching ? ' loading' : '')}
          onClick={() => void help.refetch()}
          disabled={help.isFetching}
          title="Reload" aria-label="Reload"
        ><IconRefresh /></button>
      </div>
      {help.isFetching && !help.data && <div className="empty">Loading…</div>}
      {help.error && !help.isFetching && <div className="empty">Failed to load help.</div>}
      {help.data && <Markdown className="coverage" text={help.data.markdown || ''} />}
    </div>
  );
}
