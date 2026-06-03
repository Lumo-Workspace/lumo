import type { ApiMilestone } from '@/lib/api-client'

/** Status → badge color classes, shared by milestone card and detail rail. */
export const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
}

// Milestone start/target dates are calendar dates stored at UTC midnight —
// format in UTC so the displayed day matches what was entered, regardless of
// the viewer's time zone.
export const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}
