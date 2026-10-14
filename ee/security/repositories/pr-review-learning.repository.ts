/**
 * LUM-1131 — `PrReviewLearning`: which repository (and optional path glob) a
 * PR-review learning applies to. The learning's text is its Memory row;
 * a learning counts only while that memory is ACTIVE, and deleting the
 * memory deletes this row (FK cascade). Every read pins the workspace.
 * Queries only.
 */
import { prisma } from '@/lib/db/prisma'
import type { MemoryCategory, Prisma } from '@prisma/client'

export interface NewReviewLearning {
  workspaceId: string
  memoryId: string
  repo: string
  pathGlob: string | null
  ruleId: string
  fingerprint: string
  sourcePullRequestId: string | null
  sourceReplyId: string
  authorLogin: string
}

export interface ActiveReviewLearning {
  pathGlob: string | null
  sourcePullRequestId: string | null
  /** Set once the source PR's merge was seen; null = not (yet) known. */
  repoWideAt: Date | null
  category: MemoryCategory
  content: Prisma.JsonValue
}

export const prReviewLearningRepository = {
  /** `tx`: the memory's transaction, so the two rows land together. */
  async create(
    input: NewReviewLearning,
    tx?: Prisma.TransactionClient
  ): Promise<{ id: string }> {
    return (tx ?? prisma).prReviewLearning.create({
      data: input,
      select: { id: true },
    })
  },

  /** The learning a reply already produced (webhook redelivery), if any. */
  async findBySourceReply(
    workspaceId: string,
    sourceReplyId: string
  ): Promise<{
    id: string
    memoryId: string
    pathGlob: string | null
    content: Prisma.JsonValue
  } | null> {
    const row = await prisma.prReviewLearning.findUnique({
      where: { workspaceId_sourceReplyId: { workspaceId, sourceReplyId } },
      select: {
        id: true,
        memoryId: true,
        pathGlob: true,
        memory: { select: { content: true } },
      },
    })
    return row
      ? {
          id: row.id,
          memoryId: row.memoryId,
          pathGlob: row.pathGlob,
          content: row.memory.content,
        }
      : null
  },

  /**
   * The repository's learnings whose memory is still ACTIVE, newest first.
   * Repository names compare case-insensitively (GitHub's do).
   */
  async findActiveForRepo(
    workspaceId: string,
    repo: string,
    limit: number
  ): Promise<ActiveReviewLearning[]> {
    const rows = await prisma.prReviewLearning.findMany({
      where: {
        workspaceId,
        repo: { equals: repo, mode: 'insensitive' },
        memory: { workspaceId, status: 'ACTIVE' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        pathGlob: true,
        sourcePullRequestId: true,
        repoWideAt: true,
        memory: { select: { category: true, content: true } },
      },
    })
    return rows.map(r => ({
      pathGlob: r.pathGlob,
      sourcePullRequestId: r.sourcePullRequestId,
      repoWideAt: r.repoWideAt,
      category: r.memory.category,
      content: r.memory.content,
    }))
  },

  /**
   * The source PR merged: its learnings now apply to the whole repository.
   * Idempotent — an already-promoted row keeps its first timestamp.
   */
  async markRepoWideForPullRequest(
    workspaceId: string,
    pullRequestId: string,
    at: Date
  ): Promise<number> {
    const res = await prisma.prReviewLearning.updateMany({
      where: {
        workspaceId,
        sourcePullRequestId: pullRequestId,
        repoWideAt: null,
      },
      data: { repoWideAt: at },
    })
    return res.count
  },
}
