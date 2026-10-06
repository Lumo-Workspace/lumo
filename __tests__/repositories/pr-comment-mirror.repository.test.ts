// __tests__/repositories/pr-comment-mirror.repository.test.ts
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prisma } from '@/lib/db/prisma'
import { PrCommentSource } from '@prisma/client'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prCommentMirror: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

describe('prCommentMirrorRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reserve creates a row with a pending- placeholder externalId', async () => {
    ;(prisma.prCommentMirror.create as jest.Mock).mockResolvedValue({
      id: 'm1',
      externalId: 'pending-cuid',
    })
    const r = await prCommentMirrorRepository.reserve({
      commentId: 'c1',
      pullRequestId: 'pr1',
      externalSource: PrCommentSource.ISSUE,
      outboundActor: 'BOT_APP',
      outboundActorUserId: null,
      bodyHash: 'hash',
    })
    expect(prisma.prCommentMirror.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commentId: 'c1',
        pullRequestId: 'pr1',
        externalSource: 'ISSUE',
        externalId: expect.stringMatching(/^pending-/),
        externalUrl: '',
        bodyHash: 'hash',
      }),
    })
    expect(r.externalId).toMatch(/^pending-/)
  })

  it('resolvePlaceholder swaps placeholder externalId with real values', async () => {
    await prCommentMirrorRepository.resolvePlaceholder('m1', {
      externalId: '12345',
      externalNodeId: 'IC_x',
      externalUrl: 'https://github.com/...',
      externalUpdatedAt: new Date('2026-05-24T00:00:00Z'),
    })
    expect(prisma.prCommentMirror.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({
        externalId: '12345',
        externalNodeId: 'IC_x',
        lastSyncedAt: expect.any(Date),
      }),
    })
  })

  it('findByExternal looks up by source + externalId', async () => {
    await prCommentMirrorRepository.findByExternal(
      PrCommentSource.ISSUE,
      '12345'
    )
    expect(prisma.prCommentMirror.findUnique).toHaveBeenCalledWith({
      where: {
        externalSource_externalId: {
          externalSource: 'ISSUE',
          externalId: '12345',
        },
      },
    })
  })

  it('findRecentPlaceholder filters by PR, body hash, and 60s window', async () => {
    await prCommentMirrorRepository.findRecentPlaceholder('pr1', 'hash', 60)
    expect(prisma.prCommentMirror.findFirst).toHaveBeenCalledWith({
      where: {
        pullRequestId: 'pr1',
        bodyHash: 'hash',
        externalId: { startsWith: 'pending-' },
        lastSyncedAt: { gte: expect.any(Date) },
      },
      orderBy: { lastSyncedAt: 'desc' },
    })
  })

  it('markDeleted sets deletedAt', async () => {
    await prCommentMirrorRepository.markDeleted('m1')
    expect(prisma.prCommentMirror.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('listReviewTodosForPrs short-circuits to [] for an empty id list', async () => {
    const r = await prCommentMirrorRepository.listReviewTodosForPrs([])
    expect(r).toEqual([])
    expect(prisma.prCommentMirror.findMany).not.toHaveBeenCalled()
  })

  it('listReviewTodosForPrs filters to live REVIEW/REVIEW_LINE rows with comment join', async () => {
    ;(prisma.prCommentMirror.findMany as jest.Mock).mockResolvedValue([])
    await prCommentMirrorRepository.listReviewTodosForPrs(['pr1', 'pr2'])
    expect(prisma.prCommentMirror.findMany).toHaveBeenCalledWith({
      where: {
        pullRequestId: { in: ['pr1', 'pr2'] },
        deletedAt: null,
        externalSource: { in: ['REVIEW_LINE', 'REVIEW'] },
        comment: { deletedAt: null },
      },
      select: {
        id: true,
        pullRequestId: true,
        externalSource: true,
        externalUrl: true,
        filePath: true,
        lineStart: true,
        lineEnd: true,
        authorAssociation: true,
        comment: {
          select: {
            body: true,
            authorActorId: true,
            createdAt: true,
            author: { select: { type: true } },
          },
        },
      },
      orderBy: [
        { filePath: 'asc' },
        { lineEnd: 'asc' },
        { externalUpdatedAt: 'asc' },
      ],
    })
  })
})
