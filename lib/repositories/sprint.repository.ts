import { prisma } from '@/lib/db/prisma'
import type { SprintStatus, Prisma } from '@prisma/client'

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
            sprintCadenceDays: true,
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
}
