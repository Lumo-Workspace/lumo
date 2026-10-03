import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-917 — reads of the workspace's AI-derived-content switch, and the
 * batched removal of what it governs:
 *   - `memories` rows (the `embedding` vector lives on the row, so it goes
 *     with it; `milestone_memory_edges` cascade) plus the FK-less
 *     `memory_stale_anchor_reports` / `memory_provenance` rows naming them;
 *   - the session summary columns and the run summary columns on `sessions`
 *     (cleared to null — the session row and its record stay);
 *   - a task's claim snapshot whose source is AI-generated (`RUN_SUMMARY` /
 *     `DIGEST`; an `AGENT` self-report stays): text, source and session
 *     pointer go to null while `claimSnapshotAt` stays set — the schema's
 *     "synthesized, no material" state, so reads show no claim instead of
 *     falling back to a live re-derivation;
 *   - a claim-faithfulness verdict's `evidence` / `reasoning` (the verdict row
 *     and its label stay).
 * No business rules here: the service decides who may call and how much.
 */

export type AiDerivedSwitchRef =
  | { workspaceId: string }
  | { projectId: string }
  | { taskId: string }
  | { milestoneId: string }

export interface AiDerivedContentCounts {
  memories: number
  sessionSummaries: number
  runSummaries: number
  claimSnapshots: number
  verdictTexts: number
}

/** Claim snapshot sources a model wrote (TaskClaim['source'] minus AGENT). */
export const AI_CLAIM_SNAPSHOT_SOURCES = ['RUN_SUMMARY', 'DIGEST'] as const

function aiClaimSnapshotWhere(workspaceId: string): Prisma.TaskWhereInput {
  return {
    project: { workspaceId },
    claimSnapshotSource: { in: [...AI_CLAIM_SNAPSHOT_SOURCES] },
  }
}

function verdictTextWhere(
  workspaceId: string
): Prisma.ClaimFaithfulnessVerdictWhereInput {
  return {
    task: { project: { workspaceId } },
    OR: [{ evidence: { not: Prisma.AnyNull } }, { reasoning: { not: null } }],
  }
}

const SESSION_SUMMARY_PRESENT: Prisma.SessionWhereInput = {
  OR: [
    { summary: { not: Prisma.AnyNull } },
    { summaryType: { not: null } },
    { summaryGeneratedAt: { not: null } },
  ],
}

const RUN_SUMMARY_PRESENT: Prisma.SessionWhereInput = {
  OR: [{ runSummary: { not: null } }, { runSummaryGeneratedAt: { not: null } }],
}

export const aiDerivedContentRepository = {
  /** The switch for the workspace `ref` belongs to; null when not found. */
  async findEnabled(ref: AiDerivedSwitchRef): Promise<boolean | null> {
    const select = { aiDerivedContentEnabled: true } as const
    if ('workspaceId' in ref) {
      const ws = await prisma.workspace.findUnique({
        where: { id: ref.workspaceId },
        select,
      })
      return ws?.aiDerivedContentEnabled ?? null
    }
    if ('projectId' in ref) {
      const project = await prisma.project.findUnique({
        where: { id: ref.projectId },
        select: { workspace: { select } },
      })
      return project?.workspace.aiDerivedContentEnabled ?? null
    }
    if ('taskId' in ref) {
      const task = await prisma.task.findUnique({
        where: { id: ref.taskId },
        select: { project: { select: { workspace: { select } } } },
      })
      return task?.project.workspace.aiDerivedContentEnabled ?? null
    }
    const milestone = await prisma.milestone.findUnique({
      where: { id: ref.milestoneId },
      select: { project: { select: { workspace: { select } } } },
    })
    return milestone?.project.workspace.aiDerivedContentEnabled ?? null
  },

  async countForWorkspace(
    workspaceId: string
  ): Promise<AiDerivedContentCounts> {
    const [
      memories,
      sessionSummaries,
      runSummaries,
      claimSnapshots,
      verdictTexts,
    ] = await Promise.all([
      prisma.memory.count({ where: { workspaceId } }),
      prisma.session.count({
        where: { workspaceId, ...SESSION_SUMMARY_PRESENT },
      }),
      prisma.session.count({ where: { workspaceId, ...RUN_SUMMARY_PRESENT } }),
      prisma.task.count({ where: aiClaimSnapshotWhere(workspaceId) }),
      prisma.claimFaithfulnessVerdict.count({
        where: verdictTextWhere(workspaceId),
      }),
    ])
    return {
      memories,
      sessionSummaries,
      runSummaries,
      claimSnapshots,
      verdictTexts,
    }
  },

  /**
   * Delete up to `limit` of the workspace's memories (and the FK-less rows
   * naming them) in one transaction. Returns how many memories went.
   */
  async deleteMemoryBatch(workspaceId: string, limit: number): Promise<number> {
    const rows = await prisma.memory.findMany({
      where: { workspaceId },
      select: { id: true },
      take: limit,
    })
    if (rows.length === 0) return 0
    const ids = rows.map(r => r.id)
    const [, , deleted] = await prisma.$transaction([
      prisma.memoryStaleAnchorReport.deleteMany({
        where: { memoryId: { in: ids } },
      }),
      prisma.memoryProvenance.deleteMany({
        where: {
          OR: [{ childMemoryId: { in: ids } }, { parentMemoryId: { in: ids } }],
        },
      }),
      prisma.memory.deleteMany({ where: { workspaceId, id: { in: ids } } }),
    ])
    return deleted.count
  },

  /** Null the summary columns of up to `limit` sessions that have one. */
  async clearSessionSummaryBatch(
    workspaceId: string,
    limit: number
  ): Promise<number> {
    const rows = await prisma.session.findMany({
      where: { workspaceId, ...SESSION_SUMMARY_PRESENT },
      select: { id: true },
      take: limit,
    })
    if (rows.length === 0) return 0
    const { count } = await prisma.session.updateMany({
      where: { workspaceId, id: { in: rows.map(r => r.id) } },
      data: {
        summary: Prisma.DbNull,
        summaryType: null,
        summaryGeneratedAt: null,
        summaryClassifyModel: null,
        summaryContentModel: null,
        summaryEventCount: null,
      },
    })
    return count
  },

  /** Null the run summary columns of up to `limit` sessions that have one. */
  async clearRunSummaryBatch(
    workspaceId: string,
    limit: number
  ): Promise<number> {
    const rows = await prisma.session.findMany({
      where: { workspaceId, ...RUN_SUMMARY_PRESENT },
      select: { id: true },
      take: limit,
    })
    if (rows.length === 0) return 0
    const { count } = await prisma.session.updateMany({
      where: { workspaceId, id: { in: rows.map(r => r.id) } },
      data: { runSummary: null, runSummaryGeneratedAt: null },
    })
    return count
  },

  /**
   * Clear up to `limit` AI-generated claim snapshots. Each row keeps its own
   * `updatedAt` (set explicitly) — the used-up sweep (LUM-910) dates a Done
   * task by it, and clearing a summary must not push that back.
   */
  async clearClaimSnapshotBatch(
    workspaceId: string,
    limit: number
  ): Promise<number> {
    const rows = await prisma.task.findMany({
      where: aiClaimSnapshotWhere(workspaceId),
      select: { id: true, updatedAt: true },
      take: limit,
    })
    if (rows.length === 0) return 0
    const updated = await prisma.$transaction(
      rows.map(row =>
        prisma.task.updateMany({
          where: { id: row.id, ...aiClaimSnapshotWhere(workspaceId) },
          data: {
            claimSnapshot: null,
            claimSnapshotSource: null,
            claimSnapshotSessionId: null,
            updatedAt: row.updatedAt,
          },
        })
      )
    )
    return updated.reduce((n, r) => n + r.count, 0)
  },

  /** Null `evidence` / `reasoning` of up to `limit` faithfulness verdicts. */
  async clearVerdictTextBatch(
    workspaceId: string,
    limit: number
  ): Promise<number> {
    const rows = await prisma.claimFaithfulnessVerdict.findMany({
      where: verdictTextWhere(workspaceId),
      select: { id: true },
      take: limit,
    })
    if (rows.length === 0) return 0
    const { count } = await prisma.claimFaithfulnessVerdict.updateMany({
      where: { id: { in: rows.map(r => r.id) } },
      data: { evidence: Prisma.DbNull, reasoning: null },
    })
    return count
  },
}
