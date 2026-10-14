/**
 * @jest-environment node
 *
 * LUM-1127 — the PR write-back with finding threads: a thread a human
 * resolved is never re-posted; it closes a non-blocking finding but a
 * gate-blocking one stays open (and blocking); a complete pass that no longer
 * reports a fingerprint resolves its thread; new comments get a thread row;
 * the summary counts the threads.
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

import {
  securityPrReviewService,
  buildSummary,
  threadsLine,
} from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { FindingThreadRow } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const listReview = prCommentClient.listReviewComments as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
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

function scanRow(findings: ReviewFindingRow[]) {
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
      workspace: { slug: 'acme', securityPolicy: null },
    },
  }
}

const summaryBody = () => String(createIssue.mock.calls[0]?.[0]?.body ?? '')

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  listReview.mockResolvedValue([])
  listThreads.mockResolvedValue([])
  threadRows.mockResolvedValue([])
})

describe('LUM-1127 write-back with finding threads', () => {
  it('RESOLVED_BY_USER ⇒ not re-posted on a later scan, even with its comment out of the listing window', async () => {
    threadRows.mockResolvedValue([thread()])
    findById.mockResolvedValue(scanRow([finding()]))
    await securityPrReviewService.syncReview('s1')
    expect(createReview).not.toHaveBeenCalled()
  })

  it('a resolved conversation closes a non-blocking finding in the summary count', async () => {
    threadRows.mockResolvedValue([thread()])
    findById.mockResolvedValue(scanRow([finding()]))
    await securityPrReviewService.syncReview('s1')
    expect(summaryBody()).toMatch(/No open findings/)
    expect(summaryBody()).toMatch(
      /\*\*Review threads:\*\* 0 open · 0 addressed · 1 resolved on GitHub/
    )
  })

  it('a gate-blocking finding resolved on GitHub stays open and blocking', async () => {
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
    findById.mockResolvedValue(scanRow([blocking]))
    await securityPrReviewService.syncReview('s1')
    expect(summaryBody()).toMatch(/\*\*1 open finding\*\* \(1 blocking DONE\)/)
    // …but still not re-posted on the diff.
    expect(createReview).not.toHaveBeenCalled()
  })

  it('a complete pass that no longer reports the fingerprint resolves its thread as addressed', async () => {
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
    findById.mockResolvedValue(scanRow([]))
    await securityPrReviewService.syncReview('s1')
    expect(reviewThreadClient.resolveThread).toHaveBeenCalledWith({
      threadId: 'PRRT_1',
      token: 'tok',
    })
    expect(summaryBody()).toMatch(/0 open · 1 addressed · 0 resolved on GitHub/)
  })

  /**
   * LUM-1127 prod regression (PR 1451): GitHub refuses resolveReviewThread to
   * a `pull_requests: write`-only installation token ("Resource not
   * accessible by integration"), so the eval thread stayed open. The token
   * the thread mutations run with must carry `contents: write` too. The mock
   * mint hands back its permission set as the token, so the call shows which
   * set it was minted with.
   */
  it('regression: resolves the addressed thread with a token minted with contents: write', async () => {
    ;(getRepoToken as jest.Mock).mockImplementation(
      async (_w: string, _r: string, perms: object) => JSON.stringify(perms)
    )
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
    findById.mockResolvedValue(scanRow([]))
    await securityPrReviewService.syncReview('s1')
    const resolve = reviewThreadClient.resolveThread as jest.Mock
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(JSON.parse(resolve.mock.calls[0][0].token)).toEqual({
      pull_requests: 'write',
      contents: 'write',
    })
    // The rest of the write-back keeps the narrower pull-request token.
    expect(JSON.parse(createIssue.mock.calls[0][0].token)).toEqual({
      pull_requests: 'write',
    })
  })

  it('regression: a refused thread-token mint still posts the summary (threads retried next sync)', async () => {
    ;(getRepoToken as jest.Mock).mockImplementation(
      async (_w: string, _r: string, perms: Record<string, string>) => {
        if (perms.contents) throw new Error('422 permissions not granted')
        return 'tok'
      }
    )
    threadRows.mockResolvedValue([
      thread({ state: 'OPEN', resolvedByLogin: null }),
    ])
    listThreads.mockResolvedValue([])
    findById.mockResolvedValue(scanRow([]))
    const out = await securityPrReviewService.syncReview('s1')
    expect(out.posted).toBe(true)
    expect(summaryBody()).toMatch(/No open findings/)
  })

  it('records a thread row for each new inline comment', async () => {
    findById.mockResolvedValue(scanRow([finding()]))
    ;(
      prCommentClient.listReviewCommentsOfReview as jest.Mock
    ).mockResolvedValue([
      {
        id: 303,
        body: 'x\n\n<!-- lumo-security:fp:fp1 -->',
        user: { type: 'Bot' },
      },
    ])
    const out = await securityPrReviewService.syncReview('s1')
    expect(out.inline).toBe(1)
    expect(prFindingThreadRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: 'pr1',
        fingerprint: 'fp1',
        commentId: '303',
        provenance: 'EXTERNAL_TOOL',
        filePath: 'lib/run.ts',
      })
    )
  })

  it('threadsLine stays silent until a thread has been addressed or resolved', () => {
    expect(threadsLine(undefined)).toBeNull()
    expect(threadsLine({ open: 3, addressed: 0, resolved: 0 })).toBeNull()
    expect(threadsLine({ open: 2, addressed: 1, resolved: 1 })).toBe(
      '**Review threads:** 2 open · 1 addressed · 1 resolved on GitHub'
    )
    expect(
      buildSummary({
        headSha: HEAD,
        stages: {},
        partial: false,
        externalCounts: {},
        open: 0,
        blocking: 0,
        error: null,
        taskUrl: null,
        threads: { open: 0, addressed: 2, resolved: 0 },
      })
    ).toContain('0 open · 2 addressed · 0 resolved on GitHub')
  })
})
