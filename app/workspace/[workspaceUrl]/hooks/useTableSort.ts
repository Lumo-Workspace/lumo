import { useState } from 'react'
import { compareTaskPriority } from '@/lib/task/priority'

export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string> {
  key: K | null
  dir: SortDir
}

export function useTableSort<K extends string>(
  defaultKey?: K,
  defaultDir: SortDir = 'asc'
) {
  const [sort, setSort] = useState<SortState<K>>({
    key: defaultKey ?? null,
    dir: defaultDir,
  })

  function toggle(key: K) {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return { key: null, dir: 'asc' } // third click clears sort
    })
  }

  return { sort, toggle }
}

// ── Sort helpers ───────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  BACKLOG: 0,
  TODO: 1,
  IN_PROGRESS: 2,
  IN_REVIEW: 3,
  DONE: 4,
}

export function cmpStatus(a: string, b: string) {
  return (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99)
}

/**
 * URGENT > HIGH > MEDIUM > LOW > NONE (LUM-1284), unknown values last.
 *
 * With a direction, NONE ("not assessed") is pinned last in both directions,
 * matching the board/list `sortTasks`, and the result is already
 * direction-applied (do not pass it through `applyDir` again). Without one it
 * is the plain ascending comparator.
 */
export function cmpPriority(a: string, b: string, dir?: SortDir) {
  if (dir === undefined) return compareTaskPriority(a, b)
  const na = a === 'NONE'
  const nb = b === 'NONE'
  if (na && nb) return 0
  if (na) return 1
  if (nb) return -1
  return applyDir(compareTaskPriority(a, b), dir)
}

/**
 * Sort value for a data-table priority column: NONE maps to `undefined` so
 * the column's `sortUndefined: 'last'` keeps it last whichever way the column
 * is sorted (TanStack negates `sortingFn` for desc, so the comparator alone
 * cannot pin it).
 */
export function prioritySortValue(priority: string): string | undefined {
  return priority === 'NONE' ? undefined : priority
}

export function cmpString(a: string, b: string) {
  return a.localeCompare(b)
}

export function cmpDate(a: string, b: string) {
  return new Date(a).getTime() - new Date(b).getTime()
}

export function cmpNumber(a: number, b: number) {
  return a - b
}

export function applyDir(value: number, dir: SortDir) {
  return dir === 'asc' ? value : -value
}

// ── Shared sortable <th> renderer ──────────────────────────────────────────────
// Not a React component file — just exports the config type used by each table.

export interface ColDef<K extends string> {
  key: K
  label: string
  className?: string
}
