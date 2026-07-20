import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useMediaQuery } from '@/lib/util';
import { useWorkspace } from '@/context/workspace';
import { IconChat, IconChevronDown } from './icons';

type TabMenu = { id: string; title: string; x: number; y: number } | null;

/** Buffer tab strip: click activates, x / middle-click / Alt+W closes, right
 * click opens a close menu. Overflowing tabs scroll horizontally (no visible
 * scrollbar; vertical wheel scrolls sideways) and a ▾ overflow menu lists them
 * all. The right cluster holds that menu and the chat dock toggle. */
export function TabBar() {
  const ws = useWorkspace();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [menu, setMenu] = useState<TabMenu>(null);
  const [listOpen, setListOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);

  const toggleChat = () => {
    if (ws.chatDock === 'hidden') ws.setChatDock(isMobile ? 'full' : 'docked');
    else ws.setChatDock('hidden');
  };

  // Alt+W closes the active buffer. Ctrl/Cmd+W can't be intercepted (the
  // browser closes its own tab first), so Alt is the safe modifier; keyed off
  // e.code so it survives Alt remapping the character on some layouts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW' && ws.activeId != null) {
        e.preventDefault();
        ws.close(ws.activeId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws.activeId, ws.close]);

  // Vertical wheel scrolls the strip horizontally, like VS Code. Native
  // non-passive listener so preventDefault actually stops the page from
  // scrolling underneath.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || e.shiftKey) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Show the ▾ overflow control only when tabs actually spill past the strip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ws.buffers.length]);

  // Keep the active tab visible when it changes (menu jump, keyboard, open).
  useEffect(() => {
    if (ws.activeId == null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-tabid="${CSS.escape(ws.activeId)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [ws.activeId]);

  // Dismiss either popover on Escape or on any scroll elsewhere
  useEffect(() => {
    if (!menu && !listOpen) return;
    const close = () => { setMenu(null); setListOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu, listOpen]);

  const openMenu = (e: ReactMouseEvent, id: string, title: string) => {
    e.preventDefault();
    setListOpen(false);
    setMenu({ id, title, x: e.clientX, y: e.clientY });
  };

  const menuStyle = menu
    ? {
      left: Math.max(4, Math.min(menu.x, window.innerWidth - 190)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - 180)),
    }
    : undefined;

  // The overflow list drops down from its button, right-aligned to it
  const listStyle = (() => {
    const r = overflowBtnRef.current?.getBoundingClientRect();
    if (!r) return undefined;
    return { top: r.bottom + 4, right: Math.max(4, window.innerWidth - r.right) };
  })();

  // Computed against the live buffer list when a context action fires
  const idx = menu ? ws.buffers.findIndex((b) => b.id === menu.id) : -1;
  const hasOthers = ws.buffers.length > 1;
  const hasRight = idx >= 0 && idx < ws.buffers.length - 1;

  return (
    <div className="tabbar">
      <div className="tabs-scroll" role="tablist" aria-label="Open buffers" ref={scrollRef}>
        {ws.buffers.map((b) => (
          <div
            key={b.id}
            data-tabid={b.id}
            role="tab"
            aria-selected={b.id === ws.activeId}
            className={'tab' + (b.id === ws.activeId ? ' active' : '') + (b.dirty ? ' dirty' : '')}
            title={b.title}
            onClick={() => ws.activate(b.id)}
            onAuxClick={(e) => { if (e.button === 1) ws.close(b.id); }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            onContextMenu={(e) => openMenu(e, b.id, b.title)}
          >
            <span className="tab-title">{b.title}</span>
            <span className="tab-tail">
              {b.dirty && <span className="tab-dirty" title="Unsaved changes" />}
              <button
                className="tab-close"
                aria-label={'Close ' + b.title}
                title="Close"
                onClick={(e) => { e.stopPropagation(); ws.close(b.id); }}
              >×</button>
            </span>
          </div>
        ))}
        {ws.buffers.length === 0 && <span className="tabbar-empty">Word Warehouse</span>}
      </div>
      <div className="tabbar-actions">
        {overflowing && (
          <button
            ref={overflowBtnRef}
            className={'rail-btn tab-overflow' + (listOpen ? ' active' : '')}
            title="Open buffers"
            aria-label="Show all open buffers"
            aria-expanded={listOpen}
            onClick={() => { setMenu(null); setListOpen((v) => !v); }}
          ><IconChevronDown /></button>
        )}
        <button
          className={'rail-btn chat-toggle' + (ws.chatDock !== 'hidden' ? ' active' : '')}
          title="Toggle chat panel"
          aria-label="Toggle chat panel"
          aria-pressed={ws.chatDock !== 'hidden'}
          onClick={toggleChat}
        ><IconChat /></button>
      </div>

      {menu && (
        <div
          className="ctx-overlay"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
        >
          <div className="ctx-menu" style={menuStyle} onClick={(e) => e.stopPropagation()}>
            <div className="ctx-title" title={menu.title}>{menu.title}</div>
            <button
              className="ctx-item"
              onClick={() => { ws.close(menu.id); setMenu(null); }}
            >Close<span className="ctx-key">Alt+W</span></button>
            {hasOthers && (
              <button
                className="ctx-item"
                onClick={() => {
                  ws.closeMany(ws.buffers.filter((b) => b.id !== menu.id).map((b) => b.id));
                  setMenu(null);
                }}
              >Close Others</button>
            )}
            {hasRight && (
              <button
                className="ctx-item"
                onClick={() => {
                  ws.closeMany(ws.buffers.slice(idx + 1).map((b) => b.id));
                  setMenu(null);
                }}
              >Close to the Right</button>
            )}
            {hasOthers && (
              <button
                className="ctx-item"
                onClick={() => { ws.closeMany(ws.buffers.map((b) => b.id)); setMenu(null); }}
              >Close All</button>
            )}
          </div>
        </div>
      )}

      {listOpen && (
        <div
          className="ctx-overlay"
          onClick={() => setListOpen(false)}
          onContextMenu={(e) => { e.preventDefault(); setListOpen(false); }}
        >
          <div className="ctx-menu tab-list" style={listStyle} onClick={(e) => e.stopPropagation()}>
            {ws.buffers.map((b) => (
              <button
                key={b.id}
                className={'ctx-item tab-list-item' + (b.id === ws.activeId ? ' active' : '')}
                title={b.title}
                onClick={() => { ws.activate(b.id); setListOpen(false); }}
              >
                {b.dirty && <span className="tab-dirty" title="Unsaved changes" />}
                <span className="tab-list-title">{b.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
