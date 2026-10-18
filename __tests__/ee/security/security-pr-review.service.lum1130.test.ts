/**
 * @jest-environment node
 *
 * LUM-1130 — the request-changes / approve workflow in the PR write-back:
 * mode off ⇒ only COMMENT reviews; mode on ⇒ actionable inline comments
 * request changes, a complete clean head is approved (after re-reading the
 * head) and Lumo's earlier change requests are dismissed; a moved head, an
 * incomplete review or a blocking finding resolved on GitHub ⇒ no approval.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn().mockResolvedValue({ id: 55 }),
      updateIssueComment: jest.fn(),
      createReview: jest.fn().mockResolvedValue({ id: 77 }),
      updateReviewLineComment: jest.fn(),
      listIssueComments: jest.fn().mockResolvedValue([]),
      listReviewComments: jest.fn(),
      createReviewLineReply: jest.fn().mockResolvedValue({ id: 1 }),
      listReviewCommentsOfReview: jest.fn().mockResolvedValue([]),
      listReviews: jest.fn(),
      submitReview: jest.fn().mockResolvedValue({ id: 900 }),
      dismissReview: jest.fn().mockResolvedValue(undefined),
      getPullRequestHead: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn(),
    resolveThread: jest.fn().mockResolvedValue(undefined),
    unresolveThread: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    isRequestChangesOnElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn(),
    upsert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    findLayerMetaByFingerprints: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
jest.mock('@/ee/security/services/scan-evidence-retention.service', () => ({
  scrubScanIfZeroRetention: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { FindingThreadRow } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const listReview = prCommentClient.listReviewComments as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock
const threadRows = prFindingThreadRepository.findByPullRequest as jest.Mock
const listThreads = reviewThreadClient.listReviewThreads as jest.Mock

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'

function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'VULNERABILITY',
    ruleId: 'ext:semgrep:cmd-injection',
    severity: 'MEDIUM',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'lib/run.ts',
    line: 12,
    title: 'Command injection',
    detail: 'User input reaches exec.',
    fingerprint: 'fp1',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

function thread(over: Partial<FindingThreadRow> = {}): FindingThreadRow {
  return {
    id: 't1',
    pullRequestId: 'pr1',
    fingerprint: 'fp1',
    commentId: '101',
    threadNodeId: 'PRRT_1',
    state: 'RESOLVED_BY_USER',
    ruleId: 'ext:semgrep:cmd-injection',
    provenance: 'EXTERNAL_TOOL',
    kind: 'VULNERABILITY',
    filePath: 'lib/run.ts',
    resolvedByLogin: 'alice',
    addressedInSha: null,
    ...over,
  }
}

function scanRow(
  findings: ReviewFindingRow[],
  requestChanges: boolean | 'unset' = true
) {
  return {
    id: 's1',
    headSha: HEAD,
    status: 'FINDINGS',
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    summaryCommentId: null,
    suggestedAt: new Date('2026-10-01T00:00:00Z'),
    verifierStartedAt: null,
    verifiedAt: null,
    judgeReviewScope: null,
    findings,
    pullRequest: {
      id: 'pr1',
      repo: 'acme/app',
      number: 9,
      workspaceId: 'w1',
      task: { number: 1127, team: { identifier: 'LUM' } },
      workspace: {
        slug: 'acme',
        securityPolicy: null,
        ...(requestChanges === 'unset'
          ? {}
          : { securityRequestChangesEnabled: requestChanges }),
      },
    },
  }
}

const submitReview = prCommentClient.submitReview as jest.Mock
const listReviews = prCommentClient.listReviews as jest.Mock
const dismissReview = prCommentClient.dismissReview as jest.Mock
const liveHead = prCommentClient.getPullRequestHead as jest.Mock

const OLD = '1111111111111111111111111111111111111111'
const lumoBot = { login: 'uselumo[bot]', type: 'Bot' }
const changesRequested = {
  id: 41,
  state: 'CHANGES_REQUESTED',
  commit_id: OLD,
  user: lumoBot,
}
const events = () => submitReview.mock.calls.map(c => c[0].event)

const prevSlug = process.env.GITHUB_APP_SLUG
beforeAll(() => {
  process.env.GITHUB_APP_SLUG = 'uselumo'
})
afterAll(() => {
  if (prevSlug === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = prevSlug
})

beforeEach(() => {
  jest.clearAllMocks()
  listReview.mockResolvedValue([])
  listThreads.mockResolvedValue([])
  threadRows.mockResolvedValue([])
  listReviews.mockResolvedValue([])
  liveHead.mockResolvedValue({ sha: HEAD, state: 'open' })
})

/** A Lumo thread on fp1 that a complete pass no longer reports. */
function addressedThreadSetup() {
  threadRows.mockResolvedValue([
    thread({ state: 'OPEN', resolvedByLogin: null }),
  ])
  listThreads.mockResolvedValue([
    {
      id: 'PRRT_1',
      isResolved: false,
      isOutdated: false,
      resolvedBy: null,
      firstCommentId: 101,
    },
  ])
}

describe('LUM-1130 mode off (the default)', () => {
  it.each([
    ['not set on the workspace row', 'unset' as const],
    ['set off', false as const],
  ])(
    '%s ⇒ the inline review is a COMMENT and no verdict is posted',
    async (_l, mode) => {
      findById.mockResolvedValue(scanRow([finding()], mode))
      await securityPrReviewService.syncReview('s1')
      expect(createReview).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'COMMENT' })
      )
      expect(listReviews).not.toHaveBeenCalled()
      expect(submitReview).not.toHaveBeenCalled()
    }
  )

  it('a clean complete head is never approved with the mode off', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([changesRequested])
    findById.mockResolvedValue(scanRow([], false))
    await securityPrReviewService.syncReview('s1')
    expect(submitReview).not.toHaveBeenCalled()
    expect(dismissReview).not.toHaveBeenCalled()
  })
})

describe('LUM-1130 mode on', () => {
  it('a new actionable finding ⇒ the inline review requests changes (no second verdict review)', async () => {
    findById.mockResolvedValue(scanRow([finding()]))
    listReviews.mockResolvedValue([
      { id: 77, state: 'CHANGES_REQUESTED', commit_id: HEAD, user: lumoBot },
    ])
    await securityPrReviewService.syncReview('s1')
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REQUEST_CHANGES' })
    )
    expect(submitReview).not.toHaveBeenCalled()
  })

  it('an open thread from an earlier review while Lumo approved before ⇒ a body-only REQUEST_CHANGES', async () => {
    threadRows.mockResolvedValue([
      thread({ state: 'OPEN', resolvedByLogin: null }),
    ])
    listReview.mockResolvedValue([
      {
        id: 101,
        body: 'x\n\n<!-- lumo-security:fp:fp1 -->',
        user: lumoBot,
      },
    ])
    listReviews.mockResolvedValue([
      { id: 50, state: 'APPROVED', commit_id: OLD, user: lumoBot },
    ])
    findById.mockResolvedValue(scanRow([finding()]))
    await securityPrReviewService.syncReview('s1')
    expect(createReview).not.toHaveBeenCalled()
    expect(events()).toEqual(['REQUEST_CHANGES'])
    expect(submitReview.mock.calls[0][0]).toMatchObject({ commitId: HEAD })
    expect(submitReview.mock.calls[0][0].body).toMatch(/1 open review thread\b/)
  })

  it('fix pushed: a complete pass addresses the last thread ⇒ approve the head, dismiss the earlier change request', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([changesRequested])
    findById.mockResolvedValue(scanRow([]))
    await securityPrReviewService.syncReview('s1')
    expect(liveHead).toHaveBeenCalled()
    expect(events()).toEqual(['APPROVE'])
    expect(submitReview.mock.calls[0][0]).toMatchObject({ commitId: HEAD })
    expect(dismissReview).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 41 })
    )
    // Approve first, dismiss after.
    expect(submitReview.mock.invocationCallOrder[0]).toBeLessThan(
      dismissReview.mock.invocationCallOrder[0]!
    )
  })

  it('HEAD moved between the check and the submit ⇒ no approval, nothing dismissed', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([changesRequested])
    liveHead.mockResolvedValue({ sha: OLD, state: 'open' })
    findById.mockResolvedValue(scanRow([]))
    await securityPrReviewService.syncReview('s1')
    expect(submitReview).not.toHaveBeenCalled()
    expect(dismissReview).not.toHaveBeenCalled()
  })

  it('a paused layer ⇒ no approval', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([changesRequested])
    findById.mockResolvedValue({
      ...scanRow([]),
      stages: { secrets: 'RAN', external: 'RAN', judge: 'PAUSED' },
    })
    await securityPrReviewService.syncReview('s1')
    expect(submitReview).not.toHaveBeenCalled()
  })

  it('a partial scan ⇒ no approval', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([changesRequested])
    findById.mockResolvedValue({ ...scanRow([]), partial: true })
    await securityPrReviewService.syncReview('s1')
    expect(submitReview).not.toHaveBeenCalled()
  })

  it('LUM-1234: a scan partial only because our reward-hack cap was reached is still approved', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([changesRequested])
    findById.mockResolvedValue({
      ...scanRow([]),
      partial: true,
      partialCauses: ['REWARD_HACK_MONTHLY_CAP'],
      stages: {
        secrets: 'RAN',
        external: 'RAN',
        judge: 'RAN',
        rewardHack: 'PARTIAL',
      },
    })
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
  })

  it('a blocking finding whose thread was resolved on GitHub still prevents approval', async () => {
    const blocking = finding({
      provenance: 'DETERMINISTIC',
      severity: 'HIGH',
      ruleId: 'secret:aws-key',
      kind: 'SECRET',
    })
    threadRows.mockResolvedValue([
      thread({
        provenance: 'DETERMINISTIC',
        ruleId: 'secret:aws-key',
        kind: 'SECRET',
      }),
    ])
    listReviews.mockResolvedValue([
      { id: 50, state: 'APPROVED', commit_id: OLD, user: lumoBot },
    ])
    findById.mockResolvedValue(scanRow([blocking]))
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['REQUEST_CHANGES'])
    expect(submitReview.mock.calls[0][0].body).toMatch(
      /1 finding that blocks DONE/
    )
  })

  it('already approved on this head ⇒ no repeat approval', async () => {
    addressedThreadSetup()
    listReviews.mockResolvedValue([
      changesRequested,
      { id: 60, state: 'APPROVED', commit_id: HEAD, user: lumoBot },
    ])
    findById.mockResolvedValue(scanRow([]))
    await securityPrReviewService.syncReview('s1')
    expect(submitReview).not.toHaveBeenCalled()
  })

  it('a verdict failure never fails the write-back', async () => {
    addressedThreadSetup()
    listReviews.mockRejectedValue(new Error('boom'))
    findById.mockResolvedValue(scanRow([]))
    const out = await securityPrReviewService.syncReview('s1')
    expect(out.posted).toBe(true)
  })
})

describe('LUM-1140 next sync while the mode is off', () => {
  const withState = (state: string) => {
    const row = scanRow([], false)
    return { ...row, pullRequest: { ...row.pullRequest, state } }
  }
  const humanCr = {
    id: 42,
    state: 'CHANGES_REQUESTED',
    commit_id: OLD,
    user: { login: 'alice', type: 'User' },
  }

  it("dismisses a standing Lumo change request the bulk pass missed (never approves, human's kept)", async () => {
    listReviews.mockResolvedValue([changesRequested, humanCr])
    findById.mockResolvedValue(withState('open'))
    await securityPrReviewService.syncReview('s1')
    expect(dismissReview).toHaveBeenCalledTimes(1)
    expect(dismissReview).toHaveBeenCalledWith(
      expect.objectContaining({ reviewId: 41, prNumber: 9, token: 'tok' })
    )
    expect(submitReview).not.toHaveBeenCalled()
  })

  it('a closed PR is skipped', async () => {
    listReviews.mockResolvedValue([changesRequested])
    findById.mockResolvedValue(withState('closed'))
    await securityPrReviewService.syncReview('s1')
    expect(listReviews).not.toHaveBeenCalled()
    expect(dismissReview).not.toHaveBeenCalled()
  })

  it('a PR another workspace holds with the mode on is skipped', async () => {
    const elsewhere = jest.fn().mockResolvedValue(true)
    ;(
      prSecurityScanRepository as unknown as Record<string, unknown>
    ).isRequestChangesOnElsewhere = elsewhere
    try {
      listReviews.mockResolvedValue([changesRequested])
      findById.mockResolvedValue(withState('open'))
      await securityPrReviewService.syncReview('s1')
      expect(elsewhere).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pr1', repo: 'acme/app', number: 9 })
      )
      expect(dismissReview).not.toHaveBeenCalled()
    } finally {
      ;(
        prSecurityScanRepository as unknown as Record<string, unknown>
      ).isRequestChangesOnElsewhere = jest.fn().mockResolvedValue(false)
    }
  })
})
