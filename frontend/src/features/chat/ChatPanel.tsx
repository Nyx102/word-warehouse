import { useEffect, useRef, useState } from 'react';
import { useChatStream } from '@/hooks/useChatStream';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { ModelPicker } from './ModelPicker';
import { ThreadsSidebar } from '@/components/sidebars/ThreadsSidebar';
import type { ThreadsApi } from './useThreads';
import type { ModelName } from '@/lib/types';

/** Body of the chat dock: model picker header, message stream, composer.
 * The thread title lives in the dock bar (ChatDock); below 1024px a drawer
 * button opens the full thread manager inside the panel. */
export function ChatPanel({ threadsApi, onTurnActiveChange }: {
  threadsApi: ThreadsApi;
  onTurnActiveChange: (on: boolean) => void;
}) {
  const stream = useChatStream(threadsApi.selectedId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // message typed before its (new) thread existed; sent once the stream is ready
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    onTurnActiveChange(stream.turnActive);
  }, [stream.turnActive, onTurnActiveChange]);

  useEffect(() => {
    if (stream.ready && pendingRef.current != null && threadsApi.selectedId != null) {
      const text = pendingRef.current;
      pendingRef.current = null;
      threadsApi.setLocalTitle(threadsApi.selectedId, text);
      void stream.send(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.ready, threadsApi.selectedId]);

  const handleSend = async (text: string) => {
    if (threadsApi.selectedId == null) {
      pendingRef.current = text;
      try {
        await threadsApi.create();
      } catch {
        pendingRef.current = null; // toast already shown
      }
      return;
    }
    threadsApi.setLocalTitle(threadsApi.selectedId, text);
    await stream.send(text);
  };

  const selected = threadsApi.selected;
  // A selected thread's model (null -> app default), else the draft model that
  // the next thread will be created with.
  const modelValue: ModelName = selected ? (selected.model || 'sonnet') : threadsApi.draftModel;

  const changeModel = (m: ModelName) => {
    if (selected) void threadsApi.setModel(selected.id, m).catch(() => {});
    else threadsApi.setDraftModel(m);
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <button className="btn btn-sm drawer-btn" onClick={() => setDrawerOpen(true)} title="Threads">
          ☰ Threads
        </button>
        <ModelPicker value={modelValue} disabled={stream.turnActive} onChange={changeModel} />
      </div>
      <MessageList
        key={String(threadsApi.selectedId ?? 'none')}
        items={stream.items}
        thinking={stream.thinking}
      />
      <Composer turnActive={stream.turnActive} onSend={(t) => void handleSend(t)} onStop={stream.stop} />
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setDrawerOpen(false); }}
        >
          <div className="drawer">
            <ThreadsSidebar threadsApi={threadsApi} onAfterSelect={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
