import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { teamRepository } from '@/lib/repositories/team.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { sprintSummaryService } from '@/lib/services/sprint-summary.service'
import { dispatchSprintNotification } from '@/lib/services/sprint-notifications.service'
import {
  calendarDayKey,
  computeNextSprintWindow,
} from '@/lib/services/sprint-date'
import { isPrismaUniqueViolation } from '@/lib/db/errors'
import type { SprintCloseDecisions } from '@/lib/repositories/sprint.repository'

// Re-export for backward compatibility
export { nextUtcMondayMidnight, addDays } from '@/lib/services/sprint-date'
export type {
  SpilloverDecision,
  SprintCloseDecisions,
} from '@/lib/repositories/sprint.repository'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

/** Actor used for automated (cron / lazy reconcile) state transitions — no
 *  human member, so notifications are attributed to the system. */
const SYSTEM_ACTOR: ActorRef & { id?: string } = { memberId: null }

/**
 * A reconcile transition raced another caller (or the sprint vanished). These
 * surface as httpErrors with a 4xx status (409 contention, 404 missing, 400
 * stale decision set) and are safe to swallow — the next reconcile converges.
 * Anything else (DB failure, bug) must propagate.
 */
function isReconcileRace(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status
  return typeof status === 'number' && status >= 400 && status < 500
}

export interface CreateDraftInput {
  name?: string
  startDate?: Date
  endDate?: Date
}

/** Minimal actor reference — the caller must have at least a memberId. */
export interface ActorRef {
  memberId: string | null
}

export const sprintService = {
  async createDraft(teamId: string, input: CreateDraftInput, _actor: ActorRef) {
    const team = await teamRepository.findSprintGatingConfig(teamId)
    if (!team) httpError(404, 'team not found')
    if (!team.sprintsEnabled) httpError(409, 'sprints not enabled for team')

    if (!input.startDate || !input.endDate) {
      httpError(400, 'startDate and endDate are required')
    }

    const number = await sprintRepository.nextNumberForTeam(teamId)
    const name = input.name?.trim() || `Sprint ${number}`

    return sprintRepository.create({
      teamId,
      number,
      name,
      startDate: input.startDate,
      endDate: input.endDate,
    })
  },

  async start(sprintId: string, actor: ActorRef & { id?: string }) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const started = await sprintRepository.startAtomically(sprintId)

    dispatchSprintNotification(
      sprintId,
      sprint.teamId,
      sprint.team.workspaceId,
      'SPRINT_STARTED',
      actor.id ?? null
    ).catch(err => void err)

    return started
  },

  async close(
    sprintId: string,
    decisions: SprintCloseDecisions,
    actor: ActorRef & { id?: string }
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const closed = await sprintRepository.closeAtomically(
      sprintId,
      decisions,
      actor.id ?? null
    )

    // Fire-and-forget: kick off retro generation without blocking the HTTP response.
    // The GenerationJob created inside closeAtomically (status: 'pending') will be
    // updated to 'completed' or 'failed' by sprintSummaryService.generate.
    sprintSummaryService.generate(sprintId).catch(err => {
      void err
    })

    dispatchSprintNotification(
      sprintId,
      sprint.teamId,
      sprint.team.workspaceId,
      'SPRINT_CLOSED',
      actor.id ?? null
    ).catch(err => void err)

    return closed
  },

  /**
   * Roll a team's sprint state forward to `now`:
   *  - Close the ACTIVE sprint once its window has ended (today is past the
   *    inclusive `endDate` day), routing every unfinished task back to the
   *    backlog.
   *  - Activate the DRAFT sprint whose window currently contains today
   *    (`startDate <= today <= endDate`) when no sprint is ACTIVE.
   *
   * Both endpoints are inclusive calendar days, so the comparison runs on day
   * keys — an ACTIVE sprint survives the whole of its last day instead of
   * closing at the instant that day begins.
   *
   * Past DRAFT sprints that were never started (window already ended) are left
   * untouched — we don't retroactively run history. Idempotent and race-safe:
   * the underlying start/close transactions throw on contention and those 4xx
   * status errors are swallowed, so concurrent lazy (read-path) and cron calls
   * converge instead of crashing. Unexpected (non-4xx) errors propagate.
   *
   * Call opportunistically from sprint read paths and from the daily cron.
   */
  async reconcileSprintStates(teamId: string, now: Date = new Date()) {
    const today = calendarDayKey(now)
    const active = await sprintRepository.findActiveByTeam(teamId)
    if (active) {
      // Still within its window — single-active invariant means nothing else
      // can start, so there's nothing to do.
      if (calendarDayKey(active.endDate) >= today) return

      const unfinished = await taskRepository.listUnfinishedIdsBySprint(
        active.id
      )
      const decisions: SprintCloseDecisions = Object.fromEntries(
        unfinished.map(t => [t.id, 'backToBacklog' as const])
      )
      try {
        await sprintService.close(active.id, decisions, SYSTEM_ACTOR)
      } catch (err) {
        if (!isReconcileRace(err)) throw err
        // Someone else is closing/closed it — let the next reconcile finish.
        return
      }
    }

    // No sprint is active now → activate the DRAFT whose window contains `now`.
    const drafts = await sprintRepository.listByTeam(teamId, {
      status: 'DRAFT',
      limit: 100,
    })
    const candidate = drafts.find(
      s =>
        calendarDayKey(s.startDate) <= today &&
        today <= calendarDayKey(s.endDate)
    )
    if (!candidate) return
    try {
      await sprintService.start(candidate.id, SYSTEM_ACTOR)
    } catch (err) {
      if (!isReconcileRace(err)) throw err
    }
  },

  async addTaskToSprint(
    taskId: string,
    sprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintRepository.addTaskAtomically(
      taskId,
      sprintId,
      actor.id ?? null
    )
  },

  async removeTaskFromSprint(
    taskId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintRepository.removeTaskAtomically(taskId, actor.id ?? null)
  },

  async moveTaskBetweenSprints(
    taskId: string,
    toSprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintService.addTaskToSprint(taskId, toSprintId, actor)
  },

  /**
   * When a task transitions to DONE without any sprint binding, optionally pull
   * it into the team's currently ACTIVE sprint so the completed work counts
   * toward that sprint. Gated behind the team-level `sprintAutoAddCompleted`
   * toggle. Silent no-op when the team opted out, sprints are disabled, or no
   * sprint is currently active. Caller decides whether the task is sprintless.
   */
  async autoAddCompletedTaskToActiveSprint(
    teamId: string,
    taskId: string,
    actor: ActorRef & { id?: string }
  ) {
    const team = await teamRepository.findSprintAutoAddConfig(teamId)
    if (!team || !team.sprintsEnabled || !team.sprintAutoAddCompleted) return

    const active = await sprintRepository.findActiveByTeam(teamId)
    if (!active) return

    await sprintRepository.addTaskAtomically(
      taskId,
      active.id,
      actor.id ?? null
    )
  },

  /**
   * Update sprint metadata. Validates date ordering and checks that the new
   * date range doesn't overlap any other sprint on the same team. Two ranges
   * overlap iff `aStart <= bEnd && bStart <= aEnd` (endpoints inclusive).
   */
  async updateMeta(
    sprintId: string,
    input: { name?: string; startDate?: Date; endDate?: Date },
    _actor: ActorRef
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const newStart = input.startDate ?? sprint.startDate
    const newEnd = input.endDate ?? sprint.endDate
    if (newEnd <= newStart) {
      httpError(400, 'endDate must be after startDate')
    }

    if (input.startDate || input.endDate) {
      const others = await sprintRepository.listByTeam(sprint.teamId, {
        limit: 1000,
      })
      const overlap = others.find(
        s =>
          s.id !== sprintId &&
          new Date(s.startDate).getTime() <= new Date(newEnd).getTime() &&
          new Date(newStart).getTime() <= new Date(s.endDate).getTime()
      )
      if (overlap) {
        httpError(409, `dates overlap with sprint "${overlap.name}"`)
      }
    }

    return sprintRepository.update(sprintId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    })
  },

  async remove(sprintId: string, _actor: ActorRef) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    // Sprints are deletable in any state — the model is time-based, and the
    // Task FK uses onDelete: SetNull so any tasks still on the sprint simply
    // return to the backlog.
    await sprintRepository.remove(sprintId)
  },

  async configureCadence(
    teamId: string,
    input: {
      enabled: boolean
      durationDays?: number
      cooldownDays?: number
      startWeekday?: number
      autoCreate?: number
      autoAddCompleted?: boolean
    },
    _actor: ActorRef
  ) {
    return teamRepository.updateSprintCadence(teamId, input)
  },

  /**
   * Lazily top up future DRAFT sprints to match `team.sprintAutoCreate`.
   *
   * Call from read paths (e.g. sprint list GET) so the next N future sprints
   * always exist without needing a scheduled job. Counts any DRAFT or ACTIVE
   * sprint with `startDate >= now` toward the quota — we only create new
   * sprints when there's a shortfall.
   *
   * Silent no-op when sprints are disabled or `sprintAutoCreate == 0`. Errors
   * are swallowed by callers (fire-and-forget) because this is opportunistic.
   */
  async ensureFutureSprints(teamId: string, now: Date = new Date()) {
    const team = await teamRepository.findSprintCadenceConfig(teamId)
    if (!team || !team.sprintsEnabled || team.sprintAutoCreate <= 0) return

    // Latest sprint by startDate — either it's the anchor for the next window
    // (if it's in the future or current) or we're bootstrapping from `now`.
    const all = await sprintRepository.listByTeam(teamId, { limit: 100 })
    const existingFuture = all.filter(
      s => new Date(s.startDate).getTime() >= now.getTime()
    )
    const shortfall = team.sprintAutoCreate - existingFuture.length
    if (shortfall <= 0) return

    let anchorEnd: Date | null = null
    if (all.length > 0) {
      // `listByTeam` is ordered by number desc, so [0] is the latest sprint.
      anchorEnd = new Date(all[0]!.endDate)
    }

    const cadence = {
      durationDays: team.sprintDurationDays,
      cooldownDays: team.sprintCooldownDays,
      startWeekday: team.sprintStartWeekday,
    }

    for (let i = 0; i < shortfall; i++) {
      const window = computeNextSprintWindow(cadence, anchorEnd, now)
      try {
        const number = await sprintRepository.nextNumberForTeam(teamId)
        await sprintRepository.create({
          teamId,
          number,
          name: `Sprint ${number}`,
          startDate: window.startDate,
          endDate: window.endDate,
        })
      } catch (err) {
        // P2002 = unique constraint (teamId, number) — concurrent top-up race;
        // bail out and let the other caller finish.
        if (isPrismaUniqueViolation(err)) return
        throw err
      }
      anchorEnd = window.endDate
    }
  },
}
