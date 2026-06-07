import { LINEAGE_MIN_RESOLVED_TASKS } from '@/lib/services/lineage-signal'

/** Merge rate at or above this lands a sampled fragment in the high tier. 50%
 * inclusive: "merged more often than not". */
export const LINEAGE_RANK_HIGH_THRESHOLD = 0.5

/** 0 = high (top), 1 = cold/no-signal (middle), 2 = proven-low (bottom). */
export type LineageTier = 0 | 1 | 2

export interface LineageStat {
  resolvedTasks: number
  mergedTasks: number
}

/**
 * Bucket a fragment by its task-deduped merge stat. A fragment without enough
 * resolved tasks (or no stat at all) is "cold" — we don't promise intelligence
 * below the sample floor, so it stays in its original position (tier 1).
 */
export function tierOf(stat: LineageStat | undefined): LineageTier {
  if (!stat || stat.resolvedTasks < LINEAGE_MIN_RESOLVED_TASKS) return 1
  const rate = stat.mergedTasks / stat.resolvedTasks
  return rate >= LINEAGE_RANK_HIGH_THRESHOLD ? 0 : 2
}

/**
 * Stable three-tier reorder of a single section's cards. High-merge fragments
 * float to the top (so they survive the token budget), proven-low-merge sink to
 * the bottom (degraded to manifest first), and cold fragments keep their
 * incoming order in the middle. Within the high tier: merge% descending, then
 * evidence (resolvedTasks) descending. Index is the final tiebreak so cold/low
 * tiers and exact ties preserve input order regardless of sort stability.
 */
export function rankByLineage<T>(
  items: T[],
  keyOf: (item: T) => string,
  statByKey: Map<string, LineageStat>
): T[] {
  return items
    .map((item, index) => ({ item, index, stat: statByKey.get(keyOf(item)) }))
    .sort((a, b) => {
      const ta = tierOf(a.stat)
      const tb = tierOf(b.stat)
      if (ta !== tb) return ta - tb
      if (ta === 0) {
        // tier 0 guarantees both stats are defined with resolvedTasks >= floor.
        const sa = a.stat as LineageStat
        const sb = b.stat as LineageStat
        const ra = sa.mergedTasks / sa.resolvedTasks
        const rb = sb.mergedTasks / sb.resolvedTasks
        if (rb !== ra) return rb - ra
        if (sb.resolvedTasks !== sa.resolvedTasks)
          return sb.resolvedTasks - sa.resolvedTasks
      }
      return a.index - b.index
    })
    .map(d => d.item)
}
