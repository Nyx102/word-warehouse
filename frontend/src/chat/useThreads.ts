import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { truncate } from '../util';
import type { ChatEventPayload, ModelName, Thread, ThreadId, ThreadMessage } from '../types';

export interface ThreadsApi {
  threads: Thread[];
  selectedId: ThreadId | null;
  selected: Thread | null;
  select: (id: ThreadId) => void;
  create: () => Promise<ThreadId>;
  remove: (id: ThreadId) => Promise<void>;
  setModel: (id: ThreadId, model: ModelName) => Promise<void>;
  setPinned: (id: ThreadId, pinned: boolean) => Promise<void>;
  setArchived: (id: ThreadId, archived: boolean) => Promise<void>;
  rename: (id: ThreadId, title: string) => Promise<void>;
  setLocalTitle: (id: ThreadId, text: string) => void;
  reload: () => Promise<void>;
  label: (t: Thread) => string;
}

/** Owns the thread list + selection. Lives in App so the sidebar, the chat
 * drawer and the chat panel all share one copy. List order comes from the
 * server (pinned first, then most recently active); archived threads are
 * included but never auto-selected. */
export function useThreads(): ThreadsApi {
  const [threads, setThreads] = useState<Thread[]>([]);
  // thread id -> title derived from its first user message (null = fetch in flight)
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const [selectedId, setSelectedId] = useState<ThreadId | null>(null);
  const titlesRef = useRef(titles);
  titlesRef.current = titles;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const fetchMissingTitles = useCallback((list: Thread[]) => {
    for (const t of list) {
      const k = String(t.id);
      if (t.title || titlesRef.current[k] !== undefined) continue;
      titlesRef.current = { ...titlesRef.current, [k]: null }; // sentinel: in flight
      setTitles((m) => ({ ...m, [k]: null }));
      api<{ messages: ThreadMessage[] }>(`/api/threads/${t.id}/messages`, { silent: true })
        .then((d) => {
          for (const msg of d.messages || []) {
            try {
              const p = JSON.parse(msg.content) as ChatEventPayload;
              if (p.kind === 'user_text' && p.text) {
                setTitles((m) => ({ ...m, [k]: truncate(p.text as string, 42) }));
                return;
              }
            } catch {
              /* unparsable row; keep looking */
            }
          }
        })
        .catch(() => {});
    }
  }, []);

  const reload = useCallback(async () => {
    const d = await api<{ threads: Thread[] }>('/api/threads');
    const list = d.threads || [];
    setThreads(list);
    fetchMissingTitles(list);
    // Keep selection valid; auto-select skips archived threads
    if (selectedRef.current == null || !list.some((t) => t.id === selectedRef.current)) {
      const first = list.find((t) => !t.archived);
      setSelectedId(first ? first.id : null);
    }
  }, [fetchMissingTitles]);

  useEffect(() => {
    reload().catch(() => { /* backend not up yet; toast already shown */ });
  }, [reload]);

  const create = useCallback(async (): Promise<ThreadId> => {
    const r = await api<{ id: ThreadId }>('/api/threads', { method: 'POST', body: {} });
    setSelectedId(r.id);
    await reload();
    setSelectedId(r.id);
    return r.id;
  }, [reload]);

  const remove = useCallback(async (id: ThreadId) => {
    await api(`/api/threads/${id}`, { method: 'DELETE' });
    if (selectedRef.current === id) setSelectedId(null);
    await reload();
  }, [reload]);

  const setModel = useCallback(async (id: ThreadId, model: ModelName) => {
    await api(`/api/threads/${id}`, { method: 'PATCH', body: { model } });
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, model } : t)));
  }, []);

  // Pin/archive/rename change server-side ordering, so refetch after the PATCH
  const patch = useCallback(async (id: ThreadId, body: Record<string, unknown>) => {
    await api(`/api/threads/${id}`, { method: 'PATCH', body });
    await reload();
  }, [reload]);

  const setPinned = useCallback((id: ThreadId, pinned: boolean) =>
    patch(id, { pinned: pinned ? 1 : 0 }), [patch]);

  const setArchived = useCallback((id: ThreadId, archived: boolean) =>
    patch(id, { archived: archived ? 1 : 0 }), [patch]);

  const rename = useCallback((id: ThreadId, title: string) =>
    patch(id, { title }), [patch]);

  const setLocalTitle = useCallback((id: ThreadId, text: string) => {
    const k = String(id);
    if (titlesRef.current[k]) return; // already have one
    const t = truncate(text, 42);
    titlesRef.current = { ...titlesRef.current, [k]: t };
    setTitles((m) => ({ ...m, [k]: t }));
  }, []);

  const label = useCallback(
    (t: Thread) => t.title || titles[String(t.id)] || 'Thread #' + t.id,
    [titles],
  );

  return {
    threads,
    selectedId,
    selected: threads.find((t) => t.id === selectedId) ?? null,
    select: setSelectedId,
    create,
    remove,
    setModel,
    setPinned,
    setArchived,
    rename,
    setLocalTitle,
    reload,
    label,
  };
}
