import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Thread } from '@/lib/types';

/** The thread list. Order comes from the server (pinned first, then most
 * recently active); archived threads are included but never auto-selected.
 * Callable directly wherever the raw list is needed. */
export function useThreadsQuery() {
  return useQuery({
    queryKey: ['threads'],
    queryFn: () => api<{ threads: Thread[] }>('/api/threads').then((d) => d.threads || []),
  });
}
