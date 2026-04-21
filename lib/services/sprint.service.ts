import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { sprintSummaryService } from '@/lib/services/sprint-summary.service'
import { dispatchSprintNotification } from '@/lib/services/sprint-notifications.service'

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
      select: { id: true, sprintsEnabled: true },
    })
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

    const started = await prisma.$transaction(
      async tx => {
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
      },
      { timeout: 15000, maxWait: 5000 }
    )

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

    const closed = await prisma.$transaction(
      async tx => {
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
            httpError(
              409,
              'no draft sprint to receive spillover; create one first'
            )
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
      },
      {
        // Some calls inside this transaction still go through the top-level
        // prisma client (sprintRepository.* / taskRepository.bulkUpdateSprint
        // when no tx is forwarded), each waiting on the connection pool. The
        // 5s default isn't enough headroom in dev; bump to 15s.
        timeout: 15000,
        maxWait: 5000,
      }
    )

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

    return prisma.$transaction(
      async tx => {
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
      },
      { timeout: 15000, maxWait: 5000 }
    )
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

    return prisma.$transaction(
      async tx => {
        if (task.sprintId)
          await sprintRepository.lockForUpdate(tx, task.sprintId)
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
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  async moveTaskBetweenSprints(
    taskId: string,
    toSprintId: string,
    actor: ActorRef & { id?: string }
  ) {
    return sprintService.addTaskToSprint(taskId, toSprintId, actor)
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
    input: { enabled: boolean },
    _actor: ActorRef
  ) {
    return prisma.team.update({
      where: { id: teamId },
      data: { sprintsEnabled: input.enabled },
    })
  },
}
