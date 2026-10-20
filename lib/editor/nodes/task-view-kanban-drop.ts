import type { ApiStatus, ApiTask } from '@/app/workspace/[workspaceUrl]/types'

export const KANBAN_STATUSES: readonly ApiStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'CANCELED',
]

/**
 * Resolve the new status for a card dropped on a column. Pure (dnd-kit drag
 * itself isn't simulatable in jsdom, so the decision lives here, unit-tested).
 * Returns `null` for a no-op: dropping on the same column, or on an
 * unknown / null target.
 */
export function statusFromDropTarget(
  overId: string | null | undefined,
  currentStatus: string
): ApiStatus | null {
  if (!overId) return null
  if (!(KANBAN_STATUSES as readonly string[]).includes(overId)) return null
  if (overId === currentStatus) return null
  return overId as ApiStatus
}

/**
 * Deterministic within-column order so cards don't jump between renders /
 * refetches. Sorted by task number ascending. Pure — returns a new array,
 * never mutates the input.
 */
export function sortColumnTasks(tasks: ApiTask[]): ApiTask[] {
  return [...tasks].sort((a, b) => a.number - b.number)
}
