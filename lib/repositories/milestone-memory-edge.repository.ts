import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

/** One MILESTONE-scope memory injected into a steward session. */
export interface InjectionRow {
  memoryId: string
  /** The milestone the memory was distilled from (Memory.milestoneId). */
  sourceMilestoneId: string | null
}

export interface RecordInjectionInput {
  workspaceId: string
  /** The later milestone whose steward session consumed the memory. */
  consumerMilestoneId: string
  /** The steward session the memory was injected into. */
  sessionId: string
  rows: InjectionRow[]
}

export interface SessionEdge {
  memoryId: string
  sourceMilestoneId: string | null
  used: boolean | null
  usedAt: Date | null
}

/** Raw counts behind the cross-milestone learning-migration read-out. */
export interface MilestoneUsageAggregate {
  /** All edges for this consumer milestone. */
  injected: number
  /** used=true. */
  judgedUsed: number
  /** used=false. */
  judgedUnused: number
  /** used=null (not yet audited / judge abstained). */
  abstained: number
  /** distinct non-null sourceMilestoneId. */
  sourceMilestones: number
}

/**
 * LUM-648: usage-vote substrate for MILESTONE-scope memories injected into a
 * later milestone's steward session — the cross-milestone learning-migration
 * unit. Deliberately a sibling of (not a reader of) the task-flywheel
 * LineageEdge repository: a steward session has no task, so these edges can't
 * live on LineageEdge (its taskId is non-null). The `used=true/false/null`
 * semantics mirror LineageEdge exactly so the same judge and honesty口径 apply.
 */
export const milestoneMemoryEdgeRepository = {
  /**
   * Birth one edge per injected memory. `skipDuplicates` on the
   * `[sessionId, memoryId]` unique index makes a session-start re-fire
   * (resume / compact replay) idempotent — the same injection never
   * double-counts. No-op on empty input.
   */
  async recordInjection(
    input: RecordInjectionInput,
    tx?: Prisma.TransactionClient
  ): Promise<{ count: number }> {
    if (input.rows.length === 0) return { count: 0 }
    const client = tx ?? prisma
    return client.milestoneMemoryEdge.createMany({
      data: input.rows.map(r => ({
        workspaceId: input.workspaceId,
        consumerMilestoneId: input.consumerMilestoneId,
        sessionId: input.sessionId,
        memoryId: r.memoryId,
        // Conditional spread → column defaults to NULL when the source milestone
        // is unknown (a deleted source milestone SetNulls Memory.milestoneId).
        ...(r.sourceMilestoneId != null
          ? { sourceMilestoneId: r.sourceMilestoneId }
          : {}),
      })),
      skipDuplicates: true,
    })
  },

  /** Distinct steward session ids that consumed memory for this milestone. */
  async listConsumerSessionIds(
    consumerMilestoneId: string,
    tx?: Prisma.TransactionClient
  ): Promise<string[]> {
    const client = tx ?? prisma
    const rows = await client.milestoneMemoryEdge.findMany({
      where: { consumerMilestoneId },
      select: { sessionId: true },
      distinct: ['sessionId'],
    })
    return rows.map(r => r.sessionId)
  },

  /** Every injected-memory edge of a steward session. */
  async findSessionEdges(
    sessionId: string,
    tx?: Prisma.TransactionClient
  ): Promise<SessionEdge[]> {
    const client = tx ?? prisma
    return client.milestoneMemoryEdge.findMany({
      where: { sessionId },
      select: {
        memoryId: true,
        sourceMilestoneId: true,
        used: true,
        usedAt: true,
      },
    })
  },

  /**
   * Of the given sessions, which already carry a usage vote (any usedAt-stamped
   * edge)? The audit skips these — idempotency guard (mirrors LineageEdge's
   * `findVotedSessionIds`).
   */
  async findVotedSessionIds(
    sessionIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<Set<string>> {
    if (sessionIds.length === 0) return new Set()
    const client = tx ?? prisma
    const rows = await client.milestoneMemoryEdge.findMany({
      where: { sessionId: { in: sessionIds }, usedAt: { not: null } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    })
    return new Set(rows.map(r => r.sessionId))
  },

  /**
   * Additively mark specific memories used=true for a session (the judge's
   * positive vote). Only the named memories are stamped; every other edge is
   * left untouched (stays NULL) — the automatic path NEVER asserts used=false
   * from silence. No-op on empty input.
   */
  async applyUsageVote(
    sessionId: string,
    usedMemoryIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<{ used: number }> {
    if (usedMemoryIds.length === 0) return { used: 0 }
    const client = tx ?? prisma
    const res = await client.milestoneMemoryEdge.updateMany({
      where: { sessionId, memoryId: { in: usedMemoryIds } },
      data: { used: true, usedAt: new Date() },
    })
    return { used: res.count }
  },

  /**
   * Additively mark specific memories used=false for a session — ONLY where
   * `used` is currently NULL, so an existing true is never demoted and a later
   * true is never blocked (mirrors LineageEdge.applyUnusedVote). No-op on empty.
   */
  async applyUnusedVote(
    sessionId: string,
    unusedMemoryIds: string[],
    tx?: Prisma.TransactionClient
  ): Promise<{ unused: number }> {
    if (unusedMemoryIds.length === 0) return { unused: 0 }
    const client = tx ?? prisma
    const res = await client.milestoneMemoryEdge.updateMany({
      where: { sessionId, used: null, memoryId: { in: unusedMemoryIds } },
      data: { used: false, usedAt: new Date() },
    })
    return { unused: res.count }
  },

  /**
   * Raw usage counts for a consumer milestone's cross-milestone learning
   * read-out. Computed in-JS over the (bounded) edge set — a milestone's
   * steward sessions inject a token-budgeted handful of memories each.
   */
  async aggregateUsage(
    consumerMilestoneId: string,
    tx?: Prisma.TransactionClient
  ): Promise<MilestoneUsageAggregate> {
    const client = tx ?? prisma
    const rows = await client.milestoneMemoryEdge.findMany({
      where: { consumerMilestoneId },
      select: { used: true, sourceMilestoneId: true },
    })
    const sources = new Set<string>()
    let judgedUsed = 0
    let judgedUnused = 0
    let abstained = 0
    for (const r of rows) {
      if (r.sourceMilestoneId) sources.add(r.sourceMilestoneId)
      if (r.used === true) judgedUsed += 1
      else if (r.used === false) judgedUnused += 1
      else abstained += 1
    }
    return {
      injected: rows.length,
      judgedUsed,
      judgedUnused,
      abstained,
      sourceMilestones: sources.size,
    }
  },
}
