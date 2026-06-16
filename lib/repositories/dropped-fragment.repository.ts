import { prisma } from '@/lib/db/prisma'
import type { LineageFragmentType, Prisma } from '@prisma/client'

export interface CreateDroppedFragmentInput {
  workspaceId: string
  taskId: string
  sessionId?: string | null
  fragmentType: LineageFragmentType
  fragmentId: string
  relevanceScore?: number | null
}

export const droppedFragmentRepository = {
  async createMany(
    inputs: CreateDroppedFragmentInput[],
    tx?: Prisma.TransactionClient
  ): Promise<{ count: number }> {
    if (inputs.length === 0) return { count: 0 }
    const client = tx ?? prisma
    return client.droppedFragment.createMany({
      data: inputs.map(i => ({
        workspaceId: i.workspaceId,
        taskId: i.taskId,
        sessionId: i.sessionId ?? null,
        fragmentType: i.fragmentType,
        fragmentId: i.fragmentId,
        relevanceScore: i.relevanceScore ?? null,
      })),
      // Idempotent against the (sessionId, taskId, fragmentType, fragmentId)
      // unique constraint: a bound session re-records the same dropped fragments
      // on every session-start (attach + later resume/clear/compact). Mirrors
      // LineageEdge.createMany (LUM-530).
      skipDuplicates: true,
    })
  },
}
