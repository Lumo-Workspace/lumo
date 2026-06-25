/**
 * Repository for ProjectPolicy — the compiled rule set derived from a project's
 * CLAUDE.md/AGENTS.md files (LUM-590).
 *
 * Only this repository touches prisma.projectPolicy (LUM-483 service-layer rule).
 */
import { prisma } from '@/lib/db/prisma'
import type { PolicyRule } from '@/lib/services/policy/types'

export const projectPolicyRepository = {
  /**
   * Returns the most recently compiled policy for a project, or null if none
   * exists yet.
   */
  async latestForProject(
    projectId: string
  ): Promise<{ sourceHash: string; rules: PolicyRule[] } | null> {
    const row = await prisma.projectPolicy.findFirst({
      where: { projectId },
      orderBy: { compiledAt: 'desc' },
    })
    if (!row) return null
    return {
      sourceHash: row.sourceHash,
      rules: row.rules as unknown as PolicyRule[],
    }
  },

  /**
   * Persists a freshly compiled policy snapshot. One row per compilation —
   * the table is append-only; latestForProject always reads the newest row.
   */
  async create(input: {
    projectId: string
    sourceHash: string
    rules: PolicyRule[]
  }): Promise<void> {
    await prisma.projectPolicy.create({
      data: {
        projectId: input.projectId,
        sourceHash: input.sourceHash,
        rules: input.rules as unknown as object,
      },
    })
  },
}
