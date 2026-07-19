import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useWorkspace, type RailSection } from '../app/workspace';
import { useMediaQuery } from '../util';
import { FilesSidebar } from '../sidebars/FilesSidebar';
import { SearchSidebar } from '../sidebars/SearchSidebar';
import { GitSidebar } from '../sidebars/GitSidebar';
import { FlagsSidebar } from '../sidebars/FlagsSidebar';
import { ThreadsSidebar } from '../sidebars/ThreadsSidebar';
import type { ThreadsApi } from '../chat/useThreads';

const LABELS: Record<RailSection, string> = {
  files: 'Files',
  search: 'Search',
  git: 'Git',
  flags: 'Flags',
  chat: 'Threads',
};

/** Contextual sidebar. All five section panels stay mounted (CSS-hidden when
 * inactive) so tree expansion and list state survive section switches. Inline
 * column on desktop, overlay drawer below 1024px; both are the same DOM node
 * so nothing remounts when the viewport crosses the breakpoint. */
export function Sidebar({ threadsApi }: { threadsApi: ThreadsApi }) {
  const ws = useWorkspace();
  // Drag-to-resize only applies to the inline desktop column; below 1024px the
  // sidebar is a fixed-width overlay drawer, so the handle stays hidden there.
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startW: ws.sidebarWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d) ws.setSidebarWidth(d.startW + (e.clientX - d.startX));
  };
  const onHandleUp = () => { dragRef.current = null; };

  const panels: { id: RailSection; body: JSX.Element }[] = [
    { id: 'files', body: <FilesSidebar /> },
    { id: 'search', body: <SearchSidebar /> },
    { id: 'git', body: <GitSidebar /> },
    { id: 'flags', body: <FlagsSidebar /> },
    { id: 'chat', body: <ThreadsSidebar threadsApi={threadsApi} /> },
  ];
  return (
    <>
      {ws.drawerOpen && (
        <div className="sb-backdrop" onClick={() => ws.setDrawerOpen(false)} />
      )}
      <aside
        className={'ws-sidebar'
          + (ws.sidebarCollapsed ? ' collapsed' : '')
          + (ws.drawerOpen ? ' drawer-open' : '')}
        style={isDesktop ? { width: ws.sidebarWidth } : undefined}
        aria-label={LABELS[ws.rail]}
      >
        {isDesktop && (
          <div
            className="sb-handle"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
        )}
        <div className="sb-head">
          <span className="sb-title">{LABELS[ws.rail]}</span>
          <button
            className="icon-btn sb-collapse"
            title="Hide sidebar"
            aria-label="Hide sidebar"
            onClick={() => {
              ws.setDrawerOpen(false);
              ws.setSidebarCollapsed(true);
            }}
          >«</button>
        </div>
        {panels.map((p) => (
          <div key={p.id} className={'sb-panel' + (ws.rail === p.id ? ' active' : '')}>
            {p.body}
          </div>
        ))}
      </aside>
    </>
  );
}
