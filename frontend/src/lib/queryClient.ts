import { QueryClient } from '@tanstack/react-query';

/* Module-level singleton (not created in a component) so out-of-band code —
 * file saves that dirty the worktree, FS mutations — can call
 * queryClient.invalidateQueries directly, and so HMR/StrictMode don't spawn a
 * second client. */

/* retry:false is mandatory: api() (lib/api.ts) already toasts every failure,
 * so react-query's default retry:3 would fire 3-4 duplicate toasts per failed
 * request. staleTime keeps background refetches from hammering the backend on
 * every mount; refetchOnWindowFocus restores the manual window-focus resync
 * the hand-rolled hooks used to do. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});
