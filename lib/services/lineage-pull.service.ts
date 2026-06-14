import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import type { LineageFragmentType } from '@prisma/client'

export interface FragmentPullInput {
  sessionId: string
  fragmentType: LineageFragmentType
  fragmentId: string
}

/**
 * Stamp pulledAt on the matching session-start edge when an agent pulls a
 * fragment's body on demand (LUM-500).
 *
 * The id is canonicalized BEFORE matching, mirroring the write path
 * (`lineageService.recordSessionStartEdges` keys edges by the canonical id).
 * The memory index displays the original (pre-consolidation) id, so a pull
 * arrives keyed by that original id; without this resolve the `where` clause
 * would match zero rows for consolidated memories and `pulledAt` would never
 * stamp — silently blinding the funnel for exactly those memories. Non-MEMORY
 * types resolve to identity, so applying it uniformly is correct.
 */
export async function recordFragmentPull(
  input: FragmentPullInput
): Promise<number> {
  const canonicalId = await memoryProvenanceRepository.resolveCanonicalFragment(
    input.fragmentType,
    input.fragmentId
  )
  return lineageEdgeRepository.recordPull(
    {
      sessionId: input.sessionId,
      fragmentType: input.fragmentType,
      fragmentId: canonicalId,
    },
    new Date()
  )
}
