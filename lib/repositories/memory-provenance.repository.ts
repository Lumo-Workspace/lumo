import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/**
 * Provenance side-table access for Layer-2 consolidation lineage (LUM-280).
 * `fragmentId` in LineageEdge stays = cuid; canonical identity is resolved
 * here by walking the parent→child promotion chain.
 */

/** Safety cap so corrupt/cyclic provenance can never loop unbounded. */
const MAX_RESOLVE_DEPTH = 16

/**
 * Find the PROJECT memory that a given (parent) memory was promoted into.
 * If a parent was cited by more than one consolidation, the most recent
 * child wins — deterministic and good enough for v1 (re-citation is rare:
 * promotion requires recurrence + dedup). Returns null when the memory was
 * never a consolidation source (it is already canonical).
 */
async function queryChildMemoryId(
  parentMemoryId: string
): Promise<string | null> {
  const row = await prisma.memoryProvenance.findFirst({
    where: { parentMemoryId },
    orderBy: { createdAt: 'desc' },
    select: { childMemoryId: true },
  })
  return row?.childMemoryId ?? null
}

export const memoryProvenanceRepository = {
  /**
   * Record that `childMemoryId` (a promoted PROJECT memory) was synthesized
   * from `parentMemoryIds` (source TASK memories). No-op on empty input.
   * `skipDuplicates` makes re-runs idempotent against the unique index.
   */
  async createMany(
    childMemoryId: string,
    parentMemoryIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    if (parentMemoryIds.length === 0) return
    const client = tx ?? prisma
    await client.memoryProvenance.createMany({
      data: parentMemoryIds.map(parentMemoryId => ({
        childMemoryId,
        parentMemoryId,
      })),
      skipDuplicates: true,
    })
  },

  /**
   * Resolve a fragment to its canonical id. Non-MEMORY types are identity
   * (their cuid is stable for life). MEMORY walks the promotion chain so an
   * edge keyed by a pre-consolidation TASK cuid rolls up to the promoted
   * PROJECT cuid. Cycle- and depth-guarded.
   */
  async resolveCanonicalFragment(
    fragmentType: string,
    fragmentId: string
  ): Promise<string> {
    if (fragmentType !== 'MEMORY') return fragmentId
    let current = fragmentId
    const seen = new Set<string>([current])
    for (let i = 0; i < MAX_RESOLVE_DEPTH; i++) {
      const child = await queryChildMemoryId(current)
      if (!child || seen.has(child)) break
      seen.add(child)
      current = child
    }
    return current
  },
}
