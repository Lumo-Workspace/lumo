import { prisma } from '@/lib/db/prisma'
import type { SprintStatus, Prisma } from '@prisma/client'
import { isPrismaUniqueViolation } from '@/lib/db/errors'

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

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
}
