'use client'

import { useQuery } from '@tanstack/react-query'
import { lineageClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TrustVerdict } from '@/types/lineage'

/**
 * Batched, read-through per-memory trust verdicts (LUM-303). One request for
 * the whole visible memory list; ids are sorted into the query key so the cache
 * is stable across re-renders. Returns `{}` (never throws) so a badge failure
 * never blocks the memory tab. Disabled / empty → no fetch.
 */
export function useFragmentTrust(
  ids: string[],
  enabled = true
): Record<string, TrustVerdict> {
  const sorted = [...ids].sort()
  const query = useQuery<Record<string, TrustVerdict>>({
    queryKey: queryKeys.fragmentTrust(sorted),
    queryFn: async () => (await lineageClient.fragmentTrust(sorted)).trust,
    enabled: enabled && sorted.length > 0,
  })
  return query.data ?? {}
}
