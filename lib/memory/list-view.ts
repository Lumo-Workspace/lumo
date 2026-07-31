import type { MemoryCategory } from '@prisma/client'
import { memoryContentToText } from './content-text'

/**
 * Client-side view model for a memory list: search, category filter, sort.
 *
 * Pure and UI-free so the three controls can be reasoned about (and tested)
 * without a DOM. Everything runs in the browser over the already-fetched list —
 * the list endpoint takes no filter/sort params and a project's memory count is
 * in the hundreds at most.
 */

export const MEMORY_CATEGORIES = [
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
] as const satisfies readonly MemoryCategory[]

/** `ALL` is the unfiltered chip, not a category — a single-select, like Ideas. */
export type MemoryCategoryFilter = 'ALL' | MemoryCategory

/**
 * `recent` = last edited first. `used` = the lineage judged-used track record
 * (LUM-303/539), NOT a timestamp: memory rows carry no "last used at", so the
 * honest ordering signal is how many distinct tasks a memory was judged used
 * in. Memories with no verdict yet (cold start) sort as zero, after every
 * memory that has one.
 */
export type MemorySortKey = 'recent' | 'used'

/** The trust fields this module orders by — a structural subset of TrustVerdict. */
export interface MemoryUsage {
  judgedUsedTasks: number
  usefulnessPct: number
}

/** The fields the list view reads. Any MemoryRow satisfies it. */
export interface MemoryListRow {
  id: string
  category: MemoryCategory
  content: unknown
  updatedAt: string
}

/**
 * Substring match over everything a reader can see on the card — the title plus
 * every body field, procedural steps included. `memoryContentToText` is the
 * same flattening the neighbor-retrieval path uses, so "searchable" means one
 * thing in this codebase; it never throws on unparseable content.
 */
export function matchesQuery(row: MemoryListRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return memoryContentToText(row.category, row.content)
    .toLowerCase()
    .includes(q)
}

/** Per-category counts for the chip labels, over the *unfiltered* list. */
export function countByCategory(
  memories: readonly MemoryListRow[]
): Record<MemoryCategory, number> {
  const counts: Record<MemoryCategory, number> = {
    TRAP: 0,
    DECISION: 0,
    CONVENTION: 0,
    PROCEDURAL: 0,
  }
  for (const m of memories) counts[m.category] += 1
  return counts
}

interface SelectOptions {
  query: string
  category: MemoryCategoryFilter
  sort: MemorySortKey
  /** memoryId → trust verdict; missing = never judged. Only read for `used`. */
  usage?: Record<string, MemoryUsage | undefined>
}

/**
 * Filter (category, then search) and sort. The three controls compose: the
 * chip narrows the pool, the query narrows it further, the sort orders what is
 * left. Returns a new array; the input is never mutated.
 */
export function selectMemories<T extends MemoryListRow>(
  memories: readonly T[],
  { query, category, sort, usage = {} }: SelectOptions
): T[] {
  const filtered = memories.filter(
    m =>
      (category === 'ALL' || m.category === category) && matchesQuery(m, query)
  )

  const byRecent = (a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt)

  if (sort === 'recent') return filtered.sort(byRecent)

  return filtered.sort((a, b) => {
    const ua = usage[a.id]
    const ub = usage[b.id]
    const diff =
      (ub?.judgedUsedTasks ?? 0) - (ua?.judgedUsedTasks ?? 0) ||
      (ub?.usefulnessPct ?? 0) - (ua?.usefulnessPct ?? 0)
    // Equally-used memories fall back to recency, so the order is total and
    // stable rather than "whatever the fetch returned".
    return diff || byRecent(a, b)
  })
}
