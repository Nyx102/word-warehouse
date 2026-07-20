import { useWorkspace, type RailSection } from '@/context/workspace';

const SECTIONS: { id: RailSection; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'search', label: 'Search' },
  { id: 'git', label: 'Git' },
  { id: 'flags', label: 'Flags' },
  { id: 'chat', label: 'Chat' },
];

/** Phone bottom nav: the five sections plus the status dot. Non-chat sections
 * open their sidebar as a drawer; Chat brings the dock up full-screen. */
export function MobileNav({ busy, dirty, onOpenSheet }: {
  busy: boolean;
  dirty: boolean;
  onOpenSheet: () => void;
}) {
  const ws = useWorkspace();

  const tap = (s: RailSection) => {
    if (s === 'chat') {
      ws.setRail('chat');
      ws.setDrawerOpen(false);
      ws.setChatDock('full');
      return;
    }
    if (s === 'git') ws.open({ kind: 'magit', repo: ws.gitRepo });
    if (ws.rail === s && ws.drawerOpen) {
      ws.setDrawerOpen(false);
      return;
    }
    ws.setRail(s);
    ws.setDrawerOpen(true);
    if (ws.chatDock !== 'hidden') ws.setChatDock('hidden');
  };

  return (
    <nav className="bottom-nav" aria-label="Sections">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          className={'bn-btn' + (ws.rail === s.id ? ' active' : '')}
          onClick={() => tap(s.id)}
        >
          <span className="bn-label">{s.label}</span>
        </button>
      ))}
      <button
        className={'bn-btn bn-status status-dot-btn' + (busy ? ' busy' : dirty ? ' dirty' : '')}
        onClick={onOpenSheet}
        title="Status"
        aria-label="Status"
      ><span className="status-dot" /></button>
    </nav>
  );
}
