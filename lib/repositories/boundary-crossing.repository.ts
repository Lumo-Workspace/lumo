import { prisma } from '@/lib/db/prisma'
import type { BoundaryCrossingCategory, Prisma } from '@prisma/client'

export interface CreateBoundaryCrossingInput {
  taskId: string
  hookEventId?: string | null
  category: BoundaryCrossingCategory
  /** Human-readable detail: the matched command / path / pattern. */
  detail: string
}

const SELECT = {
  id: true,
  taskId: true,
  category: true,
  detail: true,
  detectedAt: true,
  acknowledgedAt: true,
  acknowledgedById: true,
} as const

/**
 * Persistence for boundary-crossing markers (LUM-426). The marker mirrors onto
 * a TaskActivity for the timeline; this table holds the mutable acknowledgement
 * state the DONE gate reads — TaskActivity is append-only and cannot carry it.
 */
export const boundaryCrossingRepository = {
  async create(
    input: CreateBoundaryCrossingInput,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.boundaryCrossing.create({
      data: {
        taskId: input.taskId,
        hookEventId: input.hookEventId ?? null,
        category: input.category,
        detail: input.detail,
      },
      select: SELECT,
    })
  },

  /** Open (unacknowledged) crossings on a task — what the DONE gate blocks on. */
  async findUnacknowledgedByTask(taskId: string) {
    return prisma.boundaryCrossing.findMany({
      where: { taskId, acknowledgedAt: null },
      select: SELECT,
      orderBy: { detectedAt: 'asc' },
    })
  },

  async findById(id: string) {
    return prisma.boundaryCrossing.findUnique({ where: { id }, select: SELECT })
  },

  /**
   * Mark a crossing acknowledged by a human actor. Idempotent on the
   * already-acknowledged row (updateMany guarded by acknowledgedAt: null) so a
   * double click can't rewrite the original acknowledger/timestamp.
   */
  async acknowledge(id: string, actorId: string | null, now: Date) {
    return prisma.boundaryCrossing.updateMany({
      where: { id, acknowledgedAt: null },
      data: { acknowledgedAt: now, acknowledgedById: actorId },
    })
  },

  /** Whether the default-on DONE gate is enabled for the workspace (LUM-426). */
  async isGateEnabledForWorkspace(workspaceId: string): Promise<boolean> {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { boundaryGateEnabled: true },
    })
    // Absent workspace → treat as enabled (fail safe: the gate stays on).
    return ws?.boundaryGateEnabled ?? true
  },
}
