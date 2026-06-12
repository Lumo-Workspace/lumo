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

/**
 * PASS_WITH_FOLLOWUP is a human "pass with notes" — it counts as met. Single
 * source for every consumer of "is this verdict a pass" (the LUM-344 status
 * read model and the LUM-397 outcome-strength derivation share this exact
 * predicate so their notions of "passed" can never drift).
 */
export function isPassVerdict(
  verdict: VerificationVerdict | undefined
): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

/**
 * Pure derivation behind the LUM-397 MERGED_VERIFIED strength signal: given
 * verification-run rows, return the task ids that have at least one all-PASS
 * round (≥1 verdict in the round, every verdict a pass per
 * {@link isPassVerdict}). Exported standalone so BOTH stamp paths — the
 * task→DONE immediate stamp and the hourly cron sweep — provably share one
 * definition, and so tests can pin the semantics without a database.
 */
export function deriveAllPassRoundTaskIds(
  rows: Array<{ taskId: string; round: number; verdict: VerificationVerdict }>
): Set<string> {
  const roundAllPass = new Map<string, { taskId: string; allPass: boolean }>()
  for (const row of rows) {
    const key = `${row.taskId}:${row.round}`
    const entry = roundAllPass.get(key)
    if (!entry) {
      roundAllPass.set(key, {
        taskId: row.taskId,
        allPass: isPassVerdict(row.verdict),
      })
    } else if (!isPassVerdict(row.verdict)) {
      entry.allPass = false
    }
  }
  const taskIds = new Set<string>()
  for (const entry of roundAllPass.values()) {
    if (entry.allPass) taskIds.add(entry.taskId)
  }
  return taskIds
}

/**
 * Criterion ids whose latest MACHINE-authored verdict is a PASS — i.e. an
 * actual checkpointer run currently vouches for them, as distinct from a human
 * override (LUM-456). This walks ONLY the MACHINE rows, so a later human PASS
 * (a redundant sign-off, or a manual override) never inflates the set: machine
 * verification can only ever be claimed by a checkpointer that produced it.
 *
 * Rows must be oldest-first (round asc, then createdAt asc) — the same order
 * {@link verificationRunRepository.listByTask} returns — so the last MACHINE row
 * per criterion is its current machine state. A criterion with no MACHINE run,
 * or whose latest MACHINE run FAILed, is absent. Exported standalone so the
 * status read model (honest "machine verified" rollup) and the human-verdict
 * fan-out (a bulk PASS must not silently override an un-machine-passed MACHINE
 * criterion) provably share one definition, and so tests can pin it with no DB.
 */
export function deriveMachinePassedCriteria(
  rows: Array<
    Pick<VerificationRunRow, 'criterionId' | 'verifierType' | 'verdict'>
  >
): Set<string> {
  // Last MACHINE verdict per criterion wins (rows are oldest-first).
  const latestMachinePass = new Map<string, boolean>()
  for (const row of rows) {
    if (row.verifierType !== 'MACHINE') continue
    latestMachinePass.set(row.criterionId, isPassVerdict(row.verdict))
  }
  const passed = new Set<string>()
  for (const [criterionId, pass] of latestMachinePass) {
    if (pass) passed.add(criterionId)
  }
  return passed
}

export const verificationRunRepository = {
  async create(
    input: CreateVerificationRunInput,
    tx?: Prisma.TransactionClient
  ) {
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

  /**
   * Task ids (optionally restricted to `taskIds`) that have at least one
   * all-PASS verification round — the LUM-397 strength signal for both
   * lineage stamp paths. Unfiltered, this scans the whole append-only log:
   * acceptable at current volume (the cron sweep calls it hourly); revisit
   * with a round-level rollup if the table grows hot.
   */
  async taskIdsWithAllPassRound(
    taskIds?: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    if (taskIds && taskIds.length === 0) return new Set()
    const client = tx ?? prisma
    const rows = await client.verificationRun.findMany({
      where: taskIds ? { taskId: { in: taskIds } } : {},
      select: { taskId: true, round: true, verdict: true },
    })
    return deriveAllPassRoundTaskIds(rows)
  },

  /**
   * Criterion ids whose latest MACHINE-authored verdict is a PASS — a
   * checkpointer currently vouches for them (LUM-456). Derived from the
   * append-only log via {@link deriveMachinePassedCriteria}; the human-verdict
   * fan-out uses it to refuse silently passing an un-machine-passed MACHINE
   * criterion, and the status read model uses the same pure derivation to keep
   * its "machine verified" rollup honest.
   */
  async machinePassedCriteria(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    const client = tx ?? prisma
    const rows = await client.verificationRun.findMany({
      where: { taskId },
      orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
      select: { criterionId: true, verifierType: true, verdict: true },
    })
    return deriveMachinePassedCriteria(rows)
  },

  /** Single-task convenience over {@link taskIdsWithAllPassRound} — the
   * task→DONE immediate stamp path. Same derivation by construction. */
  async hasAllPassRound(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<boolean> {
    const ids = await this.taskIdsWithAllPassRound([taskId], tx)
    return ids.has(taskId)
  },
}
