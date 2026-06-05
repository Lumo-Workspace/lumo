import type { ApiStatus } from '@/app/workspace/[workspaceUrl]/types'

export const KANBAN_STATUSES: readonly ApiStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
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
