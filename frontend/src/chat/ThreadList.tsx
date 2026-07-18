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
  setLocalTitle: (id: ThreadId, text: string) => void;
  reload: () => Promise<void>;
  label: (t: Thread) => string;
}

/** Owns the thread list + selection. Lives in App so the desktop sidebar,
 * the mobile drawer and the chat panel all share one copy. */
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
    const sorted = (d.threads || []).slice().sort((a, b) =>
      String(b.last_active || b.created_at || '').localeCompare(String(a.last_active || a.created_at || '')));
    setThreads(sorted);
    fetchMissingTitles(sorted);
    // keep selection valid; auto-select the most recent thread when none is
    if (selectedRef.current == null || !sorted.some((t) => t.id === selectedRef.current)) {
      setSelectedId(sorted.length ? sorted[0].id : null);
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

  const setLocalTitle = useCallback((id: ThreadId, text: string) => {
    const k = String(id);
    if (titlesRef.current[k]) return; // already have one
    const t = truncate(text, 42);
    titlesRef.current = { ...titlesRef.current, [k]: t };
    setTitles((m) => ({ ...m, [k]: t }));
  }, []);

  const label = useCallback((t: Thread) => t.title || titles[String(t.id)] || 'New thread', [titles]);

  return {
    threads,
    selectedId,
    selected: threads.find((t) => t.id === selectedId) ?? null,
    select: setSelectedId,
    create,
    remove,
    setModel,
    setLocalTitle,
    reload,
    label,
  };
}

export function ThreadList({ threadsApi, onAfterSelect }: {
  threadsApi: ThreadsApi;
  onAfterSelect?: () => void;
}) {
  return (
    <div className="thread-pane">
      <div className="thread-head">
        <span className="pane-title">Threads</span>
        <button
          className="btn btn-sm"
          title="New chat thread"
          onClick={() => { void threadsApi.create().then(() => onAfterSelect?.()).catch(() => {}); }}
        >+ New</button>
      </div>
      <ul className="thread-list">
        {threadsApi.threads.map((t) => (
          <li
            key={String(t.id)}
            className={'thread' + (t.id === threadsApi.selectedId ? ' active' : '')}
            onClick={() => { threadsApi.select(t.id); onAfterSelect?.(); }}
          >
            <span className="thread-title" title={threadsApi.label(t)}>{threadsApi.label(t)}</span>
            <button
              className="thread-del"
              title="Delete thread"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Delete this thread?')) void threadsApi.remove(t.id).catch(() => {});
              }}
            >×</button>
          </li>
        ))}
        {threadsApi.threads.length === 0 && <li className="empty">No threads yet.</li>}
      </ul>
    </div>
  );
}
