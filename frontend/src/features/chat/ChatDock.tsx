import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { ChatPanel } from './ChatPanel';
import { useMediaQuery } from '@/lib/util';
import { useWorkspace } from '@/context/workspace';
import { IconDockRight, IconExpand } from '@/components/layout/icons';
import type { ThreadsApi } from './useThreads';

/** The chat host: ONE permanent subtree whose hidden/docked/full placement is
 * pure CSS, so the SSE stream and scroll position survive every toggle.
 * Docked width is draggable via the left-edge handle; phones render docked
 * as full-screen (CSS) and hide the expand control. */
export function ChatDock({ threadsApi, onTurnActiveChange }: {
  threadsApi: ThreadsApi;
  onTurnActiveChange: (on: boolean) => void;
}) {
  const ws = useWorkspace();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (ws.chatDock !== 'docked') return;
    dragRef.current = { startX: e.clientX, startW: ws.chatWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d) ws.setChatWidth(d.startW + (d.startX - e.clientX));
  };
  const onHandleUp = () => { dragRef.current = null; };

  const title = threadsApi.selected ? threadsApi.label(threadsApi.selected) : 'New chat';

  return (
    <aside
      className={'chat-dock dock-' + ws.chatDock}
      style={ws.chatDock === 'docked' ? { width: ws.chatWidth } : undefined}
      aria-label="Chat"
    >
      <div
        className="dock-handle"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat panel"
      />
      <div className="dock-bar">
        <span className="dock-title" title={title}>{title}</span>
        <span className="toolbar-spacer" />
        {!isMobile && (
          <button
            className="icon-btn dock-btn"
            title={ws.chatDock === 'full' ? 'Dock to the side' : 'Expand to full view'}
            aria-label={ws.chatDock === 'full' ? 'Dock chat to the side' : 'Expand chat to full view'}
            onClick={() => ws.setChatDock(ws.chatDock === 'full' ? 'docked' : 'full')}
          >{ws.chatDock === 'full' ? <IconDockRight /> : <IconExpand />}</button>
        )}
        <button
          className="icon-btn dock-btn"
          title="Hide chat"
          aria-label="Hide chat"
          onClick={() => ws.setChatDock('hidden')}
        >×</button>
      </div>
      <ChatPanel threadsApi={threadsApi} onTurnActiveChange={onTurnActiveChange} />
    </aside>
  );
}
