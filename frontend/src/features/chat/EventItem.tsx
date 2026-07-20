import { useState } from 'react';
import { Markdown } from '@/lib/markdown';
import { truncate } from '@/lib/util';
import type { ChatItem } from '@/hooks/useChatStream';

export function EventItem({ item }: { item: ChatItem }) {
  switch (item.type) {
    case 'user':
      return <div className="msg user">{item.text}</div>;
    case 'assistant':
      return <Markdown className="msg assistant" text={item.text} />;
    case 'tool':
      return <ToolChip item={item} />;
    case 'result':
      return (
        <div className="msg-meta">
          {(item.ok ? '✓' : '✗') + (item.durationS != null ? ' ' + item.durationS.toFixed(1) + 's' : '')}
        </div>
      );
    case 'error':
      return <div className="msg error">{item.message}</div>;
  }
}

/** Collapsible activity chip for tool_use; the tool_result preview lands
 * in the <pre> once it arrives. */
function ToolChip({ item }: { item: Extract<ChatItem, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'tool-chip' + (item.isError ? ' chip-error' : '')}>
      <button className="chip-head" onClick={() => setOpen((o) => !o)} title="Toggle tool result">
        <span className="chip-gear">⚙</span>
        <b>{item.name}</b>
        <span className="chip-input">{truncate(item.inputPreview, 90)}</span>
      </button>
      {open && (
        <pre className="chip-result">{item.resultPreview != null ? item.resultPreview : '(no result yet)'}</pre>
      )}
    </div>
  );
}
