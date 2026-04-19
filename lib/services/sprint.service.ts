import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { sprintSummaryService } from '@/lib/services/sprint-summary.service'
import { dispatchSprintNotification } from '@/lib/services/sprint-notifications.service'
import {
  nextUtcMondayMidnight as _nextUtcMondayMidnight,
  addDays as _addDays,
} from '@/lib/services/sprint-date'

// Re-export for backward compatibility
export { nextUtcMondayMidnight, addDays } from '@/lib/services/sprint-date'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
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

export type SpilloverDecision = 'moveToNext' | 'backToBacklog'
export type SprintCloseDecisions = Record<string, SpilloverDecision>

export const sprintService = {
  async createDraft(teamId: string, input: CreateDraftInput, _actor: ActorRef) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, sprintCadenceDays: true },
    })
    if (!team) httpError(404, 'team not found')

    let startDate = input.startDate
    let endDate = input.endDate

    if (!startDate || !endDate) {
      if (!team.sprintCadenceDays) {
        httpError(
          400,
          'team has no cadence; startDate and endDate are required'
        )
      }
      if (!startDate) startDate = _nextUtcMondayMidnight(new Date())
      if (!endDate) endDate = _addDays(startDate, team.sprintCadenceDays)
    }

    const number = await sprintRepository.nextNumberForTeam(teamId)
    const name = input.name?.trim() || `Sprint ${number}`

    return sprintRepository.create({ teamId, number, name, startDate, endDate })
  },

  async start(sprintId: string, actor: ActorRef & { id?: string }) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    const started = await prisma.$transaction(async tx => {
      const locked = await sprintRepository.lockForUpdate(tx, sprintId)
      if (!locked) httpError(404, 'sprint not found')
      if (locked.status !== 'DRAFT')
        httpError(409, `cannot start sprint in ${locked.status} state`)

      const active = await sprintRepository.findActiveByTeam(sprint.teamId)
      if (active && active.id !== sprintId) {
        httpError(409, `team already has ACTIVE sprint ${active.id}`)
      }

      try {
        return await sprintRepository.update(sprintId, {
          status: 'ACTIVE',
          startedAt: new Date(),
        })
      } catch (err: any) {
        if (err?.code === 'P2002')
          httpError(409, 'team already has ACTIVE sprint')
        throw err
      }
    })

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

    const closed = await prisma.$transaction(async tx => {
      const locked = await sprintRepository.lockForUpdate(tx, sprintId)
      if (!locked) httpError(404, 'sprint not found')
      if (locked.status !== 'ACTIVE')
        httpError(409, `cannot close sprint in ${locked.status} state`)

      const unfinished = await (tx as any).task.findMany({
        where: { sprintId, status: { not: 'DONE' } },
        select: { id: true, status: true },
      })
      const unfinishedIds = new Set(unfinished.map((t: any) => t.id))
      const decisionIds = new Set(Object.keys(decisions))

      for (const id of unfinishedIds) {
        if (!decisionIds.has(id as string)) {
          httpError(400, `decision missing for task ${id}`)
        }
      }
      for (const id of decisionIds) {
        if (!unfinishedIds.has(id as string)) {
          httpError(409, 'sprint membership changed; reopen close dialog')
        }
      }

      let nextSprintId: string | null = null
      const needsNext = Object.values(decisions).some(d => d === 'moveToNext')
      if (needsNext) {
        const drafts = await sprintRepository.listByTeam(sprint.teamId, {
          status: 'DRAFT',
          limit: 1,
        })
        if (drafts.length > 0 && drafts[0]) {
          nextSprintId = drafts[0].id
        } else {
          const nextNumber = await sprintRepository.nextNumberForTeam(
            sprint.teamId
          )
          const teamRow = await (tx as any).team.findUnique({
            where: { id: sprint.teamId },
            select: { sprintCadenceDays: true },
          })
          const cadence = teamRow?.sprintCadenceDays ?? 14
          const startDate =
            sprint.endDate > new Date() ? sprint.endDate : new Date()
          const endDate = _addDays(startDate, cadence)
          const created = await sprintRepository.create({
            teamId: sprint.teamId,
            number: nextNumber,
            name: `Sprint ${nextNumber}`,
            startDate,
            endDate,
          })
          nextSprintId = created.id
        }
      }

      const toNext: string[] = []
      const toBacklog: string[] = []
      for (const [taskId, d] of Object.entries(decisions)) {
        if (d === 'moveToNext') toNext.push(taskId)
        else toBacklog.push(taskId)
      }
      if (toNext.length) {
        await taskRepository.bulkUpdateSprint(toNext, nextSprintId!, tx)
      }
      if (toBacklog.length) {
        await taskRepository.bulkUpdateSprint(toBacklog, null, tx)
      }

      const actorId = actor.id ?? null
      await (tx as any).taskActivity.createMany({
        data: [
          ...toNext.map(taskId => ({
            taskId,
            actorId,
            type: 'SPRINT_CHANGED' as const,
            payload: {
              fromSprintId: sprintId,
              toSprintId: nextSprintId,
              reason: 'spillover',
            },
          })),
          ...toBacklog.map(taskId => ({
            taskId,
            actorId,
            type: 'SPRINT_CHANGED' as const,
            payload: {
              fromSprintId: sprintId,
              toSprintId: null,
              reason: 'spillover',
            },
          })),
        ],
        skipDuplicates: true,
      })

      const closed = await sprintRepository.update(sprintId, {
        status: 'CLOSED',
        closedAt: new Date(),
      })

      await (tx as any).generationJob.create({
        data: { type: 'sprint', targetId: sprintId, status: 'pending' },
      })

      return closed
    })

    // Fire-and-forget: kick off retro generation without blocking the HTTP response.
    // The GenerationJob created above (status: 'pending') will be updated to
    // 'completed' or 'failed' by sprintSummaryService.generate's own try/catch.
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

  async addTaskToSprint(
    taskId: string,
    sprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    const [task, sprint] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, teamId: true, sprintId: true },
      }),
      sprintRepository.findById(sprintId),
    ])
    if (!task) httpError(404, 'task not found')
    if (!sprint) httpError(404, 'sprint not found')
    if (task.teamId !== sprint.teamId)
      httpError(400, 'task and sprint belong to different teams')
    if (sprint.status === 'CLOSED') httpError(409, 'sprint is closed')

    return prisma.$transaction(async tx => {
      await sprintRepository.lockForUpdate(tx, sprintId)
      const fromSprintId = task.sprintId
      await taskRepository.bulkUpdateSprint([taskId], sprintId, tx)
      await (tx as any).taskActivity.create({
        data: {
          taskId,
          actorId: actor.id ?? null,
          type: 'SPRINT_CHANGED',
          payload: { fromSprintId, toSprintId: sprintId, reason: 'planning' },
        },
      })
      return { taskId, sprintId }
    })
  },

  async removeTaskFromSprint(
    taskId: string,
    actor: ActorRef & { id?: string }
  ) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, sprintId: true },
    })
    if (!task) httpError(404, 'task not found')
    if (!task.sprintId) return { taskId, sprintId: null }

    const sprint = await sprintRepository.findById(task.sprintId)
    if (sprint && sprint.status === 'CLOSED') {
      httpError(409, 'cannot remove task from closed sprint')
    }

    return prisma.$transaction(async tx => {
      if (task.sprintId) await sprintRepository.lockForUpdate(tx, task.sprintId)
      await taskRepository.bulkUpdateSprint([taskId], null, tx)
      await (tx as any).taskActivity.create({
        data: {
          taskId,
          actorId: actor.id ?? null,
          type: 'SPRINT_CHANGED',
          payload: {
            fromSprintId: task.sprintId,
            toSprintId: null,
            reason: 'planning',
          },
        },
      })
      return { taskId, sprintId: null }
    })
  },

  async moveTaskBetweenSprints(
    taskId: string,
    toSprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintService.addTaskToSprint(taskId, toSprintId, actor)
  },

  async removeDraft(sprintId: string, _actor: ActorRef) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')
    if (sprint.status !== 'DRAFT')
      httpError(409, `cannot delete sprint in ${sprint.status} state`)
    await sprintRepository.remove(sprintId)
  },

  async configureCadence(
    teamId: string,
    input: { cadenceDays: number | null; autoPrepare?: boolean },
    _actor: ActorRef
  ) {
    if (input.cadenceDays !== null) {
      if (
        !(
          Number.isInteger(input.cadenceDays) &&
          input.cadenceDays > 0 &&
          input.cadenceDays <= 90
        )
      ) {
        httpError(400, 'cadenceDays must be a positive integer ≤ 90 or null')
      }
    }
    return prisma.team.update({
      where: { id: teamId },
      data: {
        sprintCadenceDays: input.cadenceDays,
        ...(input.autoPrepare !== undefined
          ? { sprintAutoPrepare: input.autoPrepare }
          : {}),
      },
    })
  },
}
