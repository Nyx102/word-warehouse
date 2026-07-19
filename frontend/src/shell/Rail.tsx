import { useMediaQuery } from '../util';
import { useSettings, type KeymapName } from '../app/settings';
import { useWorkspace, type RailSection } from '../app/workspace';
import { IconChat, IconFiles, IconFlag, IconGit, IconMoon, IconSearch, IconSun } from './icons';

const SECTIONS: { id: RailSection; label: string; icon: () => JSX.Element }[] = [
  { id: 'files', label: 'Files', icon: IconFiles },
  { id: 'search', label: 'Search', icon: IconSearch },
  { id: 'git', label: 'Git', icon: IconGit },
  { id: 'flags', label: 'Flags', icon: IconFlag },
  { id: 'chat', label: 'Chat', icon: IconChat },
];

/** Desktop/tablet icon rail: section switcher plus the settings cluster
 * (theme, keymap, status, help). Hidden below 768px in favor of MobileNav. */
export function Rail({ busy, dirty, onOpenSheet }: {
  busy: boolean;
  dirty: boolean;
  onOpenSheet: () => void;
}) {
  const ws = useWorkspace();
  const { theme, setTheme, keymap, setKeymap } = useSettings();
  // Below 1024px the sidebar is an overlay drawer instead of an inline column
  const isNarrow = useMediaQuery('(max-width: 1023px)');

  const clickSection = (s: RailSection) => {
    if (isNarrow) {
      if (ws.drawerOpen && ws.rail === s) {
        ws.setDrawerOpen(false);
      } else {
        ws.setRail(s);
        ws.setDrawerOpen(true);
      }
    } else if (ws.rail === s) {
      ws.setSidebarCollapsed(!ws.sidebarCollapsed);
    } else {
      ws.setRail(s);
      ws.setSidebarCollapsed(false);
    }
    if (s === 'chat' && ws.chatDock === 'hidden') ws.setChatDock('docked');
    // Git has one obvious landing view; always surface it, don't make the
    // user hunt through the sidebar for a "Status" button
    if (s === 'git') ws.open({ kind: 'magit', repo: ws.gitRepo });
  };

  return (
    <nav className="rail" aria-label="Sections">
      <span className="rail-brand" title="Word Warehouse">W</span>
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          className={'rail-btn' + (ws.rail === s.id ? ' active' : '')}
          aria-label={s.label}
          aria-pressed={ws.rail === s.id}
          title={s.label}
          onClick={() => clickSection(s.id)}
        ><s.icon /></button>
      ))}
      <span className="rail-spacer" />
      <button
        className="rail-btn"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        title="Toggle color theme"
        aria-label="Toggle color theme"
      >{theme === 'dark' ? <IconSun /> : <IconMoon />}</button>
      <select
        className="rail-keymap"
        value={keymap}
        onChange={(e) => setKeymap(e.target.value as KeymapName)}
        title="Editor keymap"
        aria-label="Editor keymap"
      >
        <option value="normal">N</option>
        <option value="vim">V</option>
      </select>
      <button
        className={'status-dot-btn' + (busy ? ' busy' : dirty ? ' dirty' : '')}
        onClick={onOpenSheet}
        title="Status"
        aria-label="Status"
      ><span className="status-dot" /></button>
      <button
        className="help-btn"
        title="Help"
        aria-label="Help"
        onClick={() => ws.open({ kind: 'help' })}
      >?</button>
    </nav>
  );
}
