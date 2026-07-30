import type { MilestoneStatus } from '@prisma/client'
import type { ApiMilestone } from '@/lib/api-client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'

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

// A single ~7px dot is the one allowed colour signal (typography carries the
// rest of the hierarchy). Colour encodes the target-date health light —
// shared by the milestone card and the Overview rollup bar.
export const HEALTH_DOT: Record<MilestoneHealth, string> = {
  'on-track': 'bg-emerald-500',
  'at-risk': 'bg-amber-500',
  overdue: 'bg-red-500',
}

/** Status → list-row dot colour. PLANNED and CANCELLED read as "not running". */
export const STATUS_DOT: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-muted-foreground/40',
  ACTIVE: 'bg-info',
  COMPLETED: 'bg-success',
  CANCELLED: 'bg-muted-foreground/40',
}

/** Tasks under the milestone, summed over the four statuses the server counts. */
export function milestoneProgress(m: ApiMilestone): {
  done: number
  total: number
} {
  const c = m.taskCounts
  const done = c?.DONE ?? 0
  return {
    done,
    total: (c?.TODO ?? 0) + (c?.IN_PROGRESS ?? 0) + (c?.IN_REVIEW ?? 0) + done,
  }
}

/**
 * Whether flipping this milestone's archive state should ask first. Only one
 * direction can lose work from view: archiving a milestone that still has open
 * tasks. Unarchiving, and archiving a finished milestone, apply straight away.
 */
export function archiveNeedsConfirm(m: ApiMilestone): boolean {
  if (m.archivedAt) return false
  const { done, total } = milestoneProgress(m)
  return !(total > 0 && done === total)
}

/**
 * Archived before every task landed — the milestone was dropped, not delivered.
 * The list greys such a row out and tags it, so a full Archived tab doesn't read
 * as a wall of completed work.
 */
export function isArchivedIncomplete(
  archived: boolean,
  done: number,
  total: number
): boolean {
  return archived && !(total > 0 && done === total)
}

/**
 * The one dot on a milestone list row: colour + the label it announces.
 *
 * Status is the base signal (the design's blue/green/grey), but an at-risk or
 * overdue target date outranks it — "Overdue" is the fact a scanner needs, not
 * "Active". A dropped milestone (archived while incomplete) goes neutral so the
 * row recedes. Colour stays confined to this dot and the progress bar.
 */
export function milestoneDot(m: {
  status: ApiMilestone['status']
  health: MilestoneHealth | null | undefined
  stale: boolean
}): { className: string; labelId: string } {
  if (m.stale)
    return {
      className: 'bg-muted-foreground/30',
      labelId: 'milestone.list.archivedIncomplete',
    }
  if (m.health === 'overdue' || m.health === 'at-risk')
    return {
      className: HEALTH_DOT[m.health],
      labelId: `milestone.health.${m.health}`,
    }
  return {
    className: STATUS_DOT[m.status],
    labelId: `milestone.status.${m.status}`,
  }
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
