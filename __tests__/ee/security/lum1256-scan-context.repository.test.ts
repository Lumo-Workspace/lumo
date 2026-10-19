/**
 * @jest-environment node
 *
 * LUM-1256: the server-context queries pin the workspace on every read,
 * match the repository by its stored spellings, select no code / evidence /
 * note / memory text, and find only an OPEN PR of the branch.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prSecurityFinding: { findMany: jest.fn() },
    pullRequest: { findFirst: jest.fn() },
    prReviewLearning: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/repositories/repo-spellings', () => ({
  storedRepoSpellings: jest.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { storedRepoSpellings } from '@/lib/repositories/repo-spellings'
import { securityScanContextRepository } from '@/ee/security/repositories/security-scan-context.repository'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'

const m = <T>(fn: T) => fn as unknown as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  m(storedRepoSpellings).mockResolvedValue(['Acme/App'])
})

describe('findRulingRows', () => {
  it('reads ruled rows of the workspace repository, newest first, keys only', async () => {
    m(prisma.prSecurityFinding.findMany).mockResolvedValue([
      {
        fingerprint: 'fp',
        ruleId: 'r',
        disposition: 'FALSE_POSITIVE',
        dispositionedById: 'm1',
        dispositionedAt: new Date('2026-10-01T00:00:00Z'),
        scan: { pullRequest: { number: 5 } },
      },
    ])
    const rows = await securityScanContextRepository.findRulingRows(
      'ws_1',
      'acme/app',
      2000
    )
    expect(storedRepoSpellings).toHaveBeenCalledWith('ws_1', ['acme/app'])
    const arg = m(prisma.prSecurityFinding.findMany).mock.calls[0][0]
    expect(arg.where).toEqual({
      dispositionedAt: { not: null },
      scan: {
        pullRequest: { workspaceId: 'ws_1', repo: { in: ['Acme/App'] } },
      },
    })
    expect(arg.orderBy).toEqual({ dispositionedAt: 'desc' })
    expect(arg.take).toBe(2000)
    for (const key of ['evidence', 'detail', 'dispositionNote', 'title'])
      expect(arg.select).not.toHaveProperty(key)
    expect(rows).toEqual([
      {
        fingerprint: 'fp',
        ruleId: 'r',
        disposition: 'FALSE_POSITIVE',
        dispositionedById: 'm1',
        dispositionedAt: new Date('2026-10-01T00:00:00Z'),
        pullRequestNumber: 5,
      },
    ])
  })

  it('reads nothing when the workspace has no PR of that repository', async () => {
    m(storedRepoSpellings).mockResolvedValue([])
    await expect(
      securityScanContextRepository.findRulingRows('ws_1', 'x/y', 10)
    ).resolves.toEqual([])
    expect(prisma.prSecurityFinding.findMany).not.toHaveBeenCalled()
  })
})

describe('findOpenPullRequestByBranch', () => {
  it('finds the newest open PR of the branch in the workspace', async () => {
    m(prisma.pullRequest.findFirst).mockResolvedValue({
      id: 'pr1',
      number: 3,
      headSha: 'abc',
    })
    await expect(
      securityScanContextRepository.findOpenPullRequestByBranch(
        'ws_1',
        'acme/app',
        'feature'
      )
    ).resolves.toEqual({ id: 'pr1', number: 3, headSha: 'abc' })
    expect(m(prisma.pullRequest.findFirst).mock.calls[0][0].where).toEqual({
      workspaceId: 'ws_1',
      repo: { in: ['Acme/App'] },
      headBranch: 'feature',
      state: 'open',
    })
  })
})

describe('prReviewLearningRepository.findActiveKeys', () => {
  it('reads ACTIVE learnings of this repository or the others, without memory text', async () => {
    m(prisma.prReviewLearning.findMany).mockResolvedValue([])
    await prReviewLearningRepository.findActiveKeys(
      'ws_1',
      'acme/app',
      'own',
      50
    )
    await prReviewLearningRepository.findActiveKeys(
      'ws_1',
      'acme/app',
      'others',
      50
    )
    const [own, others] = m(prisma.prReviewLearning.findMany).mock.calls.map(
      c => c[0]
    )
    const repo = { equals: 'acme/app', mode: 'insensitive' }
    expect(own.where).toEqual({
      workspaceId: 'ws_1',
      repo,
      memory: { workspaceId: 'ws_1', status: 'ACTIVE' },
    })
    expect(others.where).toEqual({
      workspaceId: 'ws_1',
      NOT: { repo },
      memory: { workspaceId: 'ws_1', status: 'ACTIVE' },
    })
    expect(own.take).toBe(50)
    expect(own.select).not.toHaveProperty('memory')
    expect(Object.keys(own.select).sort()).toEqual([
      'fingerprint',
      'memoryId',
      'pathGlob',
      'repo',
      'repoWideAt',
      'ruleId',
      'sourcePullRequestId',
    ])
  })
})
