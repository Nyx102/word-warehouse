import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { StatusInfo } from '@/lib/types';

/** Poll /api/status every 10s; pauses while the browser tab is hidden.
 * Keeps the {status, refresh} shape so App and the drilled `status` prop to
 * ModeLine/StatusSheet stay untouched. */
export function useStatus(): { status: StatusInfo | null; refresh: () => void } {
  const q = useQuery({
    queryKey: ['status'],
    queryFn: () => api<StatusInfo>('/api/status', { silent: true }),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false, // pauses while the tab is hidden
    retry: false,
  });
  return { status: q.data ?? null, refresh: () => void q.refetch() };
}
