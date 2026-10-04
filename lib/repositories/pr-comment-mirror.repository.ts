import { prisma } from '@/lib/db/prisma'
import {
  PrCommentSource,
  DiffSide,
  OutboundActorKind,
  Prisma,
} from '@prisma/client'
import { randomUUID } from 'crypto'

interface ReserveInput {
  commentId: string
  pullRequestId: string
  externalSource: PrCommentSource
  outboundActor: OutboundActorKind
  outboundActorUserId: string | null
  bodyHash: string
  filePath?: string | null
  lineStart?: number | null
  lineEnd?: number | null
  diffSide?: DiffSide | null
  inReplyToExternalId?: string | null
}

interface ResolveInput {
  externalId: string
  externalNodeId?: string | null
  externalUrl: string
  externalUpdatedAt: Date
}

interface DirectCreateInput extends ReserveInput {
  externalId: string
  externalNodeId?: string | null
  externalUrl: string
  externalUpdatedAt: Date
}

export const prCommentMirrorRepository = {
  /** Reserve a row before the GitHub POST returns, with a placeholder externalId. */
  async reserve(input: ReserveInput) {
    const now = new Date()
    return prisma.prCommentMirror.create({
      data: {
        commentId: input.commentId,
        pullRequestId: input.pullRequestId,
        externalSource: input.externalSource,
        externalId: `pending-${randomUUID()}`,
        externalUrl: '',
        externalUpdatedAt: now,
        lastSyncedAt: now,
        outboundActor: input.outboundActor,
        outboundActorUserId: input.outboundActorUserId,
        bodyHash: input.bodyHash,
        filePath: input.filePath ?? null,
        lineStart: input.lineStart ?? null,
        lineEnd: input.lineEnd ?? null,
        diffSide: input.diffSide ?? null,
        inReplyToExternalId: input.inReplyToExternalId ?? null,
      },
    })
  },

  /** After GitHub responds, fill in the real externalId / url / updatedAt. */
  async resolvePlaceholder(id: string, input: ResolveInput) {
    return prisma.prCommentMirror.update({
      where: { id },
      data: {
        externalId: input.externalId,
        externalNodeId: input.externalNodeId ?? null,
        externalUrl: input.externalUrl,
        externalUpdatedAt: input.externalUpdatedAt,
        lastSyncedAt: new Date(),
      },
    })
  },

  /** Inbound-path direct create: we already have GitHub's real externalId. */
  async create(input: DirectCreateInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.prCommentMirror.create({
      data: {
        commentId: input.commentId,
        pullRequestId: input.pullRequestId,
        externalSource: input.externalSource,
        externalId: input.externalId,
        externalNodeId: input.externalNodeId ?? null,
        externalUrl: input.externalUrl,
        externalUpdatedAt: input.externalUpdatedAt,
        lastSyncedAt: new Date(),
        outboundActor: input.outboundActor,
        outboundActorUserId: input.outboundActorUserId,
        bodyHash: input.bodyHash,
        filePath: input.filePath ?? null,
        lineStart: input.lineStart ?? null,
        lineEnd: input.lineEnd ?? null,
        diffSide: input.diffSide ?? null,
        inReplyToExternalId: input.inReplyToExternalId ?? null,
      },
    })
  },

  async findById(id: string) {
    return prisma.prCommentMirror.findUnique({ where: { id } })
  },

  /**
   * LUM-879 — every comment mirrored on the workspace's PRs, with its body,
   * for the code scrub when repositories leave the workspace. `repos` are
   * stored `PullRequest.repo` spellings; omitted, every PR of the workspace.
   * Soft-deleted comments and tombstoned mirrors are included: their body is
   * still stored.
   */
  async findMirroredCommentBodies(workspaceId: string, repos?: string[]) {
    return prisma.prCommentMirror.findMany({
      where: {
        pullRequest: {
          workspaceId,
          ...(repos ? { repo: { in: repos } } : {}),
        },
      },
      select: {
        commentId: true,
        pullRequestId: true,
        comment: { select: { body: true, updatedAt: true } },
      },
    })
  },

  async findByCommentId(commentId: string) {
    return prisma.prCommentMirror.findUnique({ where: { commentId } })
  },

  async findByExternal(source: PrCommentSource, externalId: string) {
    return prisma.prCommentMirror.findUnique({
      where: {
        externalSource_externalId: { externalSource: source, externalId },
      },
    })
  },

  async findRecentPlaceholder(
    pullRequestId: string,
    bodyHash: string,
    withinSeconds: number
  ) {
    const since = new Date(Date.now() - withinSeconds * 1000)
    return prisma.prCommentMirror.findFirst({
      where: {
        pullRequestId,
        bodyHash,
        externalId: { startsWith: 'pending-' },
        lastSyncedAt: { gte: since },
      },
      orderBy: { lastSyncedAt: 'desc' },
    })
  },

  async patchAfterEdit(id: string, externalUpdatedAt: Date, bodyHash: string) {
    return prisma.prCommentMirror.update({
      where: { id },
      data: {
        externalUpdatedAt,
        bodyHash,
        lastSyncedAt: new Date(),
      },
    })
  },

  async markDeleted(id: string) {
    return prisma.prCommentMirror.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },

  /**
   * Mirrored review comments across a set of PRs, for the task-context
   * "PR Review 待办" section. Returns line-level review comments (REVIEW_LINE)
   * and review summaries (REVIEW); the caller keeps only the `changes_requested`
   * summaries. Tombstoned mirrors and soft-deleted comments are excluded.
   * Ordered file → line → update time so the todo list reads top-to-bottom.
   */
  async listReviewTodosForPrs(pullRequestIds: string[]) {
    if (pullRequestIds.length === 0) return []
    return prisma.prCommentMirror.findMany({
      where: {
        pullRequestId: { in: pullRequestIds },
        deletedAt: null,
        externalSource: { in: ['REVIEW_LINE', 'REVIEW'] },
        comment: { deletedAt: null },
      },
      select: {
        // The mirror row id is the stable handle the task-context fragment
        // manifest references for each review-todo (LUM-274).
        id: true,
        pullRequestId: true,
        externalSource: true,
        externalUrl: true,
        filePath: true,
        lineStart: true,
        lineEnd: true,
        comment: {
          select: { body: true, authorActorId: true, createdAt: true },
        },
      },
      orderBy: [
        { filePath: 'asc' },
        { lineEnd: 'asc' },
        { externalUpdatedAt: 'asc' },
      ],
    })
  },
}
