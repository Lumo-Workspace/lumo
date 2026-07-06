import { prisma } from '@/lib/db/prisma'
import type { Prisma, IdeaActivityType } from '@prisma/client'

/**
 * Idea activity repository (LUM-680). Mirrors `activity.repository` (TaskActivity)
 * for the append-only Idea timeline. `create` accepts an optional transaction
 * client so it can be recorded atomically inside a larger write (e.g. plan-run
 * materialisation) or standalone after a service mutation.
 */
interface CreateIdeaActivityData {
  ideaId: string
  actorId: string | null
  type: IdeaActivityType
  payload: Record<string, unknown> | null
}

const ACTOR_SELECT = {
  select: {
    id: true,
    type: true,
    member: { select: { id: true, clerkId: true } },
    agent: { select: { id: true, name: true, avatarColor: true } },
  },
} as const

export const ideaActivityRepository = {
  async create(data: CreateIdeaActivityData, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.ideaActivity.create({
      data: {
        ideaId: data.ideaId,
        actorId: data.actorId,
        type: data.type,
        payload: data.payload as unknown as Prisma.InputJsonValue,
      },
    })
  },

  /** The idea's full activity timeline, oldest first, with the acting actor. */
  async listByIdea(ideaId: string) {
    return prisma.ideaActivity.findMany({
      where: { ideaId },
      include: { actor: ACTOR_SELECT },
      orderBy: { createdAt: 'asc' as const },
    })
  },
}
