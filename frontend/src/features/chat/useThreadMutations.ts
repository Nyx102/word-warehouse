import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useThreadsContext } from '@/context/threads';
import type { ModelName, Thread, ThreadId } from '@/lib/types';

/** Thread mutations. create/remove drive the shared selection, setModel is
 * optimistic (patches the ['threads'] cache immediately, rolls back on error),
 * and every write invalidates ['threads'] so the server re-orders the list.
 * Must be called inside <ThreadsProvider> (it reads the selection state). */
export function useThreadMutations() {
  const qc = useQueryClient();
  const { select, selectedId, draftModel } = useThreadsContext();
  // Read the latest selection/draft inside the mutation callbacks without
  // making them depend on those values.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const draftRef = useRef(draftModel);
  draftRef.current = draftModel;

  const createMut = useMutation({
    mutationFn: async (): Promise<ThreadId> => {
      const r = await api<{ id: ThreadId }>('/api/threads', { method: 'POST', body: {} });
      // Apply the picker's draft model before anyone sends: the first turn reads
      // the thread's model at run time, and a null model would silently become
      // sonnet. Skip when it's already the default to avoid a needless PATCH.
      const m = draftRef.current;
      if (m && m !== 'sonnet') {
        await api(`/api/threads/${r.id}`, { method: 'PATCH', body: { model: m } })
          .catch(() => { /* non-fatal: falls back to sonnet */ });
      }
      return r.id;
    },
    onSuccess: async (id) => {
      select(id);
      await qc.invalidateQueries({ queryKey: ['threads'] });
      select(id); // the list refetch's selection-normalization must not steal it
    },
  });

  const removeMut = useMutation({
    mutationFn: (id: ThreadId) => api(`/api/threads/${id}`, { method: 'DELETE' }),
    onSuccess: async (_d, id) => {
      if (selectedRef.current === id) select(null);
      await qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const setModelMut = useMutation({
    mutationFn: (v: { id: ThreadId; model: ModelName }) =>
      api(`/api/threads/${v.id}`, { method: 'PATCH', body: { model: v.model } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['threads'] });
      const prev = qc.getQueryData<Thread[]>(['threads']);
      qc.setQueryData<Thread[]>(['threads'], (ts) =>
        (ts ?? []).map((t) => (t.id === v.id ? { ...t, model: v.model } : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['threads'], ctx.prev);
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['threads'] }); },
  });

  // Pin/archive/rename change server-side ordering, so refetch after the PATCH
  const patchMut = useMutation({
    mutationFn: (v: { id: ThreadId; body: Record<string, unknown> }) =>
      api(`/api/threads/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['threads'] }); },
  });

  return {
    create: (): Promise<ThreadId> => createMut.mutateAsync(),
    remove: (id: ThreadId): Promise<void> => removeMut.mutateAsync(id).then(() => {}),
    setModel: (id: ThreadId, model: ModelName): Promise<void> =>
      setModelMut.mutateAsync({ id, model }).then(() => {}),
    setPinned: (id: ThreadId, pinned: boolean): Promise<void> =>
      patchMut.mutateAsync({ id, body: { pinned: pinned ? 1 : 0 } }).then(() => {}),
    setArchived: (id: ThreadId, archived: boolean): Promise<void> =>
      patchMut.mutateAsync({ id, body: { archived: archived ? 1 : 0 } }).then(() => {}),
    rename: (id: ThreadId, title: string): Promise<void> =>
      patchMut.mutateAsync({ id, body: { title } }).then(() => {}),
  };
}
