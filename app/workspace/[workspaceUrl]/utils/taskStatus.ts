import type { ApiStatus } from '../types'

/**
 * English status names, also used as the ordered status key list. For
 * anything rendered to the user, use `statusLabel` (localized) instead.
 */
export const API_STATUS_LABEL: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
  CANCELED: 'Canceled',
}

/** react-intl message ids for task-status labels (present in every locale). */
export const STATUS_LABEL_ID: Record<string, string> = {
  BACKLOG: 'status.backlog',
  TODO: 'status.todo',
  IN_PROGRESS: 'status.inProgress',
  IN_REVIEW: 'status.inReview',
  DONE: 'status.done',
  CANCELED: 'status.canceled',
}

/** The slice of react-intl's `IntlShape` that `statusLabel` needs. */
export interface StatusLabelIntl {
  formatMessage: (descriptor: { id: string }) => string
}

/** Localized label for a task status; unknown values echo back unchanged. */
export function statusLabel(intl: StatusLabelIntl, status: string): string {
  const id = STATUS_LABEL_ID[status]
  return id ? intl.formatMessage({ id }) : status
}

const BOARD_STATUSES: readonly ApiStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
]

/**
 * Status columns for a board (LUM-1057). BACKLOG is hidden by default and only
 * gets a leading column when at least one of the given tasks is in it;
 * CANCELED likewise gets a trailing column only when a task is in it
 * (LUM-1282).
 */
export function boardStatuses(
  tasks: ReadonlyArray<{ status: string }>
): ApiStatus[] {
  const has = (status: ApiStatus) => tasks.some(t => t.status === status)
  return [
    ...(has('BACKLOG') ? (['BACKLOG'] as const) : []),
    ...BOARD_STATUSES,
    ...(has('CANCELED') ? (['CANCELED'] as const) : []),
  ]
}
