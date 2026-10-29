import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  LineageDisclosure,
  LineageFragmentType,
  LineageOutcome,
} from '@prisma/client'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { aiFeatureOffWorkspaceWhere } from '@/lib/repositories/ai-feature-switch.repository'
import type { AiFeature } from '@/lib/ai-features/registry'

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
  disclosure?: LineageDisclosure
  indexTokens?: number
  fullTokens?: number
  relevanceScore?: number
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

/** Polymorphic fragment identity (type + id), used to scope aggregate queries.
 * `disclosure` (LUM-500) is the Tier-1/2 tag carried from session-start so the
 * lineage edge records whether the fragment was injected as full content (FULL)
 * or as an addressable index/manifest (INDEX). Optional — omit → DB default
 * FULL — so aggregate-query callers that don't tag edges are unaffected. */
export interface FragmentRef {
  fragmentType: LineageFragmentType
  fragmentId: string
  disclosure?: LineageDisclosure
  indexTokens?: number
  fullTokens?: number
  relevanceScore?: number
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

/**
 * LUM-539 judged-used track record, task-deduped, accumulated across every task
 * a fragment appeared in. Merge OUTCOME is deliberately absent — the RFC LUM-535
 *口径 retires the merge-rate signal (a ~100% workspace merge base rate makes it
 * non-discriminative) and replaces it with "of the N tasks this appeared in, in
 * X was it judged actually used".
 *
 * Three task counts (all birth-task self-credit excluded, LUM-461):
 * - `judgedUsedTasks` — distinct tasks with a used=true edge (the numerator).
 * - `auditedTasks`    — distinct tasks that returned a verdict (used != null).
 *   Never-audited (used=NULL) appearances are EXCLUDED here, so abstention is
 *   not counted as negative evidence (guardrail: judged-used is a lower bound).
 * - `appearanceTasks` — distinct tasks the fragment appeared in at all. The
 *   honest "N" in the X-of-N readout.
 */
export interface FragmentJudgedUsage {
  fragmentType: LineageFragmentType
  fragmentId: string
  judgedUsedTasks: number
  auditedTasks: number
  appearanceTasks: number
}

/** Most recent used=true vote per fragment — the recency input to the LUM-328
 * forgetting-curve ranking. Fragments never voted used are simply absent. */
export interface FragmentLastUsed {
  fragmentType: LineageFragmentType
  fragmentId: string
  lastUsedAt: Date
}

function emptyByOutcome(): Record<LineageOutcome, number> {
  return { MERGED: 0, REJECTED: 0, REWORKED: 0, UNKNOWN: 0 }
}

function fragmentKey(
  fragmentType: LineageFragmentType,
  fragmentId: string
): string {
  return `${fragmentType}::${fragmentId}`
}

/** One grouped edge row (fragment × task × outcome) as returned by groupBy. */
interface DedupeRow {
  fragmentType: LineageFragmentType
  fragmentId: string
  taskId: string
  outcome: LineageOutcome
}

/** One grouped edge row (fragment × task × used) for the LUM-539 judged-used fold. */
interface JudgedRow {
  fragmentType: LineageFragmentType
  fragmentId: string
  taskId: string
  used: boolean | null
}

/** Minimal shape every foldable groupBy row shares. */
interface FoldBaseRow {
  fragmentType: LineageFragmentType
  fragmentId: string
  taskId: string
}

interface PerFragmentFold<T> {
  fragmentType: LineageFragmentType
  fragmentId: string
  tasks: Map<string, T>
}

type PerFragmentDedupe = PerFragmentFold<{ resolved: boolean; merged: boolean }>

/**
 * Generic core: collapse grouped (fragment, task, …) rows into per-fragment task
 * sets, deduping multiple runs of one task into a single per-task accumulator.
 *
 * LUM-461 same-task self-credit exclusion: the (fragment, task) pair is dropped
 * when `task` is one of the fragment's birth tasks, so a memory earns no credit
 * for the task that created it. Birth sets are resolved only for MEMORY fragments
 * (others have no birth concept); see
 * `memoryProvenanceRepository.birthTaskIdsByMemory`. Single-sourced here so the
 * merge-rate path (LUM-278/300) and the judged-used path (LUM-539) can never
 * drift on this invariant.
 */
async function foldTasksWithBirthExclusion<R extends FoldBaseRow, T>(
  rows: R[],
  fragments: FragmentRef[],
  tx: Prisma.TransactionClient | undefined,
  makeTaskAcc: () => T,
  applyRow: (acc: T, row: R) => void
): Promise<Map<string, PerFragmentFold<T>>> {
  const memoryIds = fragments
    .filter(f => f.fragmentType === 'MEMORY')
    .map(f => f.fragmentId)
  const birthByFragment =
    memoryIds.length > 0
      ? await memoryProvenanceRepository.birthTaskIdsByMemory(memoryIds, tx)
      : new Map<string, Set<string>>()

  const perFragment = new Map<string, PerFragmentFold<T>>()
  for (const row of rows) {
    if (birthByFragment.get(row.fragmentId)?.has(row.taskId)) continue
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
      task = makeTaskAcc()
      entry.tasks.set(row.taskId, task)
    }
    applyRow(task, row)
  }
  return perFragment
}

/**
 * Collapse grouped (fragment, task, outcome) rows into per-fragment task sets,
 * deduping multiple runs of one task to a single resolved/merged flag — shared
 * by the presence- and usage-gated merge-rate queries.
 */
function foldByTaskWithBirthExclusion(
  rows: DedupeRow[],
  fragments: FragmentRef[],
  tx?: Prisma.TransactionClient
): Promise<Map<string, PerFragmentDedupe>> {
  return foldTasksWithBirthExclusion<
    DedupeRow,
    { resolved: boolean; merged: boolean }
  >(
    rows,
    fragments,
    tx,
    () => ({ resolved: false, merged: false }),
    (task, row) => {
      if (row.outcome !== 'UNKNOWN') task.resolved = true
      if (row.outcome === 'MERGED') task.merged = true
    }
  )
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
        ...(i.disclosure ? { disclosure: i.disclosure } : {}),
        ...(i.indexTokens != null ? { indexTokens: i.indexTokens } : {}),
        ...(i.fullTokens != null ? { fullTokens: i.fullTokens } : {}),
        ...(i.relevanceScore != null
          ? { relevanceScore: i.relevanceScore }
          : {}),
      })),
    })
  },

  /**
   * Stamp `pulledAt` on the unfetched edge that matches the given
   * (sessionId, fragmentType, fragmentId) triple. The `pulledAt: null` guard
   * makes the stamp idempotent — a second pull of the same fragment in the same
   * session is a no-op. Returns the number of rows updated (0 or 1).
   */
  async recordPull(
    ref: {
      sessionId: string
      fragmentType: LineageFragmentType
      fragmentId: string
    },
    pulledAt: Date
  ): Promise<number> {
    const res = await prisma.lineageEdge.updateMany({
      where: { ...ref, pulledAt: null },
      data: { pulledAt },
    })
    return res.count
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
   *
   * LUM-461: the (fragment, task) pair where `task` is the MEMORY fragment's
   * birth task is excluded from both numerator and denominator — a memory earns
   * no merge contribution for the task that created it (self-credit). Folded in
   * here so every consumer (LUM-279 tier, LUM-300 variance) is cleaned without
   * changing its call site.
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

    const perFragment = await foldByTaskWithBirthExclusion(rows, fragments, tx)

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
   * LUM-573: distinct session ids that produced a MERGED-stamped lineage edge
   * for a task — the DB fact of delivery (a session that injected context for
   * the work that merged), as opposed to a trailing exploration/wrap-up session
   * that injected nothing and so carries no edge. Used to anchor the task's
   * claim to the delivery session instead of the latest-by-activity one. Empty
   * when no session edge is MERGED yet (pre-merge, or the outcome stamp / cron
   * sweep hasn't run); the caller falls back to the latest session.
   */
  async findMergedSessionIds(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<string[]> {
    const client = tx ?? prisma
    const rows = await client.lineageEdge.findMany({
      where: { taskId, outcome: 'MERGED', sessionId: { not: null } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    })
    return rows.map(r => r.sessionId).filter((s): s is string => s !== null)
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
    tx?: Prisma.TransactionClient,
    /** LUM-1338: leave out tasks in workspaces that switched this off. */
    opts: { skipFeatureOff?: AiFeature } = {}
  ): Promise<string[]> {
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { not: null },
        usedAt: null,
        task: {
          status: 'DONE',
          ...(opts.skipFeatureOff && {
            project: {
              workspace: {
                NOT: aiFeatureOffWorkspaceWhere(opts.skipFeatureOff),
              },
            },
          }),
        },
      },
      orderBy: { sessionId: 'asc' },
      take: limit,
    })
    return rows.map(r => r.sessionId).filter((s): s is string => s !== null)
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
   * LUM-522: additively mark specific fragments used=false for a session —
   * ONLY where `used` is currently NULL, so an existing true is never demoted
   * and a later true is never blocked. No-op on empty input.
   */
  async applyUnusedVote(
    sessionId: string,
    unusedRefs: FragmentRef[],
    opts: { tx?: Prisma.TransactionClient } = {}
  ): Promise<{ unused: number }> {
    if (unusedRefs.length === 0) return { unused: 0 }
    const client = opts.tx ?? prisma
    const or = unusedRefs.map(r => ({
      fragmentType: r.fragmentType,
      fragmentId: r.fragmentId,
    }))
    const res = await client.lineageEdge.updateMany({
      where: { sessionId, used: null, OR: or },
      data: { used: false, usedAt: new Date() },
    })
    return { unused: res.count }
  },

  /**
   * Usage-gated merge rate: same task-dedupe as mergeRateByFragments, but a
   * (fragment, task) pair only counts when the fragment was voted used=true.
   * Cold-start gating (min sample) is the caller's responsibility. The LUM-461
   * birth-task self-credit exclusion applies here too.
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

    const perFragment = await foldByTaskWithBirthExclusion(rows, fragments, tx)

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
   * LUM-539 judged-used track record per fragment, task-deduped and accumulated
   * across EVERY task the fragment appeared in (cross-task, cross-session). For
   * each fragment returns `judgedUsedTasks` / `auditedTasks` / `appearanceTasks`
   * (see {@link FragmentJudgedUsage}). Merge outcome is intentionally not read —
   * this is the signal that REPLACES the merge-rate trust口径 (RFC LUM-535). The
   * LUM-461 birth-task self-credit exclusion applies (via the shared fold), so a
   * memory earns no track record for the task that created it. Cold-start /
   * retire gating is the caller's responsibility (see lineage-signal.ts).
   */
  async judgedUsageByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentJudgedUsage[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId', 'taskId', 'used'],
      where: {
        OR: fragments.map(f => ({
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
        })),
      },
      _count: { _all: true },
    })

    const perFragment = await foldTasksWithBirthExclusion<
      JudgedRow,
      { audited: boolean; judgedUsed: boolean }
    >(
      rows,
      fragments,
      tx,
      () => ({ audited: false, judgedUsed: false }),
      (task, row) => {
        if (row.used !== null) task.audited = true
        if (row.used === true) task.judgedUsed = true
      }
    )

    return fragments
      .map(f => perFragment.get(fragmentKey(f.fragmentType, f.fragmentId)))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map(e => {
        let judgedUsedTasks = 0
        let auditedTasks = 0
        for (const task of e.tasks.values()) {
          if (task.audited) auditedTasks++
          if (task.judgedUsed) judgedUsedTasks++
        }
        return {
          fragmentType: e.fragmentType,
          fragmentId: e.fragmentId,
          judgedUsedTasks,
          auditedTasks,
          appearanceTasks: e.tasks.size,
        }
      })
  },

  /**
   * Most recent used=true vote timestamp per fragment. Rows whose max usedAt
   * is NULL (defensive — used=true writes always stamp usedAt) are dropped so
   * callers can treat presence in the result as "has a recency signal".
   */
  async lastUsedAtByFragments(
    fragments: FragmentRef[],
    tx?: Prisma.TransactionClient
  ): Promise<FragmentLastUsed[]> {
    if (fragments.length === 0) return []
    const client = tx ?? prisma
    const rows = await client.lineageEdge.groupBy({
      by: ['fragmentType', 'fragmentId'],
      where: {
        used: true,
        OR: fragments.map(f => ({
          fragmentType: f.fragmentType,
          fragmentId: f.fragmentId,
        })),
      },
      _max: { usedAt: true },
    })
    return rows.flatMap(row =>
      row._max.usedAt
        ? [
            {
              fragmentType: row.fragmentType,
              fragmentId: row.fragmentId,
              lastUsedAt: row._max.usedAt,
            },
          ]
        : []
    )
  },

  /**
   * Stamp a closing `outcome` onto every edge of a task whose current outcome
   * is eligible to advance (see {@link STAMPABLE_FROM}). Returns Prisma's
   * `{ count }` of rows changed. Idempotent: re-stamping the same verdict matches
   * nothing the second time. Coarse by design — edges are keyed by `taskId`,
   * not by the specific PR/session, so this stamps relevance
   * (was-in-context + outcome co-occurred), not causality (DoD ③).
   */
  async stampOutcomeByTask(
    taskId: string,
    outcome: StampableOutcome,
    opts: { tx?: Prisma.TransactionClient } = {}
  ) {
    const client = opts.tx ?? prisma
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
   * Returns `{ count }` of outcome rows advanced.
   */
  async stampDoneTaskEdges(tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    const advanced = await client.lineageEdge.updateMany({
      where: {
        outcome: { in: STAMPABLE_FROM.MERGED },
        task: { status: 'DONE' },
      },
      data: { outcome: 'MERGED' },
    })
    return { count: advanced.count }
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
    const bySession = new Map<
      string,
      { injected: number; used: number; voted: boolean }
    >()
    for (const r of perSessionRows) {
      if (!r.sessionId) continue
      const acc = bySession.get(r.sessionId) ?? {
        injected: 0,
        used: 0,
        voted: false,
      }
      acc.injected += r._count._all
      if (r.used === true) acc.used += r._count._all
      if (r.used !== null) acc.voted = true
      bySession.set(r.sessionId, acc)
    }
    const perSession = [...bySession.entries()]
      .filter(([, v]) => v.voted)
      .map(([sessionId, v]) => ({
        sessionId,
        injected: v.injected,
        used: v.used,
      }))

    const usedTasks = await taskMergeRows({ workspaceId, used: true })
    const baseTasks = await taskMergeRows({
      workspaceId,
      outcome: { not: 'UNKNOWN' as const },
    })

    return { distribution, perSession, usedTasks, baseTasks }
  },

  /**
   * LUM-521 progressive-disclosure funnel, workspace-scoped edge counts:
   *   impressions = all edges
   *   index       = edges injected as an addressable INDEX (LUM-500)
   *   pulled      = INDEX edges whose body was pulled on demand (pulledAt set)
   *   used        = edges voted used=true
   * `pulled` is scoped to INDEX so the read-side `pulled / index` rate answers
   * "of the lean-index fragments, how many needed their full body". Four cheap
   * counts; the service derives the percentages.
   */
  async disclosureFunnelAggregates(workspaceId: string): Promise<{
    impressions: number
    index: number
    pulled: number
    used: number
    /** LUM-522: Σ(fullTokens − indexTokens) over un-pulled INDEX edges that
     *  carry both token columns. Null when no such edges exist yet. */
    tokensSaved: number | null
  }> {
    const [impressions, index, pulled, used, tokenAgg] = await Promise.all([
      prisma.lineageEdge.count({ where: { workspaceId } }),
      prisma.lineageEdge.count({ where: { workspaceId, disclosure: 'INDEX' } }),
      prisma.lineageEdge.count({
        where: { workspaceId, disclosure: 'INDEX', pulledAt: { not: null } },
      }),
      prisma.lineageEdge.count({ where: { workspaceId, used: true } }),
      prisma.lineageEdge.aggregate({
        where: {
          workspaceId,
          disclosure: 'INDEX',
          pulledAt: null,
          indexTokens: { not: null },
          fullTokens: { not: null },
        },
        _sum: { fullTokens: true, indexTokens: true },
        _count: { _all: true },
      }),
    ])
    const tokenCount = tokenAgg._count._all
    // Sum-difference (Σfull − Σindex) rather than the single-task path's
    // per-edge Σmax(0, full−index). The two agree because fullTokens ≥
    // indexTokens always holds (the full rendered body ⊇ its one-line manifest;
    // asserted in session-start-fragments). The outer Math.max(0, …) clamps the
    // pathological case so this can never report negative savings.
    const tokensSaved =
      tokenCount > 0
        ? Math.max(
            0,
            (tokenAgg._sum.fullTokens ?? 0) - (tokenAgg._sum.indexTokens ?? 0)
          )
        : null
    return { impressions, index, pulled, used, tokensSaved }
  },
}

/**
 * Per-task resolved/merged rollup backing the LUM-314 signal-health vs-base
 * 口径. Grouped by fragment FIRST so the LUM-461 birth-task self-credit
 * exclusion can run via the shared `foldByTaskWithBirthExclusion` fold (a memory
 * earns no merge contribution for the task that created it), then re-collapsed
 * across fragments to one resolved/merged flag per task — a task survives if it
 * has at least one non-birth surviving (fragment, task) pair. This keeps the
 * `--signal` used/base rates consistent with the per-fragment Flywheel path
 * (mergeRateByFragments / usageMergeRateByFragments), which LUM-485 wires up.
 */
async function taskMergeRows(
  where: Prisma.LineageEdgeWhereInput
): Promise<{ taskId: string; resolved: boolean; merged: boolean }[]> {
  const rows = await prisma.lineageEdge.groupBy({
    by: ['fragmentType', 'fragmentId', 'taskId', 'outcome'],
    where,
  })
  const fragments = [
    ...new Map(
      rows.map(r => [
        fragmentKey(r.fragmentType, r.fragmentId),
        { fragmentType: r.fragmentType, fragmentId: r.fragmentId },
      ])
    ).values(),
  ]
  const perFragment = await foldByTaskWithBirthExclusion(rows, fragments)

  const byTask = new Map<string, { resolved: boolean; merged: boolean }>()
  for (const entry of perFragment.values()) {
    for (const [taskId, t] of entry.tasks) {
      const acc = byTask.get(taskId) ?? { resolved: false, merged: false }
      acc.resolved = acc.resolved || t.resolved
      acc.merged = acc.merged || t.merged
      byTask.set(taskId, acc)
    }
  }
  return [...byTask.entries()].map(([taskId, v]) => ({ taskId, ...v }))
}
