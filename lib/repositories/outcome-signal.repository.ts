import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * Repository for the LUM-598 post-hoc outcome well (`outcome_signals`).
 *
 * Insert-only by contract: the well is an append-only ledger of rejection
 * signals, so this repository deliberately exposes NO update / delete write
 * path. A signal, once recorded, is a frozen historical fact; the only
 * mutations are inserts. (The falsifier invariant lives one layer up in the
 * service — here we just guarantee the store can't be rewritten.)
 */

/** The fields a caller supplies to record one rejection signal. */
export type InsertOutcomeSignalInput = {
  workspaceId: string
  taskId: string
  kind: Prisma.OutcomeSignalCreateInput['kind']
  source: Prisma.OutcomeSignalCreateInput['source']
  occurredAt?: Date | null
  evidence?: Prisma.InputJsonValue
  sessionId?: string | null
  recordedByMemberId?: string | null
}

export const outcomeSignalRepository = {
  /** Append one rejection signal. Never updates an existing row. */
  async insert(input: InsertOutcomeSignalInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.outcomeSignal.create({
      data: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        kind: input.kind,
        source: input.source,
        occurredAt: input.occurredAt ?? null,
        sessionId: input.sessionId ?? null,
        recordedByMemberId: input.recordedByMemberId ?? null,
        // Only set evidence when supplied — exactOptionalPropertyTypes rejects
        // an explicit `undefined` on Prisma's nullable JSON input.
        ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      },
    })
  },

  /** How many rejection signals the well holds for a task (drives the oracle). */
  async countForTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.outcomeSignal.count({ where: { taskId } })
  },

  /** Every signal for a task, newest first (audit / inspection read). */
  async listForTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.outcomeSignal.findMany({
      where: { taskId },
      orderBy: { detectedAt: 'desc' },
    })
  },

  /**
   * LUM-1278 attention read model: the rework signals (REVERTED / REOPENED)
   * recorded against the given tasks in the caller's workspace.
   */
  async listReworkByTaskIds(workspaceId: string, taskIds: string[]) {
    if (taskIds.length === 0) return []
    return prisma.outcomeSignal.findMany({
      where: {
        workspaceId,
        taskId: { in: taskIds },
        kind: { in: ['REVERTED', 'REOPENED'] },
      },
      select: { taskId: true, kind: true },
    })
  },
}
