/**
 * LUM-910 — when a session record's raw payload is "used up" in USED_UP mode.
 * Pure (no Prisma, no I/O): the sweep feeds it what the repository read.
 *
 * Used up = nothing Lumo still has to do reads the raw text any more:
 *  - a DONE task, once its fragment-usage audit has voted (capped at
 *    USED_UP_AUDIT_WAIT_CAP_DAYS after DONE — the judge leaves undecidable
 *    edges unvoted forever);
 *  - a task that is not DONE but has had no agent activity for
 *    USED_UP_IDLE_DAYS;
 *  - a taskless session idle for USED_UP_IDLE_DAYS;
 *  - evidence of a boundary crossing, once the crossing is dispositioned.
 * The raw payload is dropped USED_UP_GRACE_DAYS after that moment.
 */
import {
  USED_UP_AUDIT_WAIT_CAP_DAYS,
  USED_UP_GRACE_DAYS,
  USED_UP_IDLE_DAYS,
} from '@/lib/hook-event/retention'

const DAY_MS = 24 * 60 * 60 * 1000

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/** Activity older than this means idle-and-past-grace: idle 30 days, then 7 more. */
export function usedUpIdleCutoff(now: Date): Date {
  return daysBefore(now, USED_UP_IDLE_DAYS + USED_UP_GRACE_DAYS)
}

/** DONE tasks changed after this instant may still be inside their grace or audit wait. */
export function recentlyDoneSince(now: Date): Date {
  return daysBefore(
    now,
    Math.max(USED_UP_GRACE_DAYS, USED_UP_AUDIT_WAIT_CAP_DAYS)
  )
}

export interface OpenTaskActivity {
  id: string
  lastActivityAt: Date | null
}

export interface RecentlyDoneTask {
  id: string
  doneAt: Date
  usageVotePending: boolean
}

/** Is a DONE task's raw payload still needed (or inside its grace) at `now`? */
export function isDoneTaskKept(task: RecentlyDoneTask, now: Date): boolean {
  if (task.doneAt > daysBefore(now, USED_UP_GRACE_DAYS)) return true
  return (
    task.usageVotePending &&
    task.doneAt > daysBefore(now, USED_UP_AUDIT_WAIT_CAP_DAYS)
  )
}

/** Is a not-DONE task's raw payload still needed (or inside its grace) at `now`? */
export function isOpenTaskKept(task: OpenTaskActivity, now: Date): boolean {
  // No activity at all: nothing of it to prune, keeping it costs nothing.
  if (!task.lastActivityAt) return true
  return task.lastActivityAt >= usedUpIdleCutoff(now)
}

/** Tasks whose events the used-up sweep must leave alone. */
export function usedUpKeepTaskIds(input: {
  openTasks: OpenTaskActivity[]
  recentlyDone: RecentlyDoneTask[]
  now: Date
}): string[] {
  const { openTasks, recentlyDone, now } = input
  return [
    ...openTasks.filter(t => isOpenTaskKept(t, now)).map(t => t.id),
    ...recentlyDone.filter(t => isDoneTaskKept(t, now)).map(t => t.id),
  ]
}

export interface CrossingRef {
  disposition: string | null
  dispositionedAt: Date | null
}

/**
 * Crossing evidence is released once EVERY crossing pointing at the event is
 * dispositioned and USED_UP_GRACE_DAYS have passed since. A crossing reopened
 * to OPEN has no disposition, so it holds the evidence again.
 */
export function isCrossingEvidenceReleased(
  refs: CrossingRef[],
  now: Date
): boolean {
  const cutoff = daysBefore(now, USED_UP_GRACE_DAYS)
  return refs.every(
    r =>
      r.disposition != null &&
      !!r.dispositionedAt &&
      r.dispositionedAt <= cutoff
  )
}
