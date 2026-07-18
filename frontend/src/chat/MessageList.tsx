import { useLayoutEffect, useRef, useState } from 'react';
import { EventItem } from './EventItem';
import type { ChatItem } from '../hooks/useChatStream';

/** Scrollable message column with bottom pinning: stays glued to the newest
 * message unless the user scrolled up, in which case a jump pill appears. */
export function MessageList({ items, thinking }: { items: ChatItem[]; thinking: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinnedRef.current = pinned;
    setShowJump(!pinned);
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [items, thinking]);

  const jump = () => {
    pinnedRef.current = true;
    setShowJump(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="chat-scroll-wrap">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-messages">
          {items.map((it) => <EventItem key={it.id} item={it} />)}
          {thinking && <div className="thinking">thinking…</div>}
          {items.length === 0 && !thinking && (
            <div className="empty">No messages yet. Say something below.</div>
          )}
        </div>
      </div>
      {showJump && (
        <button className="jump-latest" onClick={jump}>↓ Jump to latest</button>
      )}
    </div>
  );
}
