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
  category: MemoryCategory
  content: Prisma.JsonValue
}

export const prReviewLearningRepository = {
  async create(input: NewReviewLearning): Promise<{ id: string }> {
    return prisma.prReviewLearning.create({
      data: input,
      select: { id: true },
    })
  },

  /** The learning a reply already produced (webhook redelivery), if any. */
  async findBySourceReply(
    workspaceId: string,
    sourceReplyId: string
  ): Promise<{ id: string; memoryId: string } | null> {
    return prisma.prReviewLearning.findUnique({
      where: { workspaceId_sourceReplyId: { workspaceId, sourceReplyId } },
      select: { id: true, memoryId: true },
    })
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
        memory: { select: { category: true, content: true } },
      },
    })
    return rows.map(r => ({
      pathGlob: r.pathGlob,
      category: r.memory.category,
      content: r.memory.content,
    }))
  },
}
