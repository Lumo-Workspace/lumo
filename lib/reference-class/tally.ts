import type { BoundaryCrossingDisposition } from '@prisma/client'
import { TOP_N, type TallyEntry } from './types'

/** One (task, signal value) observation; a null key is "not classified". */
export interface Observation {
  taskId: string
  key: string | null
}

/** A boundary crossing reduced to what the tally needs. */
export interface CrossingRow {
  taskId: string
  category: string
  disposition: BoundaryCrossingDisposition | null
}

/**
 * Does a disposed crossing still count as prior art for the class?
 *
 * A `Record<PrismaEnum, boolean>` rather than a string comparison, on purpose
 * and for the same reason copy.ts uses Record maps: adding a
 * BoundaryCrossingDisposition value to the schema without deciding here fails
 * `tsc --noEmit`, which the PR checklist already runs. A `=== 'CONFIRMED'`
 * check would have silently dropped the new value instead. The enum is
 * imported as a TYPE only — this module must stay free of runtime
 * `@prisma/client` imports.
 *
 * A null disposition (still open, not adjudicated) is handled at the call site
 * because it is the absence of a value, not one of them.
 */
export const CROSSING_DISPOSITION_COUNTS: Record<
  BoundaryCrossingDisposition,
  boolean
> = {
  CONFIRMED: true,
  // Already adjudicated as not-real — counting them would feed adjudicated
  // noise back to the next agent as evidence.
  FALSE_POSITIVE: false,
  AUTO_LEGIT: false,
  // LUM-751: system-applied repository rule — adjudicated noise, same as above.
  AUTO_SUPPRESSED: false,
}

/**
 * Count DISTINCT TASKS per key, descending, ties broken by key name so the
 * same input always renders the same line. Per-task dedupe is the point: the
 * anchor answers "how many tasks in this class hit X", not "how many rows".
 */
export function tallyByTask(obs: Observation[], topN = TOP_N): TallyEntry[] {
  const tasksByKey = new Map<string, Set<string>>()
  for (const o of obs) {
    if (o.key == null) continue
    const tasks = tasksByKey.get(o.key) ?? new Set<string>()
    tasks.add(o.taskId)
    tasksByKey.set(o.key, tasks)
  }
  return [...tasksByKey.entries()]
    .map(([key, tasks]) => ({ key, count: tasks.size }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, topN)
}

/**
 * Crossings worth showing as prior art: still open (no disposition yet) or a
 * disposition that {@link CROSSING_DISPOSITION_COUNTS} admits.
 */
export function crossingObservations(rows: CrossingRow[]): Observation[] {
  return rows
    .filter(
      r => r.disposition == null || CROSSING_DISPOSITION_COUNTS[r.disposition]
    )
    .map(r => ({ taskId: r.taskId, key: r.category }))
}

/** A FAIL verification run reduced to what the tally needs. */
export interface RejectionRow {
  taskId: string
  rejectionReasonEnum: string | null
  /**
   * Shared id stamped on every run written by ONE human-verdict action
   * (LUM-586). Null on machine-written runs.
   */
  verdictActionId: string | null
}

/** One VerificationRunWithdrawal tombstone, keyed as the schema keys it. */
export interface VerdictWithdrawal {
  taskId: string
  verdictActionId: string
}

/**
 * Withdrawals are unique per (taskId, verdictActionId) — key on both.
 *
 * The separator is written as the `\u0000` ESCAPE, never a literal NUL byte:
 * a raw control byte makes git classify this whole file as binary, so the
 * diff of the file implementing the honesty fix becomes unreviewable in a PR.
 * NUL is still the right separator — it cannot occur in a cuid, so no pair of
 * distinct (taskId, verdictActionId) can collide on a shared key.
 */
function withdrawalKey(taskId: string, verdictActionId: string): string {
  return `${taskId}\u0000${verdictActionId}`
}

/**
 * Send-backs that still count as history: every FAIL run whose verdict action
 * has not been withdrawn (LUM-586). A reviewer who fails a task and then
 * withdraws the verdict as a mistake has un-said it — `lumo task status`
 * already ignores it, and an anchor that did not would keep telling every
 * future agent in the class "this is how tasks here fail" on the strength of a
 * retracted review.
 *
 * This lives in the pure layer, not in the repository's where-clause, for the
 * same reason {@link crossingObservations} does: WHICH rows count is policy,
 * and this branch keeps policy out of the queries. The repository hands over
 * `verdictActionId` plus the tombstones and stays a dumb read.
 *
 * The exclusion rule is the one `isRunWithdrawn` defines in
 * lib/repositories/verification-run.repository.ts — in particular, a machine
 * run has a NULL verdictActionId and can never be withdrawn, so it always
 * counts. That helper is not imported here because its module imports Prisma
 * (this module must stay IO-free) and because it takes a single task's set of
 * action ids, while a reference class spans many tasks and must stay keyed on
 * the (taskId, verdictActionId) pair the schema is unique on.
 */
export function rejectionObservations(
  rows: RejectionRow[],
  withdrawals: VerdictWithdrawal[]
): Observation[] {
  const withdrawn = new Set(
    withdrawals.map(w => withdrawalKey(w.taskId, w.verdictActionId))
  )
  return rows
    .filter(
      r =>
        r.verdictActionId === null ||
        !withdrawn.has(withdrawalKey(r.taskId, r.verdictActionId))
    )
    .map(r => ({ taskId: r.taskId, key: r.rejectionReasonEnum }))
}

/**
 * How many tasks in the class delivered a contract that was still being
 * added to / edited after work started (LUM-610 independence signal, one
 * signal per task).
 */
export function countPostStartContractTasks(
  signals: Array<{ postStartChanges: number }>
): number {
  return signals.filter(s => s.postStartChanges > 0).length
}
