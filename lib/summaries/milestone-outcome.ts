import type { OutcomeSignalKind, TaskStatus } from '@prisma/client'

/**
 * LUM-626 — milestone outcome rollup.
 *
 * Aggregates the milestone's member tasks into an Overview "outcome" section:
 * (1) hard results — each DONE task's frozen claim snapshot (LUM-573/597); a
 * DONE task without a claim stays visible as an explicit no-claim row, never
 * silently dropped; (2) post-delivery fate from the outcome well (LUM-598).
 *
 * Falsifier invariant (inherited from the well): the fate rollup has exactly
 * two states — REJECTED (≥1 OutcomeSignal, broken down by kind) and
 * INCONCLUSIVE (zero signals). There is deliberately no satisfied/pass third
 * state anywhere in the output shape. Rejection scanning covers ALL member
 * tasks, not just DONE ones: a REOPENED task has left DONE, and narrowing the
 * scan to DONE would make exactly the rejections we must surface vanish.
 */

/** One milestone task row fed into the rollup (parent extracts flat fields). */
export interface OutcomeTaskRow {
  id: string
  /** Display reference, e.g. "LUM-283". */
  ref: string
  title: string
  status: TaskStatus
  claimSnapshot: string | null
  claimSnapshotSource: string | null
}

/** One `(taskId, kind)` rejection-signal count from the repository groupBy. */
export interface OutcomeSignalCountRow {
  taskId: string
  kind: OutcomeSignalKind
  count: number
}

export interface MilestoneOutcomeClaim {
  taskId: string
  ref: string
  title: string
  /** Frozen claim text; `null` renders as an explicit no-claim row. */
  claim: string | null
  /** Claim provenance ('AGENT' | 'RUN_SUMMARY' | 'DIGEST'); null when no claim. */
  source: string | null
}

export interface MilestoneOutcomeRejection {
  taskId: string
  ref: string
  title: string
  /** Signal-kind breakdown, highest count first (kind name tiebreak). */
  kinds: Array<{ kind: OutcomeSignalKind; count: number }>
}

export interface MilestoneOutcome {
  /** DONE tasks in input order, one row each — with or without a claim. */
  claims: MilestoneOutcomeClaim[]
  fate: {
    /** Number of DONE (delivered) member tasks. */
    doneCount: number
    /** Every member task carrying ≥1 well signal — including reopened ones. */
    rejected: MilestoneOutcomeRejection[]
    /** DONE tasks with zero signals: no rejection on record — never a pass. */
    inconclusiveCount: number
  }
}

/**
 * Derive a milestone's outcome section from its task rows and the well's
 * `(taskId, kind)` signal counts. Pure and deterministic. Signal rows whose
 * task is not in `tasks` are ignored; zero/negative counts are dropped.
 */
export function computeMilestoneOutcome(
  tasks: OutcomeTaskRow[],
  signalCounts: OutcomeSignalCountRow[]
): MilestoneOutcome {
  const kindsByTask = new Map<
    string,
    Array<{ kind: OutcomeSignalKind; count: number }>
  >()
  for (const row of signalCounts) {
    if (row.count <= 0) continue
    const list = kindsByTask.get(row.taskId) ?? []
    list.push({ kind: row.kind, count: row.count })
    kindsByTask.set(row.taskId, list)
  }
  for (const list of kindsByTask.values()) {
    list.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
  }

  const claims: MilestoneOutcomeClaim[] = []
  const rejected: MilestoneOutcomeRejection[] = []
  let rejectedDoneCount = 0

  for (const task of tasks) {
    const kinds = kindsByTask.get(task.id)
    if (task.status === 'DONE') {
      const hasClaim = (task.claimSnapshot?.trim().length ?? 0) > 0
      claims.push({
        taskId: task.id,
        ref: task.ref,
        title: task.title,
        claim: hasClaim ? task.claimSnapshot : null,
        source: hasClaim ? task.claimSnapshotSource : null,
      })
      if (kinds) rejectedDoneCount += 1
    }
    if (kinds) {
      rejected.push({
        taskId: task.id,
        ref: task.ref,
        title: task.title,
        kinds,
      })
    }
  }

  return {
    claims,
    fate: {
      doneCount: claims.length,
      rejected,
      inconclusiveCount: claims.length - rejectedDoneCount,
    },
  }
}
