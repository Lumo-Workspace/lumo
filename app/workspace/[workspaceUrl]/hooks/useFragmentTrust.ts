'use client'

import { useQuery } from '@tanstack/react-query'
import { lineageClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TrustVerdict } from '@/types/lineage'

/**
 * Batched, read-through per-memory trust verdicts (LUM-303). One request for
 * the whole visible memory list; `queryKeys.fragmentTrust` sorts the ids so the
 * cache is stable across re-renders regardless of memory order. Returns `{}`
 * (never throws) so a badge failure never blocks the memory tab. Disabled /
 * empty → no fetch.
 */
export function useFragmentTrust(
  ids: string[],
  enabled = true
): Record<string, TrustVerdict> {
  const query = useQuery<Record<string, TrustVerdict>>({
    queryKey: queryKeys.fragmentTrust(ids),
    queryFn: async () => (await lineageClient.fragmentTrust(ids)).trust,
    enabled: enabled && ids.length > 0,
  })
  return query.data ?? {}
}
