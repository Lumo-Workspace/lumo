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

/**
 * LUM-1256 — a learning's keys only (no memory text), for the local scan's
 * server context: which fingerprint / rule / path it covers.
 */
export interface ReviewLearningKeys {
  memoryId: string
  repo: string
  pathGlob: string | null
  ruleId: string
  fingerprint: string
  sourcePullRequestId: string | null
  repoWideAt: Date | null
}

/** LUM-1157 — one row of the workspace's learnings listing. */
export interface ListedReviewLearning {
  memoryId: string
  repo: string
  pathGlob: string | null
  ruleId: string
  authorLogin: string
  repoWideAt: Date | null
  createdAt: Date
  /** null = scoped to the workspace + repository only (no Lumo project). */
  projectId: string | null
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
    /** LUM-1157: null = a learning scoped to the workspace + repo only. */
    projectId: string | null
    content: Prisma.JsonValue
  } | null> {
    const row = await prisma.prReviewLearning.findUnique({
      where: { workspaceId_sourceReplyId: { workspaceId, sourceReplyId } },
      select: {
        id: true,
        memoryId: true,
        pathGlob: true,
        memory: { select: { content: true, projectId: true } },
      },
    })
    return row
      ? {
          id: row.id,
          memoryId: row.memoryId,
          pathGlob: row.pathGlob,
          projectId: row.memory.projectId,
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
   * LUM-1134 — the learnings of this workspace's OTHER repositories whose
   * memory is still ACTIVE, newest first (the `global` learnings scope).
   * Pinned to the workspace on both rows: never another tenant's learnings.
   */
  async findActiveForOtherRepos(
    workspaceId: string,
    repo: string,
    limit: number
  ): Promise<ActiveReviewLearning[]> {
    const rows = await prisma.prReviewLearning.findMany({
      where: {
        workspaceId,
        NOT: { repo: { equals: repo, mode: 'insensitive' } },
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
   * LUM-1157 — the workspace's learnings whose memory is still ACTIVE,
   * newest first, optionally one repository's (case-insensitive): with or
   * without a Lumo project, so a learning of a repository linked to no
   * project can be found (and deleted by its memory id). Pinned to the
   * workspace on both rows.
   */
  async listActiveForWorkspace(
    workspaceId: string,
    repo: string | null,
    limit: number
  ): Promise<ListedReviewLearning[]> {
    const rows = await prisma.prReviewLearning.findMany({
      where: {
        workspaceId,
        ...(repo ? { repo: { equals: repo, mode: 'insensitive' } } : {}),
        memory: { workspaceId, status: 'ACTIVE' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        memoryId: true,
        repo: true,
        pathGlob: true,
        ruleId: true,
        authorLogin: true,
        repoWideAt: true,
        createdAt: true,
        memory: { select: { projectId: true, content: true } },
      },
    })
    return rows.map(r => ({
      memoryId: r.memoryId,
      repo: r.repo,
      pathGlob: r.pathGlob,
      ruleId: r.ruleId,
      authorLogin: r.authorLogin,
      repoWideAt: r.repoWideAt,
      createdAt: r.createdAt,
      projectId: r.memory.projectId,
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

  /**
   * LUM-1256 — the keys of the learnings whose memory is still ACTIVE,
   * newest first: this repository's (`own`) or the workspace's other
   * repositories' (`others`, the `global` scope). Never the memory text.
   * Pinned to the workspace on both rows; names compare case-insensitively.
   */
  async findActiveKeys(
    workspaceId: string,
    repo: string,
    which: 'own' | 'others',
    limit: number
  ): Promise<ReviewLearningKeys[]> {
    const repoMatch = { equals: repo, mode: 'insensitive' as const }
    return prisma.prReviewLearning.findMany({
      where: {
        workspaceId,
        ...(which === 'own'
          ? { repo: repoMatch }
          : { NOT: { repo: repoMatch } }),
        memory: { workspaceId, status: 'ACTIVE' },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        memoryId: true,
        repo: true,
        pathGlob: true,
        ruleId: true,
        fingerprint: true,
        sourcePullRequestId: true,
        repoWideAt: true,
      },
    })
  },
}
