import { useMediaQuery } from '../util';
import { useWorkspace } from '../app/workspace';
import { IconChat } from './icons';

/** Buffer tab strip: click activates, x or middle-click closes, overflowing
 * tabs scroll horizontally. The right cluster holds the chat dock toggle. */
export function TabBar() {
  const ws = useWorkspace();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const toggleChat = () => {
    if (ws.chatDock === 'hidden') ws.setChatDock(isMobile ? 'full' : 'docked');
    else ws.setChatDock('hidden');
  };

  return (
    <div className="tabbar">
      <div className="tabs-scroll" role="tablist" aria-label="Open buffers">
        {ws.buffers.map((b) => (
          <div
            key={b.id}
            role="tab"
            aria-selected={b.id === ws.activeId}
            className={'tab' + (b.id === ws.activeId ? ' active' : '')}
            title={b.title}
            onClick={() => ws.activate(b.id)}
            onAuxClick={(e) => { if (e.button === 1) ws.close(b.id); }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
          >
            <span className="tab-title">{b.title}</span>
            {b.dirty && <span className="tab-dirty" title="Unsaved changes" />}
            <button
              className="tab-close"
              aria-label={'Close ' + b.title}
              title="Close"
              onClick={(e) => { e.stopPropagation(); ws.close(b.id); }}
            >×</button>
          </div>
        ))}
        {ws.buffers.length === 0 && <span className="tabbar-empty">Word Warehouse</span>}
      </div>
      <div className="tabbar-actions">
        <button
          className={'rail-btn chat-toggle' + (ws.chatDock !== 'hidden' ? ' active' : '')}
          title="Toggle chat panel"
          aria-label="Toggle chat panel"
          aria-pressed={ws.chatDock !== 'hidden'}
          onClick={toggleChat}
        ><IconChat /></button>
      </div>
    </div>
  );
}
