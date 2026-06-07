import { prisma } from '@/lib/db/prisma'
import type { Prisma, LineageFragmentType, LineageOutcome } from '@prisma/client'

/**
 * One lineage edge to persist: a context fragment that was injected into a
 * task's context (optionally during a specific session/run). `outcome` is
 * normally left unset at birth — the column defaults to UNKNOWN and is stamped
 * later when the edge closes (PR merged / task done).
 */
export interface CreateLineageEdgeInput {
  workspaceId: string
  taskId: string
  fragmentType: LineageFragmentType
  fragmentId: string
  sessionId?: string | null
  runId?: string | null
  outcome?: LineageOutcome
}

/** A closing verdict that can be stamped onto an edge — everything but the
 * UNKNOWN birth state, which `stampOutcomeByTask` never targets. */
export type StampableOutcome = Exclude<LineageOutcome, 'UNKNOWN'>

/** Outcomes a stamp may overwrite, keyed by the stamp target. Encodes a
 * monotonic precedence ladder so a late or weak signal never downgrades a
 * stronger verdict, and stamping is idempotent under redelivery (a merge seen
 * by both the webhook and the poller stamps once, then no-ops):
 *   UNKNOWN → REJECTED → MERGED   (advance only)
 *   MERGED  → REWORKED            (lateral: merged work that had to be redone)
 *
 * REWORKED is intentionally terminal — it is not in any target's source set,
 * so re-completing a reopened task does NOT restamp those edges back to MERGED.
 * The verdict records a historical fact ("this merged work had to be redone")
 * that a later success does not erase. Consequence: a fragment that fed
 * reworked-then-remerged work is not counted toward merge contribution. That
 * undercount is accepted for the MVP; revisit if the flywheel signal needs it.
 * (Guarded by the "REWORKED is sticky" test.) */
const STAMPABLE_FROM: Record<StampableOutcome, LineageOutcome[]> = {
  REJECTED: ['UNKNOWN'],
  MERGED: ['UNKNOWN', 'REJECTED'],
  REWORKED: ['MERGED'],
}

/** Polymorphic fragment identity (type + id), used to scope aggregate queries. */
export interface FragmentRef {
  fragmentType: LineageFragmentType
  fragmentId: string
}

/** Per-fragment rollup of edge outcomes, returned by `aggregateByFragments`. */
export interface FragmentStats {
  fragmentType: LineageFragmentType
  fragmentId: string
  total: number
  /** Convenience accessor for `byOutcome.MERGED` — drives the "merge contribution" signal. */
  merged: number
  byOutcome: Record<LineageOutcome, number>
}

/** Per-fragment, task-deduped merge counts. Backs the LUM-278 flywheel signal. */
export interface FragmentMergeRate {
  fragmentType: LineageFragmentType
  fragmentId: string
  /** Distinct tasks where this fragment appeared with a resolved (non-UNKNOWN) outcome. */
  resolvedTasks: number
  /** Distinct tasks (subset of resolvedTasks) where this fragment appeared with a MERGED edge. */
  mergedTasks: number
}

function emptyByOutcome(): Record<LineageOutcome, number> {
  return { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 }
}

function fragmentKey(fragmentType: LineageFragmentType, fragmentId: string): string {
  return `${fragmentType}::${fragmentId}`
}

export const lineageEdgeRepository = {
  /**
   * Batch-insert lineage edges. No-op (returns `{ count: 0 }`) for an empty
   * batch so callers can pass the result of a filter without guarding. Optional
   * `sessionId`/`runId` default to NULL; `outcome` is omitted unless provided so
   * the column default (UNKNOWN) applies. `skipDuplicates` makes re-injection of
   * the same (sessionId, taskId, fragmentType, fragmentId) a no-op — session-start
   * fires more than once per session (resume/clear/compact).
   * Dedup applies only to session-bound rows: Postgres treats NULLs as distinct,
   * so edges with `sessionId = null` (future runId-only edges) are exempt from
   * the unique constraint.
   */
  async createMany(
    inputs: CreateLineageEdgeInput[],
    tx?: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    const client = tx ?? prisma
    return client.lineageEdge.createMany({
      skipDuplicates: true,
      data: inputs.map(i => ({
        workspaceId: i.workspaceId,
        taskId: i.taskId,
        fragmentType: i.fragmentType,
        fragmentId: i.fragmentId,
        sessionId: i.sessionId ?? null,
        runId: i.runId ?? null,
        ...(i.outcome ? { outcome: i.outcome } : {}),
      })),
    })
  },

  /**
   * Aggregate edge outcomes per fragment, scoped to the given fragments.
   * Returns one entry per requested fragment that has at least one edge, in the
   * order requested (fragments with no history are omitted — cold-start gating
   * is left to the caller). Empty input short-circuits to `[]`.
   */
  async aggregateByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentStats[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId', 'outcome'],
      where: {
        OR: fragments.map(f => ({
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
        })),
      },
      _count: { _all: true },
    })

    const byKey = new Map<string, FragmentStats>()
    for (const row of rows) {
      const key = fragmentKey(row.fragmentType, row.fragmentId)
      let entry = byKey.get(key)
      if (!entry) {
        entry = {
          fragmentType: row.fragmentType,
          fragmentId: row.fragmentId,
          total: 0,
          merged: 0,
          byOutcome: emptyByOutcome(),
        }
        byKey.set(key, entry)
      }
      const count = row._count._all
      entry.byOutcome[row.outcome] += count
      entry.total += count
    }
    for (const entry of byKey.values()) {
      entry.merged = entry.byOutcome.MERGED
    }

    return fragments
      .map(f => byKey.get(fragmentKey(f.fragmentType, f.fragmentId)))
      .filter((e): e is FragmentStats => e !== undefined)
  },

  /**
   * Per-fragment merge rate, DEDUPED BY TASK. A (fragment, task) pair counts as
   * `resolved` if it has any non-UNKNOWN edge and `merged` if it has any MERGED
   * edge — so multiple runs/sessions of the same task collapse to one. This is
   * the correct denominator for the "merge contribution" signal; do NOT use
   * `aggregateByFragments` (it counts edges, double-counting multi-run tasks).
   * Cold-start gating (min sample size) is the caller's responsibility.
   */
  async mergeRateByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentMergeRate[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
      where: {
        OR: fragments.map(f => ({
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
        })),
      },
      _count: { _all: true },
    })

    const perFragment = new Map<
      string,
      {
        fragmentType: LineageFragmentType
        fragmentId: string
        tasks: Map<string, { resolved: boolean; merged: boolean }>
      }
    >()
    for (const row of rows) {
      const fKey = fragmentKey(row.fragmentType, row.fragmentId)
      let entry = perFragment.get(fKey)
      if (!entry) {
        entry = {
          fragmentType: row.fragmentType,
          fragmentId: row.fragmentId,
          tasks: new Map(),
        }
        perFragment.set(fKey, entry)
      }
      let task = entry.tasks.get(row.taskId)
      if (!task) {
        task = { resolved: false, merged: false }
        entry.tasks.set(row.taskId, task)
      }
      if (row.outcome !== 'UNKNOWN') task.resolved = true
      if (row.outcome === 'MERGED') task.merged = true
    }

    return fragments
      .map(f => perFragment.get(fragmentKey(f.fragmentType, f.fragmentId)))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map(e => {
        let resolvedTasks = 0
        let mergedTasks = 0
        for (const task of e.tasks.values()) {
          if (task.resolved) resolvedTasks++
          if (task.merged) mergedTasks++
        }
        return {
          fragmentType: e.fragmentType,
          fragmentId: e.fragmentId,
          resolvedTasks,
          mergedTasks,
        }
      })
  },

  /**
   * Stamp a closing `outcome` onto every edge of a task whose current outcome
   * is eligible to advance (see {@link STAMPABLE_FROM}). Returns Prisma's
   * `{ count }` of rows changed. Idempotent: re-stamping the same verdict
   * matches nothing the second time. Coarse by design — edges are keyed by
   * `taskId`, not by the specific PR/session, so this stamps relevance
   * (was-in-context + outcome co-occurred), not causality (DoD ③).
   */
  async stampOutcomeByTask(
    taskId: string,
    outcome: StampableOutcome,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.lineageEdge.updateMany({
      where: { taskId, outcome: { in: STAMPABLE_FROM[outcome] } },
      data: { outcome },
    })
  },

  /**
   * List all edges for a task, oldest first. Backs the lineage audit view
   * (`lumo task lineage <id>`).
   */
  async listByTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.lineageEdge.findMany({
      where: { taskId },
      orderBy: { includedAt: 'asc' },
    })
  },

  /**
   * List a task's edges (oldest first) with the run and session cost columns
   * needed by the lineage audit view (`lumo task lineage <id>`). Separate from
   * `listByTask` so the lighter query stays available for callers that don't
   * need cost. The selected shape is accepted directly by `getEdgeCost`.
   */
  async listByTaskWithCost(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.lineageEdge.findMany({
      where: { taskId },
      orderBy: { includedAt: 'asc' },
      include: {
        run: {
          select: {
            id: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
            loopCount: true,
          },
        },
        session: {
          select: {
            id: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadTokens: true,
            cacheCreationTokens: true,
            loopCount: true,
          },
        },
      },
    })
  },
}
