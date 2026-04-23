import { prisma } from '@/lib/db/prisma'
import type { Prisma, TaskActivityType } from '@prisma/client'

interface CreateActivityData {
  taskId: string
  actorId: string | null
  type: TaskActivityType
  payload: Record<string, unknown> | null
}

interface FindOptions {
  limit: number
  cursor?: { timestamp: string; id: string }
}

export interface SprintChangedPayload {
  fromSprintId: string | null
  toSprintId: string | null
  reason: 'spillover' | 'planning'
}

export interface CreateSprintChangedInput {
  taskId: string
  actorId: string | null
  payload: SprintChangedPayload
}

const ACTOR_SELECT = {
  select: {
    id: true,
    type: true,
    member: { select: { id: true, clerkId: true } },
    agent: { select: { id: true, name: true, avatarColor: true } },
  },
} as const

export const activityRepository = {
  async create(data: CreateActivityData, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.taskActivity.create({
      data: {
        taskId: data.taskId,
        actorId: data.actorId,
        type: data.type,
        payload: data.payload as unknown as Prisma.InputJsonValue,
      },
    })
  },

  async findByTaskId(taskId: string, options: FindOptions) {
    const { limit, cursor } = options
    const where: Record<string, unknown> = { taskId }
    if (cursor) {
      where.OR = [
        { createdAt: { gt: new Date(cursor.timestamp) } },
        { createdAt: new Date(cursor.timestamp), id: { gt: cursor.id } },
      ]
    }
    return prisma.taskActivity.findMany({
      where,
      include: { actor: ACTOR_SELECT },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
    })
  },

  /**
   * Create a single SPRINT_CHANGED activity. Used inside sprintRepository
   * atomic methods (add/remove task). `tx` is required because every call
   * site is inside a transaction.
   */
  async createSprintChanged(
    input: CreateSprintChangedInput,
    tx: Prisma.TransactionClient
  ) {
    return tx.taskActivity.create({
      data: {
        taskId: input.taskId,
        actorId: input.actorId,
        type: 'SPRINT_CHANGED',
        payload: input.payload as unknown as Prisma.InputJsonValue,
      },
    })
  },

  /**
   * Bulk-create SPRINT_CHANGED activities during sprint close.
   * `skipDuplicates` matches the pre-refactor behavior.
   */
  async createManySprintChanged(
    inputs: CreateSprintChangedInput[],
    tx: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    return tx.taskActivity.createMany({
      data: inputs.map(i => ({
        taskId: i.taskId,
        actorId: i.actorId,
        type: 'SPRINT_CHANGED' as const,
        payload: i.payload as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
  },

  /**
   * List SPRINT_CHANGED activities whose payload.fromSprintId matches the
   * given sprint — i.e. tasks that spilled out of this sprint. Used by
   * sprintSummaryRepository.computeStatsData() to count spillover.
   */
  async listSpilloverFromSprint(
    sprintId: string,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.taskActivity.findMany({
      where: {
        type: 'SPRINT_CHANGED',
        payload: { path: ['fromSprintId'], equals: sprintId },
      },
      select: { taskId: true, payload: true },
    })
  },
}
