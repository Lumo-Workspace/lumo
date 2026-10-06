/**
 * @jest-environment node
 *
 * LUM-1003 — PrCommentMirror.authorAssociation backfill. GitHub (the
 * pr-comment-client wrapper), the token mint and the repository are mocked;
 * the service's paging, stop rules and write batching run for real.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(async () => 'tok'),
}))
jest.mock('@/lib/repositories/pr-comment-mirror.repository', () => ({
  prCommentMirrorRepository: {
    listPrsWithUnknownAuthorAssociation: jest.fn(),
    listUnknownAuthorAssociationRows: jest.fn(),
    fillAuthorAssociations: jest.fn(async (u: unknown[]) => u.length),
  },
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    ...actual,
    prCommentClient: { listAuthorAssociationsPage: jest.fn() },
  }
})

import { getRepoToken } from '@/lib/integrations/github/auth'
import {
  GithubApiError,
  prCommentClient,
} from '@/lib/integrations/github/pr-comment-client'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import {
  WRITE_BATCH,
  prCommentAuthorBackfillService,
} from '@/lib/services/pr-comment-author-backfill.service'

const repo = prCommentMirrorRepository as jest.Mocked<
  typeof prCommentMirrorRepository
>
const listPage = prCommentClient.listAuthorAssociationsPage as jest.Mock

const PR1 = { id: 'pr_a', workspaceId: 'ws', repo: 'acme/app', number: 1 }
const PR2 = { id: 'pr_b', workspaceId: 'ws', repo: 'acme/app', number: 2 }

function page(
  items: Array<[number, string | null]>,
  hasNext = false,
  rateLimitRemaining: number | null = 4000
) {
  return {
    items: items.map(([id, authorAssociation]) => ({ id, authorAssociation })),
    hasNext,
    rateLimitRemaining,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.fillAuthorAssociations.mockImplementation(async u => u.length)
})

describe('prCommentAuthorBackfillService.run', () => {
  it('is a no-op when every row already has an association', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([])
    const r = await prCommentAuthorBackfillService.run({ dryRun: false })
    expect(r).toMatchObject({
      prsProcessed: 0,
      filled: 0,
      unreachable: 0,
      stoppedReason: 'done',
      nextCursor: null,
    })
    expect(listPage).not.toHaveBeenCalled()
    expect(repo.fillAuthorAssociations).not.toHaveBeenCalled()
  })

  it('follows pagination until the wanted ids are found, per listing kind', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'REVIEW_LINE', externalId: '11' },
      { id: 'm2', externalSource: 'REVIEW_LINE', externalId: '205' },
      { id: 'm3', externalSource: 'ISSUE', externalId: '7' },
    ] as never)
    listPage.mockImplementation(async ({ kind, page: p }) => {
      if (kind === 'REVIEW_LINE' && p === 1)
        return page(
          [
            [11, 'MEMBER'],
            [12, 'NONE'],
          ],
          true
        )
      if (kind === 'REVIEW_LINE' && p === 2)
        return page([[205, 'contributor']], true)
      if (kind === 'ISSUE') return page([[7, 'OWNER']])
      throw new Error(`unexpected ${kind} page ${p}`)
    })
    const r = await prCommentAuthorBackfillService.run({ dryRun: false })
    // REVIEW_LINE stopped after page 2 (both ids found) despite hasNext.
    expect(
      listPage.mock.calls.filter(c => c[0].kind === 'REVIEW_LINE')
    ).toHaveLength(2)
    expect(repo.fillAuthorAssociations).toHaveBeenCalledWith([
      { id: 'm1', authorAssociation: 'MEMBER' },
      { id: 'm2', authorAssociation: 'CONTRIBUTOR' },
      { id: 'm3', authorAssociation: 'OWNER' },
    ])
    expect(r).toMatchObject({ filled: 3, unreachable: 0, prsProcessed: 1 })
    expect(getRepoToken).toHaveBeenCalledWith('ws', 'acme/app', {
      pull_requests: 'read',
    })
  })

  it('leaves comments deleted on GitHub NULL and counts them', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'REVIEW_LINE', externalId: '11' },
      { id: 'gone', externalSource: 'REVIEW_LINE', externalId: '99' },
    ] as never)
    listPage.mockResolvedValue(page([[11, 'COLLABORATOR']]))
    const r = await prCommentAuthorBackfillService.run({ dryRun: false })
    expect(repo.fillAuthorAssociations).toHaveBeenCalledWith([
      { id: 'm1', authorAssociation: 'COLLABORATOR' },
    ])
    expect(r).toMatchObject({ filled: 1, unreachable: 1, rowsConsidered: 2 })
  })

  it('counts a PR whose listing 404s as unreachable and moves on', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1, PR2])
    repo.listUnknownAuthorAssociationRows.mockImplementation(
      async id =>
        [
          {
            id: `m_${id}`,
            externalSource: 'ISSUE',
            externalId: id === 'pr_a' ? '1' : '2',
          },
        ] as never
    )
    listPage
      .mockRejectedValueOnce(new GithubApiError(404, { message: 'Not Found' }))
      .mockResolvedValueOnce(page([[2, 'MEMBER']]))
    const r = await prCommentAuthorBackfillService.run({ dryRun: false })
    expect(r).toMatchObject({
      prsUnreachable: 1,
      unreachable: 1,
      filled: 1,
      prsProcessed: 2,
      stoppedReason: 'done',
    })
  })

  it('stops at a rate limit, keeps what earlier PRs wrote, and hands back a cursor before the limited PR', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1, PR2])
    repo.listUnknownAuthorAssociationRows.mockImplementation(
      async id =>
        [
          {
            id: `m_${id}`,
            externalSource: 'ISSUE',
            externalId: id === 'pr_a' ? '1' : '2',
          },
        ] as never
    )
    const reset = new Date('2026-10-06T12:00:00Z')
    listPage
      .mockResolvedValueOnce(page([[1, 'OWNER']]))
      .mockRejectedValueOnce(
        new GithubApiError(403, { message: 'secondary rate limit' }, reset)
      )
    const r = await prCommentAuthorBackfillService.run({ dryRun: false })
    expect(r).toMatchObject({
      stoppedReason: 'rate_limit',
      nextCursor: 'pr_a',
      rateLimitResetAt: reset.toISOString(),
      filled: 1,
      prsProcessed: 1,
    })
    expect(repo.fillAuthorAssociations).toHaveBeenCalledTimes(1)
  })

  it('stops early when the remaining quota drops under the floor, without writing the partial PR', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'REVIEW_LINE', externalId: '11' },
      { id: 'm2', externalSource: 'REVIEW_LINE', externalId: '500' },
    ] as never)
    listPage.mockResolvedValue(page([[11, 'MEMBER']], true, 20))
    const r = await prCommentAuthorBackfillService.run({
      dryRun: false,
      cursor: 'pr_0',
      minRateLimitRemaining: 100,
    })
    expect(listPage).toHaveBeenCalledTimes(1)
    expect(repo.fillAuthorAssociations).not.toHaveBeenCalled()
    expect(r).toMatchObject({ stoppedReason: 'rate_limit', nextCursor: 'pr_0' })
  })

  it('writes a PR whose listing completed on a low-quota page, then stops after it', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1, PR2])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'ISSUE', externalId: '1' },
    ] as never)
    listPage.mockResolvedValue(page([[1, 'OWNER']], false, 20))
    const r = await prCommentAuthorBackfillService.run({
      dryRun: false,
      minRateLimitRemaining: 100,
    })
    expect(repo.fillAuthorAssociations).toHaveBeenCalledWith([
      { id: 'm1', authorAssociation: 'OWNER' },
    ])
    expect(listPage).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({
      stoppedReason: 'rate_limit',
      nextCursor: 'pr_a',
      filled: 1,
      prsProcessed: 1,
    })
  })

  it('stops mid-listing at the deadline without writing the partial PR', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'REVIEW_LINE', externalId: '999' },
    ] as never)
    listPage.mockResolvedValue(page([[1, 'MEMBER']], true))
    const t = [
      new Date('2026-10-06T00:00:00Z'),
      new Date('2026-10-06T00:10:00Z'),
    ]
    let i = 0
    const r = await prCommentAuthorBackfillService.run({
      dryRun: false,
      deadline: new Date('2026-10-06T00:05:00Z'),
      now: () => t[Math.min(i++, 1)]!,
    })
    expect(listPage).toHaveBeenCalledTimes(1)
    expect(repo.fillAuthorAssociations).not.toHaveBeenCalled()
    expect(r).toMatchObject({
      stoppedReason: 'deadline',
      nextCursor: null,
      prsProcessed: 0,
    })
  })

  it('dry run reports counts and writes nothing', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'REVIEW', externalId: '3' },
    ] as never)
    listPage.mockResolvedValue(page([[3, 'NONE']]))
    const r = await prCommentAuthorBackfillService.run({ dryRun: true })
    expect(r).toMatchObject({ dryRun: true, filled: 1, unreachable: 0 })
    expect(repo.fillAuthorAssociations).not.toHaveBeenCalled()
  })

  it('resumes from a cursor and stops at maxPrs with the last processed PR as the next cursor', async () => {
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1, PR2])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue([
      { id: 'm1', externalSource: 'ISSUE', externalId: '1' },
    ] as never)
    listPage.mockResolvedValue(page([[1, 'OWNER']]))
    const r = await prCommentAuthorBackfillService.run({
      dryRun: false,
      cursor: 'pr_0',
      maxPrs: 1,
    })
    expect(repo.listPrsWithUnknownAuthorAssociation).toHaveBeenCalledWith({
      afterPullRequestId: 'pr_0',
      limit: 2,
    })
    expect(r).toMatchObject({
      stoppedReason: 'max_prs',
      nextCursor: 'pr_a',
      prsProcessed: 1,
    })
  })

  it('writes in batches of WRITE_BATCH rows', async () => {
    const n = WRITE_BATCH + 3
    repo.listPrsWithUnknownAuthorAssociation.mockResolvedValue([PR1])
    repo.listUnknownAuthorAssociationRows.mockResolvedValue(
      Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        externalSource: 'ISSUE',
        externalId: String(i + 1),
      })) as never
    )
    listPage.mockResolvedValue(
      page(Array.from({ length: n }, (_, i) => [i + 1, 'MEMBER']))
    )
    const r = await prCommentAuthorBackfillService.run({ dryRun: false })
    expect(repo.fillAuthorAssociations).toHaveBeenCalledTimes(2)
    expect(repo.fillAuthorAssociations.mock.calls[0]![0]).toHaveLength(
      WRITE_BATCH
    )
    expect(r.filled).toBe(n)
  })
})
