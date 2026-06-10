import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  AcceptanceVerifierType,
  VerificationVerdict,
  VerificationRejectionReason,
} from '@prisma/client'

/**
 * One verdict event to append. The log is append-only: a re-verification is a
 * new row at a later round, never an update. Input invariants (a MACHINE PASS
 * must carry an evidencePointer; agent paths can never express a HUMAN
 * verifierType) are enforced at the validation layer — see
 * lib/validation/acceptance.ts — this repository stays a dumb write.
 */
export interface CreateVerificationRunInput {
  taskId: string
  criterionId: string
  round: number
  verifierType: AcceptanceVerifierType
  verdict: VerificationVerdict
  evidencePointer?: string | null
  rejectionReason?: string | null
  rejectionReasonEnum?: VerificationRejectionReason | null
}

const runSelect = {
  id: true,
  taskId: true,
  criterionId: true,
  round: true,
  verifierType: true,
  verdict: true,
  evidencePointer: true,
  rejectionReason: true,
  rejectionReasonEnum: true,
  createdAt: true,
} satisfies Prisma.VerificationRunSelect

/** Shape returned by every read in this repository. */
export type VerificationRunRow = Prisma.VerificationRunGetPayload<{
  select: typeof runSelect
}>

function toCreateData(i: CreateVerificationRunInput) {
  return {
    taskId: i.taskId,
    criterionId: i.criterionId,
    round: i.round,
    verifierType: i.verifierType,
    verdict: i.verdict,
    evidencePointer: i.evidencePointer ?? null,
    rejectionReason: i.rejectionReason ?? null,
    rejectionReasonEnum: i.rejectionReasonEnum ?? null,
  }
}

export const verificationRunRepository = {
  async create(input: CreateVerificationRunInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.verificationRun.create({
      data: toCreateData(input),
      select: runSelect,
    })
  },

  /** Batch append — one machine round emits one verdict per criterion. */
  async createMany(
    inputs: CreateVerificationRunInput[],
    tx?: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    const client = tx ?? prisma
    return client.verificationRun.createMany({
      data: inputs.map(toCreateData),
    })
  },

  /** Full event log for a task, oldest first (round, then arrival order). */
  async listByTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.verificationRun.findMany({
      where: { taskId },
      orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
      select: runSelect,
    })
  },

  async listByTaskAndRound(
    taskId: string,
    round: number,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.verificationRun.findMany({
      where: { taskId, round },
      orderBy: { createdAt: 'asc' },
      select: runSelect,
    })
  },

  /**
   * Highest round recorded for a task, or null when no verification has run.
   * This IS the task's "current round" — Task carries no derived column
   * (zero-schema derived state, same route as LUM-323).
   */
  async maxRoundByTask(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number | null> {
    const client = tx ?? prisma
    const agg = await client.verificationRun.aggregate({
      where: { taskId },
      _max: { round: true },
    })
    return agg._max.round
  },

  /**
   * Latest verdict per criterion — the derived verification state of a task's
   * contract. "Latest" = highest round, then latest createdAt within the round
   * (an append-only log can hold a re-run of the same round). Criteria with no
   * runs yet are simply absent; the caller joins against the criterion list.
   */
  async latestRunsByCriterion(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Map<string, VerificationRunRow>> {
    const client = tx ?? prisma
    const rows = await client.verificationRun.findMany({
      where: { taskId },
      orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
      select: runSelect,
    })
    // Ascending order → the last write per criterion wins.
    const byCriterion = new Map<string, VerificationRunRow>()
    for (const row of rows) byCriterion.set(row.criterionId, row)
    return byCriterion
  },
}
