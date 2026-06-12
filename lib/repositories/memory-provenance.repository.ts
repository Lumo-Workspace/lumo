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

  /**
   * Birth-task set per canonical MEMORY id, for same-task self-credit exclusion
   * (LUM-461). The birth task of a memory is `sourceTaskId ?? taskId` — the
   * column captured at creation, with `taskId` as the legacy proxy for
   * pre-LUM-397 / un-promoted TASK rows that never got a `sourceTaskId`.
   *
   * A canonicalized PROJECT-promoted memory has BOTH columns null (Layer-2
   * consolidation rows carry no single origin), so its birth set is recovered
   * by walking MemoryProvenance child→parent (the reverse of
   * `resolveCanonicalFragment`) to the source TASK rows it was synthesized from,
   * transitively, and unioning their births. Each requested id keeps its OWN
   * ancestor set — births are never pooled across the batch (that would
   * over-exclude legitimate cross-fragment credit). Cycle- and depth-guarded.
   *
   * Returns a map id → Set<taskId>; ids with no derivable birth are omitted.
   */
  async birthTaskIdsByMemory(
    memoryIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>()
    if (memoryIds.length === 0) return result
    const client = tx ?? prisma

    // 1. Reverse-walk provenance per root, batching one query per BFS level
    //    across all still-expanding roots. `ancestorsByRoot` keeps each root's
    //    own ancestor closure so birth sets stay root-scoped.
    const ancestorsByRoot = new Map<string, Set<string>>(
      memoryIds.map(id => [id, new Set<string>()])
    )
    const allIds = new Set<string>(memoryIds)
    // frontier carries (root, node) pairs; `seen` is per-root to break cycles.
    let frontier = memoryIds.map(id => ({ root: id, node: id }))
    const seenByRoot = new Map<string, Set<string>>(
      memoryIds.map(id => [id, new Set<string>([id])])
    )
    for (
      let depth = 0;
      depth < MAX_RESOLVE_DEPTH && frontier.length > 0;
      depth++
    ) {
      const childIds = [...new Set(frontier.map(f => f.node))]
      const rows = await client.memoryProvenance.findMany({
        where: { childMemoryId: { in: childIds } },
        select: { childMemoryId: true, parentMemoryId: true },
      })
      const parentsByChild = new Map<string, string[]>()
      for (const r of rows) {
        const list = parentsByChild.get(r.childMemoryId) ?? []
        list.push(r.parentMemoryId)
        parentsByChild.set(r.childMemoryId, list)
      }
      const next: { root: string; node: string }[] = []
      for (const { root, node } of frontier) {
        const seen = seenByRoot.get(root)!
        for (const parent of parentsByChild.get(node) ?? []) {
          if (seen.has(parent)) continue
          seen.add(parent)
          ancestorsByRoot.get(root)!.add(parent)
          allIds.add(parent)
          next.push({ root, node: parent })
        }
      }
      frontier = next
    }

    // 2. One birth lookup over every involved memory (roots + ancestors).
    const memRows = await client.memory.findMany({
      where: { id: { in: [...allIds] } },
      select: { id: true, sourceTaskId: true, taskId: true },
    })
    const birthOf = new Map<string, string | null>()
    for (const m of memRows) birthOf.set(m.id, m.sourceTaskId ?? m.taskId)

    // 3. Assemble each root's birth set: own birth ∪ ancestors' births.
    for (const root of memoryIds) {
      const set = new Set<string>()
      const own = birthOf.get(root)
      if (own) set.add(own)
      for (const ancestor of ancestorsByRoot.get(root) ?? []) {
        const b = birthOf.get(ancestor)
        if (b) set.add(b)
      }
      if (set.size > 0) result.set(root, set)
    }
    return result
  },
}
