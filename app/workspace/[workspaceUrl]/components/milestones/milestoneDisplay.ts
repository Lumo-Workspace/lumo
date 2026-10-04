import type { ApiMilestone } from '@/lib/api-client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'

// A single ~7px dot is the one allowed colour signal (typography carries the
// rest of the hierarchy). Colour encodes the target-date health light —
// shared by the milestone card and the Overview rollup bar.
export const HEALTH_DOT: Record<MilestoneHealth, string> = {
  'on-track': 'bg-success-text',
  'at-risk': 'bg-warning-text',
  overdue: 'bg-danger',
}

/**
 * Delivery → list-row dot colour (LUM-714). The dot encodes whether the work
 * landed, not where the milestone is filed: a fully-delivered milestone reads
 * green even once archived, and the "archived while incomplete" case has its
 * own neutral branch in `milestoneDot` below.
 */
export const DELIVERY_DOT: Record<'active' | 'completed', string> = {
  active: 'bg-info',
  completed: 'bg-success-text',
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
 * Delivery is the base signal (the design's blue/green), but an at-risk or
 * overdue target date outranks it — "Overdue" is the fact a scanner needs, not
 * "Active". A dropped milestone (archived while incomplete) goes neutral so the
 * row recedes. Colour stays confined to this dot and the progress bar.
 *
 * LUM-714: `completed` is the derived `completedAt` stamp. Archived is
 * deliberately NOT the base signal here — an archived milestone that delivered
 * everything still reads green; only the archived-while-incomplete case (the
 * `stale` branch) recedes.
 */
export function milestoneDot(m: {
  completed: boolean
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
  const delivery = m.completed ? 'completed' : 'active'
  return {
    className: DELIVERY_DOT[delivery],
    labelId: `milestone.state.${delivery}`,
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
