import type { ApiStatus } from '../types'

export const API_STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
}

const BOARD_STATUSES: readonly ApiStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
]

/**
 * Status columns for a board (LUM-1057). BACKLOG is hidden by default and only
 * gets a leading column when at least one of the given tasks is in it.
 */
export function boardStatuses(
  tasks: ReadonlyArray<{ status: string }>
): ApiStatus[] {
  return tasks.some(t => t.status === 'BACKLOG')
    ? ['BACKLOG', ...BOARD_STATUSES]
    : [...BOARD_STATUSES]
}
