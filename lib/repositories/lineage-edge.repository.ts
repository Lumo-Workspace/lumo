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

/** One edge born in a session — the candidate set for LUM-300 usage voting. */
export interface SessionFragmentEdge {
  fragmentType: LineageFragmentType
  fragmentId: string
  used: boolean | null
  usedAt: Date | null
}

/** Per-fragment merge rate computed ONLY over tasks where the fragment was
 * actually used (used=true), task-deduped. Backs the LUM-300 usage signal. */
export interface FragmentUsageRate {
  fragmentType: LineageFragmentType
  fragmentId: string
  usedResolvedTasks: number
  usedMergedTasks: number
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
   * `sessionId` defaults to NULL; `outcome` is omitted unless provided so
   * the column default (UNKNOWN) applies. `skipDuplicates` makes re-injection of
   * the same (sessionId, taskId, fragmentType, fragmentId) a no-op — session-start
   * fires more than once per session (resume/clear/compact).
   * Dedup applies only to session-bound rows: Postgres treats NULLs as distinct,
   * so edges with `sessionId = null` are exempt from the unique constraint.
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
   * universe for presence-variance gating: the count of distinct tasks that
   * have at least one resolved (non-UNKNOWN) edge. Matches mergeRateByFragments'
   * `resolved` definition (global, NOT workspace-scoped) so equality checks
   * (resolvedTasks === universe) line up exactly.
   */
  async countResolvedTasks(tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['taskId'],
      where: { outcome: { not: 'UNKNOWN' } },
    })
    return rows.length
  },

  /** All edges born in a session — the candidate set for usage voting (LUM-300). */
  async findSessionFragmentEdges(
    sessionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<SessionFragmentEdge[]> {
    const client = tx ?? prisma
    return client.lineageEdge.findMany({
      where: { sessionId },
      select: {
        fragmentType: true,
        fragmentId: true,
        used: true,
        usedAt: true,
      },
    })
  },

  /**
   * Of the given sessions, which already carry a usage vote (any usedAt-stamped
   * edge)? The automatic audit skips these — a human vote (or a prior auto pass)
   * is authoritative. This is the LUM-314 idempotency guard.
   */
  async findVotedSessionIds(
    sessionIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set()
    const client = tx ?? prisma
    const rows = await client.lineageEdge.findMany({
      where: { sessionId: { in: sessionIds }, usedAt: { not: null } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    })
    return new Set(rows.map(r => r.sessionId).filter((s): s is string => !!s))
  },

  /**
   * Distinct session ids that (a) belong to a DONE task and (b) have at least
   * one not-yet-voted edge (usedAt = null). The cron backstop's work-list;
   * `limit` bounds each run so the first sweeps drain the dormant backlog over a
   * few hours instead of firing thousands of judge calls at once.
   */
  async listUnvotedSessionIdsForDoneTasks(
    limit: number,
    tx?: Prisma.TransactionClient
  ): Promise<string[]> {
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['sessionId'],
      where: { sessionId: { not: null }, usedAt: null, task: { status: 'DONE' } },
      orderBy: { sessionId: 'asc' },
      take: limit,
    })
    return rows
      .map(r => r.sessionId)
      .filter((s): s is string => s !== null)
  },

  /**
   * Record a usage vote over a session's edges.
   *
   * - `mode: 'replace'` (default, the manual `session wrap --used` path): voted
   *   refs → used=true, every OTHER edge of the session → used=false, all
   *   stamped usedAt=now. Last write wins.
   * - `mode: 'additive'` (the automatic LUM-314 judge): voted refs → used=true
   *   ONLY; every other edge is left untouched (stays NULL). Empty refs is a
   *   no-op. This guarantees the automatic path NEVER asserts used=false — an
   *   unproven "not used" is left honestly NULL.
   */
  async applyUsageVote(
    sessionId: string,
    usedRefs: FragmentRef[],
    opts: { mode?: 'replace' | 'additive'; tx?: Prisma.TransactionClient } = {}
  ): Promise<{ used: number; unused: number }> {
    const mode = opts.mode ?? 'replace'
    const client = opts.tx ?? prisma
    const now = new Date()

    if (usedRefs.length === 0) {
      if (mode === 'additive') return { used: 0, unused: 0 }
      const r = await client.lineageEdge.updateMany({
        where: { sessionId },
        data: { used: false, usedAt: now },
      })
      return { used: 0, unused: r.count }
    }

    const or = usedRefs.map(r => ({
      fragmentType: r.fragmentType,
      fragmentId: r.fragmentId,
    }))
    const usedRes = await client.lineageEdge.updateMany({
      where: { sessionId, OR: or },
      data: { used: true, usedAt: now },
    })
    if (mode === 'additive') return { used: usedRes.count, unused: 0 }

    const unusedRes = await client.lineageEdge.updateMany({
      where: { sessionId, NOT: { OR: or } },
      data: { used: false, usedAt: now },
    })
    return { used: usedRes.count, unused: unusedRes.count }
  },

  /**
   * Usage-gated merge rate: same task-dedupe as mergeRateByFragments, but a
   * (fragment, task) pair only counts when the fragment was voted used=true.
   * Cold-start gating (min sample) is the caller's responsibility.
   */
  async usageMergeRateByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentUsageRate[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
      where: {
        used: true,
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
        let usedResolvedTasks = 0
        let usedMergedTasks = 0
        for (const task of e.tasks.values()) {
          if (task.resolved) usedResolvedTasks++
          if (task.merged) usedMergedTasks++
        }
        return {
          fragmentType: e.fragmentType,
          fragmentId: e.fragmentId,
          usedResolvedTasks,
          usedMergedTasks,
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
   * Self-heal sweep for the lineage backfill (LUM-296). Stamps MERGED onto
   * every edge whose task is DONE and whose current outcome is still eligible
   * to advance (see {@link STAMPABLE_FROM}). This is the reconciliation path
   * for edges born *after* their task reached a terminal state: the
   * event-forward triggers (PR webhook / task→DONE) fired before the edge
   * existed and never re-fire, leaving it permanently UNKNOWN without this.
   *
   * System-wide (no workspace filter) — the caller is a system cron. Reuses the
   * same STAMPABLE_FROM.MERGED set as stampOutcomeByTask, so it is monotonic
   * (REWORKED is never in that set → reopened-then-remerged history is
   * preserved) and idempotent (a re-run after a full sweep changes nothing).
   * Returns Prisma's `{ count }` of rows changed.
   */
  async stampDoneTaskEdges(tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.lineageEdge.updateMany({
      where: {
        outcome: { in: STAMPABLE_FROM.MERGED },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
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
   * List a task's edges (oldest first) with the session cost columns needed by
   * the lineage audit view (`lumo task lineage <id>`). Separate from `listByTask`
   * so the lighter query stays available for callers that don't need cost.
   */
  async listByTaskWithCost(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.lineageEdge.findMany({
      where: { taskId },
      orderBy: { includedAt: 'asc' },
      include: {
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

  /**
   * Whether the task has any lineage edge (LUM-321 Lineage-tab presence). Same
   * `taskId` filter as `listByTaskWithCost` — every edge forms a group, so an
   * existing edge means the panel renders content. Cheap existence check for SSR.
   */
  async hasForTask(taskId: string): Promise<boolean> {
    const row = await prisma.lineageEdge.findFirst({
      where: { taskId },
      select: { id: true },
    })
    return row !== null
  },

  /**
   * Raw aggregates backing the LUM-314 signal-health view, workspace-scoped.
   * The service derives variance + merge-rate percentages. Four cheap groupBys.
   */
  async usageSignalAggregates(workspaceId: string) {
    const distRows = await prisma.lineageEdge.groupBy({
      by: ['used'],
      where: { workspaceId },
      _count: { _all: true },
    })
    const distribution = { used: 0, unused: 0, abstained: 0 }
    for (const r of distRows) {
      const n = r._count._all
      if (r.used === true) distribution.used += n
      else if (r.used === false) distribution.unused += n
      else distribution.abstained += n
    }

    const perSessionRows = await prisma.lineageEdge.groupBy({
      by: ['sessionId', 'used'],
      where: { workspaceId, sessionId: { not: null } },
      _count: { _all: true },
    })
    const bySession = new Map<string, { injected: number; used: number; voted: boolean }>()
    for (const r of perSessionRows) {
      if (!r.sessionId) continue
      const acc = bySession.get(r.sessionId) ?? { injected: 0, used: 0, voted: false }
      acc.injected += r._count._all
      if (r.used === true) acc.used += r._count._all
      if (r.used !== null) acc.voted = true
      bySession.set(r.sessionId, acc)
    }
    const perSession = [...bySession.entries()]
      .filter(([, v]) => v.voted)
      .map(([sessionId, v]) => ({ sessionId, injected: v.injected, used: v.used }))

    const usedTasks = await taskMergeRows({ workspaceId, used: true })
    const baseTasks = await taskMergeRows({
      workspaceId,
      outcome: { not: 'UNKNOWN' as const },
    })

    return { distribution, perSession, usedTasks, baseTasks }
  },
}

async function taskMergeRows(
  where: Prisma.LineageEdgeWhereInput
): Promise<{ taskId: string; resolved: boolean; merged: boolean }[]> {
  const rows = await prisma.lineageEdge.groupBy({
    by: ['taskId', 'outcome'],
    where,
  })
  const byTask = new Map<string, { resolved: boolean; merged: boolean }>()
  for (const r of rows) {
    const acc = byTask.get(r.taskId) ?? { resolved: false, merged: false }
    if (r.outcome !== 'UNKNOWN') acc.resolved = true
    if (r.outcome === 'MERGED') acc.merged = true
    byTask.set(r.taskId, acc)
  }
  return [...byTask.entries()].map(([taskId, v]) => ({ taskId, ...v }))
}
