import { useState } from 'react'

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

const PRIORITY_ORDER: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
}

export function cmpStatus(a: string, b: string) {
  return (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99)
}

export function cmpPriority(a: string, b: string) {
  return (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99)
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
