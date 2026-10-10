/**
 * LUM-1068 — the core's stored `## Forbidden` rule set per project
 * (`ForbiddenRuleSnapshot`). Only this repository touches
 * prisma.forbiddenRuleSnapshot.
 *
 * Single-writer contract: the first observation inserts (insert-or-ignore on
 * the unique projectId); every later change is a compare-and-swap on the
 * source hash the caller read, so of several instances observing the same
 * edit exactly one wins — and only the winner records the removed rules.
 */
import { prisma } from '@/lib/db/prisma'
import {
  parseStoredForbiddenRules,
  type ForbiddenRule,
} from '@/lib/boundary-crossing/forbidden-rules'

export interface StoredForbiddenRuleSnapshot {
  sourceHash: string
  /** The source hash before the last change (null on the baseline). */
  previousSourceHash: string | null
  rules: ForbiddenRule[]
  /** When the snapshot last changed (set by the application clock). */
  updatedAt: Date
}

export const forbiddenRuleSnapshotRepository = {
  async findByProject(
    projectId: string
  ): Promise<StoredForbiddenRuleSnapshot | null> {
    const row = await prisma.forbiddenRuleSnapshot.findUnique({
      where: { projectId },
      select: {
        sourceHash: true,
        previousSourceHash: true,
        rules: true,
        updatedAt: true,
      },
    })
    return row
      ? {
          sourceHash: row.sourceHash,
          previousSourceHash: row.previousSourceHash,
          rules: parseStoredForbiddenRules(row.rules),
          updatedAt: row.updatedAt,
        }
      : null
  },

  /** The baseline. False when another caller inserted first. */
  async createIfAbsent(input: {
    projectId: string
    sourceHash: string
    rules: readonly ForbiddenRule[]
  }): Promise<boolean> {
    const { count } = await prisma.forbiddenRuleSnapshot.createMany({
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
   * Move the snapshot from the source the caller read (`fromSourceHash`) to
   * the new one. False when it already moved (another caller won).
   */
  async advance(input: {
    projectId: string
    fromSourceHash: string
    sourceHash: string
    rules: readonly ForbiddenRule[]
  }): Promise<boolean> {
    const { count } = await prisma.forbiddenRuleSnapshot.updateMany({
      where: { projectId: input.projectId, sourceHash: input.fromSourceHash },
      data: {
        sourceHash: input.sourceHash,
        previousSourceHash: input.fromSourceHash,
        rules: input.rules as unknown as object,
        updatedAt: new Date(),
      },
    })
    return count === 1
  },
}
