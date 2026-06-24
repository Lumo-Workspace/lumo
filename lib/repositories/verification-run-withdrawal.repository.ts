/**
 * Append-only repository for VerificationRunWithdrawal tombstones (LUM-586).
 *
 * A withdrawal does NOT delete run rows — it marks a verdictActionId as
 * withdrawn so that the latest-verdict derivation ({@link deriveLatestRunsByCriterion})
 * falls through to the prior row. One action can be withdrawn at most once
 * (@@unique([taskId, verdictActionId]) in schema).
 */
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

export interface CreateWithdrawalInput {
  taskId: string
  verdictActionId: string
  withdrawnById?: string | null
  note?: string | null
}

const withdrawalSelect = {
  id: true,
  taskId: true,
  verdictActionId: true,
  withdrawnById: true,
  note: true,
  createdAt: true,
} satisfies Prisma.VerificationRunWithdrawalSelect

export type WithdrawalRow = Prisma.VerificationRunWithdrawalGetPayload<{
  select: typeof withdrawalSelect
}>

export const verificationRunWithdrawalRepository = {
  /**
   * Append a withdrawal tombstone. Throws a unique-constraint error if the
   * same (taskId, verdictActionId) pair is withdrawn a second time — callers
   * should guard with a prior existence check or catch P2002.
   */
  async create(
    input: CreateWithdrawalInput,
    tx?: Prisma.TransactionClient
  ): Promise<WithdrawalRow> {
    const client = tx ?? prisma
    return client.verificationRunWithdrawal.create({
      data: {
        taskId: input.taskId,
        verdictActionId: input.verdictActionId,
        withdrawnById: input.withdrawnById ?? null,
        note: input.note ?? null,
      },
      select: withdrawalSelect,
    })
  },

  /**
   * All withdrawn verdictActionIds for a task — returned as a Set so callers
   * can do O(1) membership checks when filtering run rows.
   */
  async actionIdsByTask(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    const client = tx ?? prisma
    const rows = await client.verificationRunWithdrawal.findMany({
      where: { taskId },
      select: { verdictActionId: true },
    })
    return new Set(rows.map(r => r.verdictActionId))
  },

  /**
   * Most-recent withdrawal for a task, or null if none. Used by the service
   * layer to surface the "last undo" in the task read model.
   */
  async latestByTask(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WithdrawalRow | null> {
    const client = tx ?? prisma
    return client.verificationRunWithdrawal.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: withdrawalSelect,
    })
  },
}
