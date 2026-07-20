import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toasts';
import type { ChatEventPayload, ThreadId, ThreadMessage } from '@/lib/types';

/* Renderable chat items, produced by folding the event stream.
 * Ported from app/static/app.js: replay-then-stream, (turn,seq) dedupe,
 * pendingEcho suppression of the SSE echo for the optimistic user bubble. */

export type ChatItem =
  | { id: number; type: 'user'; text: string }
  | { id: number; type: 'assistant'; text: string }
  | { id: number; type: 'tool'; name: string; inputPreview: string; resultPreview: string | null; isError: boolean }
  | { id: number; type: 'result'; ok: boolean; durationS: number | null }
  | { id: number; type: 'error'; message: string };

export interface ChatStream {
  items: ChatItem[];
  turnActive: boolean;
  thinking: boolean;
  /** true once the replay for the current thread finished and SSE is open */
  ready: boolean;
  send: (text: string) => Promise<boolean>;
  stop: () => void;
}

interface Mut {
  items: ChatItem[];
  seen: Set<string>;        // "turn:seq" keys already applied
  openIdx: number | null;   // index of the open (accumulating) assistant block
  buf: string;              // accumulated markdown for the open block
  lastToolIdx: number | null;
  pendingEcho: string | null;
  turnActive: boolean;
  thinking: boolean;
  nextId: number;
}

const freshMut = (): Mut => ({
  items: [],
  seen: new Set(),
  openIdx: null,
  buf: '',
  lastToolIdx: null,
  pendingEcho: null,
  turnActive: false,
  thinking: false,
  nextId: 1,
});

type NoId<T> = T extends { id: number } ? Omit<T, 'id'> : never;

function pushItem(m: Mut, item: NoId<ChatItem>): number {
  m.items.push({ ...item, id: m.nextId++ } as ChatItem);
  return m.items.length - 1;
}

function closeBlock(m: Mut): void {
  m.openIdx = null;
  m.buf = '';
}

function ensureBlock(m: Mut): void {
  if (m.openIdx == null) {
    m.buf = '';
    m.openIdx = pushItem(m, { type: 'assistant', text: '' });
  }
}

function setBlockText(m: Mut): void {
  const i = m.openIdx;
  if (i == null) return;
  const it = m.items[i];
  if (it.type === 'assistant') m.items[i] = { ...it, text: m.buf };
}

function setTurn(m: Mut, on: boolean): void {
  m.turnActive = on;
  if (!on) m.thinking = false;
}

/* One chat event (live SSE or replayed message row).
 * meta: {turn, seq} fallbacks from the message row, plus replay flag. */
function handleEvent(m: Mut, p: ChatEventPayload, meta: { turn?: number; seq?: number; replay?: boolean }): void {
  const turn = p.turn != null ? p.turn : meta.turn;
  const seq = p.seq != null ? p.seq : meta.seq;
  if (turn != null && seq != null) {
    const key = turn + ':' + seq; // reconnects replay events; drop dupes
    if (m.seen.has(key)) return;
    m.seen.add(key);
  }
  if (p.kind !== 'thinking') m.thinking = false;
  switch (p.kind) {
    case 'user_text': {
      // Skip the SSE echo of the message we just rendered optimistically.
      if (!meta.replay && m.pendingEcho !== null && p.text === m.pendingEcho) {
        m.pendingEcho = null;
        return;
      }
      closeBlock(m);
      pushItem(m, { type: 'user', text: p.text ?? '' });
      break;
    }
    case 'init':
      closeBlock(m);
      if (!meta.replay) setTurn(m, true);
      break;
    case 'text_delta':
      ensureBlock(m);
      m.buf += p.text ?? '';
      setBlockText(m);
      if (!meta.replay) setTurn(m, true);
      break;
    case 'assistant_text':
      // Complete block: replaces whatever deltas accumulated for it.
      ensureBlock(m);
      m.buf = p.text ?? '';
      setBlockText(m);
      closeBlock(m);
      break;
    case 'tool_use':
      closeBlock(m);
      m.lastToolIdx = pushItem(m, {
        type: 'tool',
        name: p.name || 'tool',
        inputPreview: p.input_preview || '',
        resultPreview: null,
        isError: false,
      });
      if (!meta.replay) setTurn(m, true);
      break;
    case 'tool_result': {
      const i = m.lastToolIdx;
      if (i != null) {
        const it = m.items[i];
        if (it && it.type === 'tool') {
          m.items[i] = {
            ...it,
            resultPreview: p.preview == null ? '' : String(p.preview),
            isError: !!p.is_error,
          };
        }
      }
      break;
    }
    case 'thinking':
      if (!meta.replay) {
        m.thinking = true;
        setTurn(m, true);
      }
      break;
    case 'result':
      closeBlock(m);
      pushItem(m, {
        type: 'result',
        ok: !!p.ok,
        durationS: p.duration_s == null ? null : Number(p.duration_s),
      });
      setTurn(m, false);
      break;
    case 'error':
      closeBlock(m);
      pushItem(m, { type: 'error', message: p.message || 'error' });
      if (!meta.replay) toast(p.message || 'Chat error', 'error');
      break;
    case 'done':
      setTurn(m, false);
      break;
    default:
      break; // unknown kinds: ignore
  }
}

export function useChatStream(threadId: ThreadId | null): ChatStream {
  const mut = useRef<Mut>(freshMut());
  const esRef = useRef<EventSource | null>(null);
  const readyRef = useRef(false);
  const threadRef = useRef<ThreadId | null>(threadId);
  threadRef.current = threadId;

  const [snap, setSnap] = useState<{ items: ChatItem[]; turnActive: boolean; thinking: boolean; ready: boolean }>(
    { items: [], turnActive: false, thinking: false, ready: false },
  );

  const commit = useCallback(() => {
    const m = mut.current;
    setSnap({ items: m.items.slice(), turnActive: m.turnActive, thinking: m.thinking, ready: readyRef.current });
  }, []);

  useEffect(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    mut.current = freshMut();
    readyRef.current = false;
    commit();
    if (threadId == null) return;
    let cancelled = false;

    void (async () => {
      try {
        const d = await api<{ messages: ThreadMessage[] }>(`/api/threads/${threadId}/messages`);
        if (cancelled) return;
        const m = mut.current;
        for (const row of d.messages || []) {
          let p: ChatEventPayload;
          try { p = JSON.parse(row.content) as ChatEventPayload; } catch { continue; }
          handleEvent(m, p, { turn: row.turn, seq: row.seq, replay: true });
        }
        closeBlock(m);
        setTurn(m, false); // live SSE events re-arm if a turn is still running
      } catch {
        /* toast already shown by api() */
      } finally {
        if (!cancelled) {
          readyRef.current = true;
          // EventSource auto-reconnects; a reconnect replays the active turn
          // and the (turn,seq) dedupe absorbs the duplicates.
          const es = new EventSource(`/api/threads/${threadId}/stream`);
          esRef.current = es;
          es.onmessage = (ev) => {
            let p: ChatEventPayload;
            try { p = JSON.parse(ev.data as string) as ChatEventPayload; } catch { return; }
            if (threadRef.current === threadId) {
              handleEvent(mut.current, p, {});
              commit();
            }
          };
          commit();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [threadId, commit]);

  const send = useCallback(async (text: string): Promise<boolean> => {
    const tid = threadRef.current;
    const m = mut.current;
    if (tid == null || m.turnActive || !text.trim()) return false;
    // Optimistic bubble; the SSE echo is suppressed via pendingEcho.
    closeBlock(m);
    pushItem(m, { type: 'user', text });
    m.pendingEcho = text;
    setTurn(m, true);
    commit();
    try {
      await api(`/api/threads/${tid}/message`, { method: 'POST', body: { text } });
      return true;
    } catch {
      // 409 (turn already running) or network error: toast shown by api()
      const mm = mut.current;
      mm.pendingEcho = null;
      setTurn(mm, false);
      commit();
      return false;
    }
  }, [commit]);

  const stop = useCallback(() => {
    const tid = threadRef.current;
    if (tid == null) return;
    api(`/api/threads/${tid}/interrupt`, { method: 'POST', body: {} }).catch(() => {});
  }, []);

  return { items: snap.items, turnActive: snap.turnActive, thinking: snap.thinking, ready: snap.ready, send, stop };
}
