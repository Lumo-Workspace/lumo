import { prisma } from '@/lib/db/prisma'
import type { TaskActivityType } from '@prisma/client'

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

const ACTOR_SELECT = {
  select: {
    id: true,
    type: true,
    member: { select: { id: true, clerkId: true } },
    agent: { select: { id: true, name: true, avatarColor: true } },
  },
} as const

export const activityRepository = {
  async create(data: CreateActivityData, tx?: any) {
    const client = tx ?? prisma
    return client.taskActivity.create({ data })
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
}
