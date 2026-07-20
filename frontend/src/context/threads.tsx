import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { truncate } from '@/lib/util';
import { useThreadsQuery } from '@/features/chat/useThreadsQuery';
import type { ChatEventPayload, ModelName, Thread, ThreadId, ThreadMessage } from '@/lib/types';

interface ThreadsContextValue {
  threads: Thread[];
  selectedId: ThreadId | null;
  selected: Thread | null;
  select: (id: ThreadId | null) => void;
  /** Model the next-created thread will use, chosen in the picker before any
   * thread exists (there's nothing to PATCH yet). */
  draftModel: ModelName;
  setDraftModel: (m: ModelName) => void;
  setLocalTitle: (id: ThreadId, text: string) => void;
  label: (t: Thread) => string;
}

const ThreadsContext = createContext<ThreadsContextValue | null>(null);

/** Client-side thread state shared across the sidebar, the chat dock and the
 * chat panel: current selection, the draft model for the next thread, and
 * locally-known titles. The server list comes from react-query
 * (useThreadsQuery); this provider layers on the selection/title logic that
 * used to live in the hand-rolled threads hook, replacing its prop-drill. */
export function ThreadsProvider({ children }: { children: ReactNode }) {
  const threadsQ = useThreadsQuery();
  const threads = threadsQ.data ?? [];

  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  // Model for the next thread; sonnet mirrors the backend's null-model default
  const [draftModel, setDraftModel] = useState<ModelName>('sonnet');
  // Titles set locally (e.g. from the first message typed) before the server
  // has one; take precedence over the message-derived title below.
  const [localTitles, setLocalTitles] = useState<Record<string, string>>({});

  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  // Keep selection valid; auto-select skips archived threads. Runs whenever the
  // list changes (a fetch/invalidation), mirroring the old reload()-time check.
  useEffect(() => {
    const cur = selectedRef.current;
    if (cur == null || !threads.some((t) => t.id === cur)) {
      const first = threads.find((t) => !t.archived);
      setSelectedId(first ? first.id : null);
    }
  }, [threads]);

  // Derive a title from each untitled thread's first user message via
  // ['messages', tid] queries. This shares the /messages endpoint with the
  // chat-replay stream but not its cache — distinct purposes, parity with the
  // old per-thread fetch.
  const untitled = threads.filter((t) => !t.title && !localTitles[String(t.id)]);
  const titleQs = useQueries({
    queries: untitled.map((t) => ({
      queryKey: ['messages', t.id],
      queryFn: () =>
        api<{ messages: ThreadMessage[] }>(`/api/threads/${t.id}/messages`, { silent: true }),
      staleTime: Infinity, // a thread's first message never changes; derive once
    })),
  });
  const derived = new Map<string, string>();
  untitled.forEach((t, i) => {
    for (const msg of titleQs[i].data?.messages ?? []) {
      try {
        const p = JSON.parse(msg.content) as ChatEventPayload;
        if (p.kind === 'user_text' && p.text) {
          derived.set(String(t.id), truncate(p.text, 42));
          break;
        }
      } catch { /* unparsable row; keep looking */ }
    }
  });

  const setLocalTitle = useCallback((id: ThreadId, text: string) => {
    const k = String(id);
    setLocalTitles((m) => (m[k] ? m : { ...m, [k]: truncate(text, 42) }));
  }, []);

  // derived is rebuilt each render from cached query data; label is only read
  // during render, so recomputing per render is fine (no stable identity needed).
  const label = (t: Thread) =>
    t.title || localTitles[String(t.id)] || derived.get(String(t.id)) || 'Thread #' + t.id;

  const value: ThreadsContextValue = {
    threads,
    selectedId,
    selected: threads.find((t) => t.id === selectedId) ?? null,
    select: setSelectedId,
    draftModel,
    setDraftModel,
    setLocalTitle,
    label,
  };

  return <ThreadsContext.Provider value={value}>{children}</ThreadsContext.Provider>;
}

export function useThreadsContext(): ThreadsContextValue {
  const ctx = useContext(ThreadsContext);
  if (!ctx) throw new Error('useThreadsContext outside ThreadsProvider');
  return ctx;
}
