import { isClosedTaskStatus } from '@/lib/task/status-semantics'

export type CompletedFilter =
  | 'all'
  | 'past_day'
  | 'past_week'
  | 'past_month'
  | 'none'

export const COMPLETED_FILTER_LABELS: Record<CompletedFilter, string> = {
  all: 'All',
  past_day: 'Past day',
  past_week: 'Past week',
  past_month: 'Past month',
  none: 'None',
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const FILTER_WINDOW_MS: Partial<Record<CompletedFilter, number>> = {
  past_day: MS_PER_DAY,
  past_week: 7 * MS_PER_DAY,
  past_month: 30 * MS_PER_DAY,
}

/**
 * Filter closed tasks (DONE, and CANCELED since LUM-1282) based on how
 * recently they were updated. Open tasks are always kept.
 */
export function filterCompletedTasks<
  T extends { status: string; updatedAt: string },
>(tasks: T[], filter: CompletedFilter): T[] {
  if (filter === 'all') return tasks
  if (filter === 'none') return tasks.filter(t => !isClosedTaskStatus(t.status))

  const windowMs = FILTER_WINDOW_MS[filter]
  if (!windowMs) return tasks

  const cutoff = Date.now() - windowMs
  return tasks.filter(
    t =>
      !isClosedTaskStatus(t.status) || new Date(t.updatedAt).getTime() >= cutoff
  )
}
