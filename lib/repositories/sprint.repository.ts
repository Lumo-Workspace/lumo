import { prisma } from '@/lib/db/prisma'
import type { SprintStatus, Prisma } from '@prisma/client'
import { isPrismaUniqueViolation } from '@/lib/db/errors'
import { taskRepository } from '@/lib/repositories/task.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

export type SpilloverDecision = 'moveToNext' | 'backToBacklog'
export type SprintCloseDecisions = Record<string, SpilloverDecision>

export interface CreateSprintInput {
  teamId: string
  number: number
  name: string
  startDate: Date
  endDate: Date
}

export interface UpdateSprintInput {
  name?: string
  startDate?: Date
  endDate?: Date
  status?: SprintStatus
  startedAt?: Date | null
  closedAt?: Date | null
}

export const sprintRepository = {
  async findById(sprintId: string) {
    return prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            sprintsEnabled: true,
          },
        },
      },
    })
  },

  /**
   * Resolve a workspace-scoped sprint URL like `/workspace/:url/sprints/:number`.
   * Assumes at most one sprints-enabled team per workspace, so the
   * (workspaceId, number) pair is effectively unique.
   */
  async findByWorkspaceAndNumber(workspaceId: string, number: number) {
    return prisma.sprint.findFirst({
      where: { number, team: { workspaceId } },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            sprintsEnabled: true,
          },
        },
      },
    })
  },

  async findActiveByTeam(teamId: string) {
    return prisma.sprint.findFirst({
      where: { teamId, status: 'ACTIVE' },
    })
  },

  async listByTeam(
    teamId: string,
    opts: { status?: SprintStatus; limit?: number; cursor?: string } = {}
  ) {
    const { status, limit = 20, cursor } = opts
    return prisma.sprint.findMany({
      where: { teamId, ...(status ? { status } : {}) },
      orderBy: { number: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  },

  async nextNumberForTeam(teamId: string): Promise<number> {
    const agg = await prisma.sprint.aggregate({
      where: { teamId },
      _max: { number: true },
    })
    return (agg._max.number ?? 0) + 1
  },

  async create(input: CreateSprintInput) {
    return prisma.sprint.create({ data: input })
  },

  async update(sprintId: string, data: UpdateSprintInput) {
    return prisma.sprint.update({ where: { id: sprintId }, data })
  },

  /** Row lock inside a transaction. Used for serialising start/close/task-membership. */
  async lockForUpdate(tx: Prisma.TransactionClient, sprintId: string) {
    const rows = await tx.$queryRaw<{ id: string; status: SprintStatus }[]>`
      SELECT id, status FROM sprints WHERE id = ${sprintId} FOR UPDATE
    `
    return rows[0] ?? null
  },

  async remove(sprintId: string) {
    return prisma.sprint.delete({ where: { id: sprintId } })
  },

  async countTasks(sprintId: string, filter: { status?: string } = {}) {
    return prisma.task.count({
      where: {
        sprintId,
        ...(filter.status ? { status: filter.status as any } : {}),
      },
    })
  },

  /**
   * Transition a DRAFT sprint to ACTIVE, checking there isn't already an
   * ACTIVE sprint on the team. Throws httpError with status 404/409 on
   * pre-condition failures. P2002 from a racing peer maps to 409.
   */
  async startAtomically(sprintId: string) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(
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
        } catch (err) {
          if (isPrismaUniqueViolation(err))
            httpError(409, 'team already has ACTIVE sprint')
          throw err
        }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },

  /**
   * Transition an ACTIVE sprint to CLOSED, routing unfinished tasks per
   * `decisions`. Each unfinished task MUST appear in `decisions` with either
   * 'moveToNext' (goes to the next DRAFT sprint) or 'backToBacklog' (sprintId
   * cleared). Creates SPRINT_CHANGED activities and a pending GenerationJob
   * for retro summary generation.
   */
  async closeAtomically(
    sprintId: string,
    decisions: SprintCloseDecisions,
    actorId: string | null
  ) {
    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint) httpError(404, 'sprint not found')

    return prisma.$transaction(
      async tx => {
        const locked = await sprintRepository.lockForUpdate(tx, sprintId)
        if (!locked) httpError(404, 'sprint not found')
        if (locked.status !== 'ACTIVE')
          httpError(409, `cannot close sprint in ${locked.status} state`)

        const unfinished = await taskRepository.findUnfinishedBySprint(
          sprintId,
          tx
        )
        const unfinishedIds = new Set(unfinished.map(t => t.id))
        const decisionIds = new Set(Object.keys(decisions))

        for (const id of unfinishedIds) {
          if (!decisionIds.has(id)) {
            httpError(400, `decision missing for task ${id}`)
          }
        }
        for (const id of decisionIds) {
          if (!unfinishedIds.has(id)) {
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

        const activities = [
          ...toNext.map(taskId => ({
            taskId,
            actorId,
            payload: {
              fromSprintId: sprintId,
              toSprintId: nextSprintId,
              reason: 'spillover' as const,
            },
          })),
          ...toBacklog.map(taskId => ({
            taskId,
            actorId,
            payload: {
              fromSprintId: sprintId,
              toSprintId: null,
              reason: 'spillover' as const,
            },
          })),
        ]
        if (activities.length) {
          await activityRepository.createManySprintChanged(activities, tx)
        }

        const closed = await sprintRepository.update(sprintId, {
          status: 'CLOSED',
          closedAt: new Date(),
        })

        await generationJobRepository.createSprintPending(sprintId, tx)

        return closed
      },
      { timeout: 15000, maxWait: 5000 }
    )
  },
}
