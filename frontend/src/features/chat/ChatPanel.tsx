import { useEffect, useRef, useState } from 'react';
import { useChatStream } from '@/hooks/useChatStream';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { ThreadsSidebar } from '@/components/sidebars/ThreadsSidebar';
import { useThreadsContext } from '@/context/threads';
import { useThreadMutations } from './useThreadMutations';
import type { ModelName } from '@/lib/types';

/** Body of the chat dock: model picker header, message stream, composer.
 * The thread title lives in the dock bar (ChatDock); below 1024px a drawer
 * button opens the full thread manager inside the panel. */
export function ChatPanel({ onTurnActiveChange }: {
  onTurnActiveChange: (on: boolean) => void;
}) {
  const threads = useThreadsContext();
  const mut = useThreadMutations();
  const stream = useChatStream(threads.selectedId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // message typed before its (new) thread existed; sent once the stream is ready
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    onTurnActiveChange(stream.turnActive);
  }, [stream.turnActive, onTurnActiveChange]);

  useEffect(() => {
    if (stream.ready && pendingRef.current != null && threads.selectedId != null) {
      const text = pendingRef.current;
      pendingRef.current = null;
      threads.setLocalTitle(threads.selectedId, text);
      void stream.send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.ready, threads.selectedId]);

  const handleSend = async (text: string) => {
    if (threads.selectedId == null) {
      pendingRef.current = text;
      try {
        await mut.create();
      } catch {
        pendingRef.current = null; // toast already shown
      }
      return;
    }
    threads.setLocalTitle(threads.selectedId, text);
    await stream.send(text);
  };

  const selected = threads.selected;
  // A selected thread's model (null -> app default), else the draft model that
  // the next thread will be created with.
  const modelValue: ModelName = selected ? (selected.model || 'sonnet') : threads.draftModel;

  const changeModel = (m: ModelName) => {
    if (selected) void mut.setModel(selected.id, m).catch(() => {});
    else threads.setDraftModel(m);
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <button className="btn btn-sm drawer-btn" onClick={() => setDrawerOpen(true)} title="Threads">
          ☰ Threads
        </button>
      </div>
      <MessageList
        key={String(threads.selectedId ?? 'none')}
        items={stream.items}
        thinking={stream.thinking}
      />
      <Composer
        turnActive={stream.turnActive}
        model={modelValue}
        onModelChange={changeModel}
        onSend={(t) => void handleSend(t)}
        onStop={stream.stop}
      />
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setDrawerOpen(false); }}
        >
          <div className="drawer">
            <ThreadsSidebar onAfterSelect={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
