/**
 * @jest-environment node
 *
 * LUM-1003 — repository queries behind the authorAssociation backfill.
 */
const updateMany = jest.fn()
const tx = { prCommentMirror: { updateMany } }
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prCommentMirror: { findMany: jest.fn(), update: jest.fn() },
    pullRequest: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown, _opts: unknown) =>
      fn(tx)
    ),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'

const UNKNOWN = {
  authorAssociation: null,
  deletedAt: null,
  NOT: { externalId: { startsWith: 'pending-' } },
}

beforeEach(() => jest.clearAllMocks())

describe('pr-comment-mirror repository — LUM-1003 backfill', () => {
  it('pages PRs with unknown-association rows by id, after the cursor', async () => {
    await prCommentMirrorRepository.listPrsWithUnknownAuthorAssociation({
      afterPullRequestId: 'pr_5',
      limit: 11,
    })
    expect(prisma.pullRequest.findMany).toHaveBeenCalledWith({
      where: {
        id: { gt: 'pr_5' },
        provider: 'github',
        mirroredComments: { some: UNKNOWN },
      },
      select: { id: true, workspaceId: true, repo: true, number: true },
      orderBy: { id: 'asc' },
      take: 11,
    })
  })

  it('starts from the beginning without a cursor', async () => {
    await prCommentMirrorRepository.listPrsWithUnknownAuthorAssociation({
      afterPullRequestId: null,
      limit: 3,
    })
    expect(
      (prisma.pullRequest.findMany as jest.Mock).mock.calls[0][0].where
    ).toEqual({ provider: 'github', mirroredComments: { some: UNKNOWN } })
  })

  it("lists one PR's unknown rows only", async () => {
    await prCommentMirrorRepository.listUnknownAuthorAssociationRows('pr_1')
    expect(prisma.prCommentMirror.findMany).toHaveBeenCalledWith({
      where: { pullRequestId: 'pr_1', ...UNKNOWN },
      select: { id: true, externalSource: true, externalId: true },
    })
  })

  it('fills only still-NULL rows, in one transaction with an explicit timeout', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
      count: 0,
    })
    const n = await prCommentMirrorRepository.fillAuthorAssociations([
      { id: 'm1', authorAssociation: 'MEMBER' },
      { id: 'm2', authorAssociation: 'NONE' },
    ])
    expect(n).toBe(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', authorAssociation: null },
      data: { authorAssociation: 'MEMBER' },
    })
    expect((prisma.$transaction as jest.Mock).mock.calls[0][1]).toEqual({
      timeout: 10_000,
      maxWait: 5_000,
    })
  })

  it('does not open a transaction for an empty batch', async () => {
    expect(await prCommentMirrorRepository.fillAuthorAssociations([])).toBe(0)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('patchAfterEdit refreshes the association only when one is given', async () => {
    const at = new Date('2026-10-01T00:00:00Z')
    await prCommentMirrorRepository.patchAfterEdit('m1', at, 'h', 'OWNER')
    await prCommentMirrorRepository.patchAfterEdit('m2', at, 'h')
    const calls = (prisma.prCommentMirror.update as jest.Mock).mock.calls
    expect(calls[0][0].data.authorAssociation).toBe('OWNER')
    expect(calls[1][0].data).not.toHaveProperty('authorAssociation')
  })
})
