import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  AcceptanceVerifierType,
  VerificationVerdict,
  VerificationRejectionReason,
} from '@prisma/client'
import { verificationRunWithdrawalRepository } from '@/lib/repositories/verification-run-withdrawal.repository'

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
  /** Shared id stamped on every run written by ONE human-verdict action (LUM-586). Null on machine runs. */
  verdictActionId?: string | null
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
  verdictActionId: true,
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
    verdictActionId: i.verdictActionId ?? null,
  }
}

// ── Withdrawal-aware pure helpers (LUM-586) ──────────────────────────────────

/**
 * Returns true when a run row's verdictActionId is present in the given set
 * of withdrawn action ids. Machine runs (verdictActionId === null) are never
 * withdrawn.
 */
export function isRunWithdrawn(
  run: { verdictActionId: string | null },
  withdrawnActionIds: Set<string>
): boolean {
  return (
    run.verdictActionId !== null && withdrawnActionIds.has(run.verdictActionId)
  )
}

/**
 * Derives the latest non-withdrawn run per criterion from an oldest-first
 * ordered list of run rows and a set of withdrawn verdictActionIds. A
 * withdrawn human-verdict run is skipped, and the derivation falls back to
 * the prior row for that criterion. Criteria whose every run is withdrawn are
 * absent from the returned Map.
 *
 * This is the single definition shared between the withdrawal-aware DB method
 * ({@link verificationRunRepository.latestRunsByCriterion}) and every test
 * that pins the semantics — no DB required.
 */
export function deriveLatestRunsByCriterion(
  rows: Array<VerificationRunRow>,
  withdrawnActionIds: Set<string>
): Map<string, VerificationRunRow> {
  // Walk oldest-first; a non-withdrawn row overwrites the previous winner for
  // that criterion; a withdrawn row is simply skipped.
  const byCriterion = new Map<string, VerificationRunRow>()
  for (const row of rows) {
    if (!isRunWithdrawn(row, withdrawnActionIds)) {
      byCriterion.set(row.criterionId, row)
    }
  }
  return byCriterion
}

/** Shape returned by {@link deriveLatestHumanVerdictAction} when a live action exists. */
export interface LatestHumanVerdictAction {
  verdictActionId: string
  verdict: VerificationVerdict
  criterionIds: string[]
  recordedAt: Date
}

/**
 * From an oldest-first list of run rows, returns the full action descriptor of
 * the most-recent non-withdrawn HUMAN verdict action, or null when no live
 * human verdict exists. Used by the service layer to determine the action id
 * that a withdrawal request should target and to populate the withdrawal return
 * value (LUM-586).
 */
export function deriveLatestHumanVerdictAction(
  rows: Array<VerificationRunRow>,
  withdrawnActionIds: Set<string>
): LatestHumanVerdictAction | null {
  // Walk oldest-first; a non-withdrawn HUMAN row with a verdictActionId wins
  // over the previous action (rows are already oldest-first so the last match
  // is the most-recent action).
  let latestActionId: string | null = null
  let latestVerdict: VerificationVerdict | null = null
  let latestDate: Date | null = null
  const criterionsByAction = new Map<string, Set<string>>()

  for (const row of rows) {
    if (row.verifierType !== 'HUMAN') continue
    if (isRunWithdrawn(row, withdrawnActionIds)) continue
    if (row.verdictActionId === null) continue
    latestActionId = row.verdictActionId
    latestVerdict = row.verdict
    latestDate = row.createdAt
    if (!criterionsByAction.has(row.verdictActionId)) {
      criterionsByAction.set(row.verdictActionId, new Set())
    }
    criterionsByAction.get(row.verdictActionId)!.add(row.criterionId)
  }

  if (
    latestActionId === null ||
    latestVerdict === null ||
    latestDate === null
  ) {
    return null
  }
  return {
    verdictActionId: latestActionId,
    verdict: latestVerdict,
    criterionIds: Array.from(criterionsByAction.get(latestActionId) ?? []),
    recordedAt: latestDate,
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
   * Latest non-withdrawn verdict per criterion — the derived verification
   * state of a task's contract. "Latest" = highest round, then latest
   * createdAt within the round. A human-verdict run whose verdictActionId is
   * present in the withdrawal tombstones is skipped, falling through to the
   * prior row for that criterion (LUM-586). Criteria with no un-withdrawn runs
   * are absent; the caller joins against the criterion list.
   */
  async latestRunsByCriterion(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<Map<string, VerificationRunRow>> {
    const client = tx ?? prisma
    const [rows, withdrawnActionIds] = await Promise.all([
      client.verificationRun.findMany({
        where: { taskId },
        orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
        select: runSelect,
      }),
      verificationRunWithdrawalRepository.actionIdsByTask(taskId, tx),
    ])
    return deriveLatestRunsByCriterion(rows, withdrawnActionIds)
  },

  /**
   * Full action descriptor of the latest non-withdrawn HUMAN verdict for a
   * task, or null when no live human verdict exists. The service layer uses
   * this to determine the action id that a withdrawal request should target
   * and to populate the withdrawal return value (LUM-586).
   */
  async latestHumanVerdictAction(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<LatestHumanVerdictAction | null> {
    const client = tx ?? prisma
    const [rows, withdrawnActionIds] = await Promise.all([
      client.verificationRun.findMany({
        where: { taskId, verifierType: 'HUMAN' },
        orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
        select: runSelect,
      }),
      verificationRunWithdrawalRepository.actionIdsByTask(taskId, tx),
    ])
    return deriveLatestHumanVerdictAction(rows, withdrawnActionIds)
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
   * Of the given tasks, which carry a send-back — a HUMAN or AGENT FAIL verdict
   * (the cross-actor rejection that bounced the task to IN_PROGRESS, LUM-422)?
   * MACHINE FAILs are excluded: a within-loop verify round that later passes is
   * the loop working as designed, not a send-back. Backs the LUM-484
   * negative-class derivation — a task tainted here is recounted as non-merged
   * in the flywheel discrimination metric even if it later reached DONE.
   * Pass `taskIds` to restrict the scan to a (workspace-filtered) set; omit it
   * for a full-table scan. Empty `taskIds` array → empty set, no query.
   */
  /**
   * Batched FAIL rows over a task set, projected to the friction fields the
   * LUM-633 per-member delivery rollup folds (machine rework rounds vs
   * human/agent send-back actions). Read-only over the append-only log.
   */
  async failRowsByTaskIds(taskIds: string[]): Promise<
    Array<{
      taskId: string
      round: number
      verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
      verifierType: 'HUMAN' | 'AGENT' | 'MACHINE'
      verdictActionId: string | null
    }>
  > {
    if (taskIds.length === 0) return []
    return prisma.verificationRun.findMany({
      where: { taskId: { in: taskIds }, verdict: 'FAIL' },
      select: {
        taskId: true,
        round: true,
        verdict: true,
        verifierType: true,
        verdictActionId: true,
      },
    })
  },

  async taskIdsWithSendBack(
    taskIds?: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    if (taskIds && taskIds.length === 0) return new Set()
    const client = tx ?? prisma
    const rows = await client.verificationRun.findMany({
      where: {
        verdict: 'FAIL',
        verifierType: { in: ['HUMAN', 'AGENT'] },
        ...(taskIds ? { taskId: { in: taskIds } } : {}),
      },
      select: { taskId: true },
      distinct: ['taskId'],
    })
    return new Set(rows.map(r => r.taskId))
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

  /**
   * Of the given criterion ids, the subset that has ever recorded a PASS in ANY
   * round (PASS_WITH_FOLLOWUP counts — LUM-449 authoring gate). Used by the
   * TEST_TAMPERING detector to tell test authoring (criterion never green) from
   * weakening a green check; mirrors the LUM-438 `everPassed` refinement of the
   * sibling drift detector. Indexed by `criterionId`; a read.
   */
  async criterionIdsEverPassed(
    criterionIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    if (criterionIds.length === 0) return new Set()
    const client = tx ?? prisma
    const rows = await client.verificationRun.findMany({
      where: {
        criterionId: { in: criterionIds },
        verdict: { in: ['PASS', 'PASS_WITH_FOLLOWUP'] },
      },
      select: { criterionId: true },
      distinct: ['criterionId'],
    })
    return new Set(rows.map(r => r.criterionId))
  },
}
