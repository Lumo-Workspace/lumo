import { QueryClient, isServer } from '@tanstack/react-query'
import { isClientRealtimeConfigured } from '@/lib/integrations/pusher/config'

/**
 * Polling cadence used only when realtime (Pusher/Soketi) is not configured.
 * Normally Pusher events patch or invalidate caches, so queries don't poll;
 * without it, active queries refetch on window focus and every minute so other
 * people's changes still show up. Background tabs don't poll, and queries with
 * their own refetchInterval keep it.
 */
export const NO_REALTIME_REFETCH_INTERVAL_MS = 60_000

export function makeQueryClient(
  realtimeConfigured: boolean = isClientRealtimeConfigured()
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: !realtimeConfigured,
        refetchInterval: realtimeConfigured
          ? false
          : NO_REALTIME_REFETCH_INTERVAL_MS,
        refetchIntervalInBackground: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}

let browserClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient()
  if (!browserClient) browserClient = makeQueryClient()
  return browserClient
}
