/**
 * @jest-environment node
 *
 * LUM-1256: the server-context service — the newest ruling per fingerprint
 * wins (a reopen withdraws it), an in-flight baseline has no set, and the
 * learnings follow the workspace's learnings scope (LUM-1134) and a
 * PR-only learning applies only to that PR (LUM-1131).
 */
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityBaseline: jest.fn(),
    findLearningsScope: jest.fn(),
    findSecurityPolicy: jest.fn(),
  },
}))
jest.mock(
  '@/ee/security/repositories/security-scan-context.repository',
  () => ({
    securityScanContextRepository: {
      findRulingRows: jest.fn(),
      findOpenPullRequestByBranch: jest.fn(),
    },
  })
)
jest.mock('@/ee/security/repositories/pr-review-learning.repository', () => ({
  prReviewLearningRepository: { findActiveKeys: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { labelsByIds: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findStatesByIds: jest.fn() },
}))

import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { securityScanContextRepository } from '@/ee/security/repositories/security-scan-context.repository'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  latestRulings,
  securityScanContextService,
} from '@/ee/security/services/security-scan-context.service'

const m = <T>(fn: T) => fn as unknown as jest.Mock

const learning = (over: Record<string, unknown>) => ({
  memoryId: 'mem',
  repo: 'acme/app',
  pathGlob: null,
  ruleId: 'secret:generic',
  fingerprint: 'fp',
  sourcePullRequestId: null,
  repoWideAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  m(securityColumnsRepository.findSecurityBaseline).mockResolvedValue(null)
  m(securityColumnsRepository.findLearningsScope).mockResolvedValue('local')
  m(securityColumnsRepository.findSecurityPolicy).mockResolvedValue({
    block: [{ provenance: 'DETERMINISTIC', severity: 'MEDIUM' }],
  })
  m(securityScanContextRepository.findRulingRows).mockResolvedValue([])
  m(
    securityScanContextRepository.findOpenPullRequestByBranch
  ).mockResolvedValue(null)
  m(prReviewLearningRepository.findActiveKeys).mockResolvedValue([])
  m(memberRepository.labelsByIds).mockResolvedValue(new Map())
  m(pullRequestRepository.findStatesByIds).mockResolvedValue(new Map())
})

describe('latestRulings', () => {
  const at = (iso: string) => new Date(iso)
  it('keeps the newest row per fingerprint and drops a withdrawn ruling', () => {
    const rows = [
      // Newest first, as the repository reads them.
      {
        fingerprint: 'a',
        ruleId: 'r',
        disposition: null,
        dispositionedById: 'm1',
        dispositionedAt: at('2026-10-03T00:00:00Z'),
        pullRequestNumber: 2,
      },
      {
        fingerprint: 'b',
        ruleId: 'r',
        disposition: 'ACCEPTED_RISK' as const,
        dispositionedById: 'm2',
        dispositionedAt: at('2026-10-02T00:00:00Z'),
        pullRequestNumber: 2,
      },
      {
        fingerprint: 'a',
        ruleId: 'r',
        disposition: 'FALSE_POSITIVE' as const,
        dispositionedById: 'm1',
        dispositionedAt: at('2026-10-01T00:00:00Z'),
        pullRequestNumber: 1,
      },
      {
        fingerprint: 'b',
        ruleId: 'r',
        disposition: 'FALSE_POSITIVE' as const,
        dispositionedById: 'm3',
        dispositionedAt: at('2026-09-01T00:00:00Z'),
        pullRequestNumber: 1,
      },
    ]
    expect(latestRulings(rows)).toEqual([rows[1]])
  })
})

describe('securityScanContextService.getForRepo', () => {
  it('has no baseline while the first one is still in flight', async () => {
    m(securityColumnsRepository.findSecurityBaseline).mockResolvedValue({
      sha: 's',
      at: null,
      requestedAt: '2026-10-18T00:00:00Z',
      fingerprints: [],
      partial: false,
      tools: [],
    })
    const view = await securityScanContextService.getForRepo('ws', {
      repo: 'acme/app',
    })
    expect(view.baseline).toBeNull()
    expect(view.policy).toEqual({
      block: [{ provenance: 'DETERMINISTIC', severity: 'MEDIUM' }],
    })
    expect(view.pullRequest).toBeNull()
    // No branch: the open-PR lookup is skipped.
    expect(
      securityScanContextRepository.findOpenPullRequestByBranch
    ).not.toHaveBeenCalled()
  })

  it('throws 404 for a repository not linked to the workspace', async () => {
    m(securityColumnsRepository.findSecurityBaseline).mockResolvedValue(
      undefined
    )
    await expect(
      securityScanContextService.getForRepo('ws', { repo: 'x/y' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('names who ruled; a system ruling has no name', async () => {
    m(securityScanContextRepository.findRulingRows).mockResolvedValue([
      {
        fingerprint: 'a',
        ruleId: 'r',
        disposition: 'FALSE_POSITIVE',
        dispositionedById: 'm1',
        dispositionedAt: new Date('2026-10-01T00:00:00Z'),
        pullRequestNumber: 3,
      },
      {
        fingerprint: 'b',
        ruleId: 'r',
        disposition: 'ACCEPTED_RISK',
        dispositionedById: null,
        dispositionedAt: new Date('2026-09-01T00:00:00Z'),
        pullRequestNumber: 4,
      },
    ])
    m(memberRepository.labelsByIds).mockResolvedValue(new Map([['m1', 'Ann']]))
    const view = await securityScanContextService.getForRepo('ws', {
      repo: 'acme/app',
    })
    expect(memberRepository.labelsByIds).toHaveBeenCalledWith(['m1'])
    expect(view.rulings.map(r => [r.fingerprint, r.by])).toEqual([
      ['a', 'Ann'],
      ['b', null],
    ])
  })

  it('local scope reads this repository only', async () => {
    m(prReviewLearningRepository.findActiveKeys).mockResolvedValue([
      learning({ memoryId: 'own' }),
    ])
    const view = await securityScanContextService.getForRepo('ws', {
      repo: 'acme/app',
    })
    expect(prReviewLearningRepository.findActiveKeys).toHaveBeenCalledTimes(1)
    expect(prReviewLearningRepository.findActiveKeys).toHaveBeenCalledWith(
      'ws',
      'acme/app',
      'own',
      200
    )
    expect(view.learnings.map(l => l.id)).toEqual(['own'])
  })

  it.each([
    ['global', 'public', true],
    ['auto', 'private', true],
    ['auto', 'public', false],
    ['auto', 'unknown', false],
  ] as const)(
    '%s scope on a %s repository reads other repositories: %s',
    async (scope, visibility, readsOthers) => {
      m(securityColumnsRepository.findLearningsScope).mockResolvedValue(scope)
      m(prReviewLearningRepository.findActiveKeys).mockImplementation(
        async (_ws: string, _repo: string, which: string) => [
          learning({
            memoryId: which,
            repo: which === 'own' ? 'acme/app' : 'acme/lib',
          }),
        ]
      )
      const repoVisibility = jest.fn().mockResolvedValue(visibility)
      const view = await securityScanContextService.getForRepo(
        'ws',
        { repo: 'acme/app' },
        { repoVisibility }
      )
      expect(view.learnings.map(l => l.id)).toEqual(
        readsOthers ? ['own', 'others'] : ['own']
      )
      expect(repoVisibility).toHaveBeenCalledTimes(scope === 'auto' ? 1 : 0)
    }
  )

  it('a PR-only learning applies only on its own open PR (or once it merged)', async () => {
    m(prReviewLearningRepository.findActiveKeys).mockResolvedValue([
      learning({
        memoryId: 'mine',
        sourcePullRequestId: 'pr_7',
        repoWideAt: null,
      }),
      learning({
        memoryId: 'theirs',
        sourcePullRequestId: 'pr_8',
        repoWideAt: null,
      }),
      learning({
        memoryId: 'merged',
        sourcePullRequestId: 'pr_9',
        repoWideAt: null,
      }),
    ])
    m(pullRequestRepository.findStatesByIds).mockResolvedValue(
      new Map([
        ['pr_7', 'open'],
        ['pr_8', 'open'],
        ['pr_9', 'merged'],
      ])
    )
    m(
      securityScanContextRepository.findOpenPullRequestByBranch
    ).mockResolvedValue({ id: 'pr_7', number: 7, headSha: null })
    const onBranch = await securityScanContextService.getForRepo('ws', {
      repo: 'acme/app',
      branch: 'feature',
    })
    expect(onBranch.learnings.map(l => l.id)).toEqual(['mine', 'merged'])

    m(
      securityScanContextRepository.findOpenPullRequestByBranch
    ).mockResolvedValue(null)
    const noPr = await securityScanContextService.getForRepo('ws', {
      repo: 'acme/app',
      branch: 'other',
    })
    expect(noPr.learnings.map(l => l.id)).toEqual(['merged'])
  })
})
