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
}
