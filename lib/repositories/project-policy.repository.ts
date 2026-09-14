/**
 * Repository for ProjectPolicy — the compiled rule set derived from a project's
 * CLAUDE.md/AGENTS.md files (LUM-590).
 *
 * Only this repository touches prisma.projectPolicy (LUM-483 service-layer rule).
 *
 * LUM-774: the table holds ONE row per (projectId, sourceHash) — a unique key
 * backs it. Concurrent recompiles of the same source (parallel sessions' hook
 * events after a compiler-version bump) collapse onto one row: the first
 * insert wins, a second is refused (`createIfAbsent` → false) and the loser
 * serves the winner's row. The newest row by `compiledAt` is the ACTIVE policy;
 * a previously compiled source that becomes current again (a revert) is
 * re-activated by bumping its `compiledAt` (`activateIfUnchanged`) instead of
 * inserting a duplicate.
 */
import { prisma } from '@/lib/db/prisma'
import type { PolicyRule } from '@/lib/services/policy/types'

export interface StoredProjectPolicy {
  id: string
  sourceHash: string
  rules: PolicyRule[]
  compiledAt: Date
}

const SELECT = {
  id: true,
  sourceHash: true,
  rules: true,
  compiledAt: true,
} as const

function toStored(row: {
  id: string
  sourceHash: string
  rules: unknown
  compiledAt: Date
}): StoredProjectPolicy {
  return {
    id: row.id,
    sourceHash: row.sourceHash,
    rules: row.rules as PolicyRule[],
    compiledAt: row.compiledAt,
  }
}

export const projectPolicyRepository = {
  /**
   * Returns the active (most recently compiled or re-activated) policy for a
   * project, or null if none exists yet.
   */
  async latestForProject(
    projectId: string
  ): Promise<StoredProjectPolicy | null> {
    const row = await prisma.projectPolicy.findFirst({
      where: { projectId },
      orderBy: { compiledAt: 'desc' },
      select: SELECT,
    })
    return row ? toStored(row) : null
  },

  /**
   * The row compiled from exactly this source (unique-key lookup), whether or
   * not it is the active one. Null when this source was never compiled.
   */
  async findByHash(
    projectId: string,
    sourceHash: string
  ): Promise<StoredProjectPolicy | null> {
    const row = await prisma.projectPolicy.findUnique({
      where: { projectId_sourceHash: { projectId, sourceHash } },
      select: SELECT,
    })
    return row ? toStored(row) : null
  },

  /**
   * Persists a freshly compiled policy snapshot unless a row for the same
   * (projectId, sourceHash) already exists — insert-or-ignore on the unique
   * key (`ON CONFLICT DO NOTHING`), so two instances racing to persist the
   * same compile can never both land. Returns true only for the insert that
   * actually created the row: that caller — and only that caller — owns the
   * follow-up (the POLICY_WEAKENING diff against the previous policy).
   */
  async createIfAbsent(input: {
    projectId: string
    sourceHash: string
    rules: PolicyRule[]
  }): Promise<boolean> {
    const { count } = await prisma.projectPolicy.createMany({
      data: [
        {
          projectId: input.projectId,
          sourceHash: input.sourceHash,
          rules: input.rules as unknown as object,
        },
      ],
      skipDuplicates: true,
    })
    return count === 1
  },

  /**
   * Makes an existing row the active policy again by moving its `compiledAt`
   * to `now` — but only if the row still carries the `compiledAt` the caller
   * saw (compare-and-swap). Two callers re-activating the same row see the
   * same old timestamp; the first update consumes it and the second matches
   * nothing. Returns true for the caller that won.
   */
  async activateIfUnchanged(
    id: string,
    seenCompiledAt: Date,
    now: Date
  ): Promise<boolean> {
    const { count } = await prisma.projectPolicy.updateMany({
      where: { id, compiledAt: seenCompiledAt },
      data: { compiledAt: now },
    })
    return count === 1
  },
}
