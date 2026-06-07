import type { MilestoneStatus } from '@prisma/client'
import type { ApiMilestone } from '@/lib/api-client'

/** Milestone status values in display order — shared by the sidebar editor and the form dialog. */
export const MILESTONE_STATUSES: MilestoneStatus[] = [
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
]

/** Status → badge color classes, shared by milestone card and detail rail. */
export const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-muted text-foreground',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-muted text-muted-foreground',
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
