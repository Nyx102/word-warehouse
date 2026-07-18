import { useEffect, useRef, useState } from 'react';
import { useChatStream } from '../hooks/useChatStream';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { ModelPicker } from './ModelPicker';
import { ThreadList, type ThreadsApi } from './ThreadList';
import type { ModelName } from '../types';

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

  const changeModel = (m: ModelName) => {
    if (selected) void threadsApi.setModel(selected.id, m).catch(() => {});
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <button className="btn btn-sm drawer-btn" onClick={() => setDrawerOpen(true)} title="Threads">
          ☰ Threads
        </button>
        <span className="chat-title" title={selected ? threadsApi.label(selected) : ''}>
          {selected ? threadsApi.label(selected) : 'No thread — send a message to start one'}
        </span>
        <ModelPicker thread={selected} disabled={stream.turnActive} onChange={changeModel} />
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
            <ThreadList threadsApi={threadsApi} onAfterSelect={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
