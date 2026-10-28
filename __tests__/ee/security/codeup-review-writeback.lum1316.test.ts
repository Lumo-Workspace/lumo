/**
 * @jest-environment node
 *
 * LUM-1316 — the one review write-back (`securityPrReviewService`) on a
 * Codeup merge request, through the real Codeup GitProvider adapter with
 * Codeup's API mocked at fetch: one summary comment and one inline comment
 * per finding; a re-push updates the summary in place and does not re-post
 * an inline finding already on the MR; nothing reaches GitHub, and the
 * write-backs Codeup does not declare (threads, verdict, description) are
 * never attempted.
 */
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn(),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn(),
    claimSummaryComment: jest.fn(),
    releaseSummaryCommentClaim: jest.fn(),
    claimInlineComments: jest.fn(),
    releaseInlineCommentClaims: jest.fn(),
    isRequestChangesOnElsewhere: jest.fn().mockResolvedValue(false),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
jest.mock('@/lib/repositories/codeup.repository', () => ({
  codeupRepository: { findConnectionByWorkspace: jest.fn() },
}))
jest.mock('@/lib/crypto', () => ({ decrypt: jest.fn(() => 'plain-pat') }))
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
  SUMMARY_MARKER,
  fingerprintMarker,
} from '@/ee/security/services/security-pr-review.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import {
  HEAD,
  LOCAL_ID,
  MR_PATH,
  ORG,
  REPO,
  comment,
  fakeCodeup,
  type FakeCodeup,
} from '@/test-utils/codeup/merge-request-api'

const scans = prSecurityScanRepository as jest.Mocked<
  typeof prSecurityScanRepository
>
const WS = 'ws-dog'

function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'VULNERABILITY',
    ruleId: 'review:command-injection',
    severity: 'HIGH',
    provenance: 'LLM_JUDGE',
    filePath: 'lib/run.ts',
    line: 2,
    title: 'Command injection',
    detail: 'The query string reaches exec.',
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

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    status: 'FINDINGS',
    headSha: HEAD,
    stages: {
      secrets: 'RAN',
      judge: 'RAN',
      external: 'NOT_CONFIGURED',
      supplyChain: 'NOT_CONFIGURED',
      hunt: 'NOT_CONFIGURED',
    },
    partial: false,
    error: null,
    summaryCommentId: null,
    suggestedAt: new Date('2026-10-27T00:00:00Z'),
    findings: [finding()],
    pullRequest: {
      id: 'pr1',
      provider: 'codeup',
      repo: REPO,
      number: LOCAL_ID,
      headSha: HEAD,
      state: 'open',
      workspaceId: WS,
      task: { number: 12, team: { identifier: 'LUM' } },
      workspace: { slug: 'lumo', securityPolicy: null },
    },
    ...over,
  }
}

const OLD_ENV = process.env
const realFetch = global.fetch
let codeup: FakeCodeup
function useFake(f: FakeCodeup) {
  codeup = f
  global.fetch = f.fetch as unknown as typeof fetch
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...OLD_ENV,
    LUMO_DOGFOOD_WORKSPACE_IDS: WS,
    LUMO_REVIEW_VERIFIER: 'off',
  }
  ;(codeupRepository.findConnectionByWorkspace as jest.Mock).mockResolvedValue({
    id: 'c1',
    organizationId: ORG,
    accessToken: 'enc',
    repositories: [
      {
        id: 'r1',
        repositoryId: 2835387,
        pathWithNamespace: REPO,
        webUrl: '',
        webhookId: 1,
        confirmedAt: new Date(),
      },
    ],
  })
  scans.findSummaryCommentIdByPullRequest.mockResolvedValue(null)
  scans.claimSummaryComment.mockResolvedValue(new Date())
  scans.claimInlineComments.mockImplementation(async ids => new Set(ids))
  useFake(fakeCodeup({ createdIds: ['sum-1', 'inl-1', 'inl-2'] }))
})
afterAll(() => {
  process.env = OLD_ENV
  global.fetch = realFetch
})

const posted = (type: string) =>
  (
    codeup.bodies(`POST ${MR_PATH}/comments`) as Array<{
      comment_type: string
      content: string
      file_path?: string
      line_number?: number
    }>
  ).filter(b => b.comment_type === type)

describe('LUM-1316 Lumo review write-back on a Codeup merge request', () => {
  it('posts one summary comment and an inline comment on the changed line; remembers the summary id', async () => {
    scans.findByIdForReview.mockResolvedValue(scanRow() as never)
    const out = await securityPrReviewService.syncReview('s1')

    expect(out).toMatchObject({ posted: true, inline: 1 })
    const summaries = posted('GLOBAL_COMMENT')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.content).toContain(SUMMARY_MARKER)
    expect(summaries[0]!.content).toContain(
      `https://codeup.aliyun.com/${REPO}/commit/${HEAD}`
    )
    const inline = posted('INLINE_COMMENT')
    expect(inline).toEqual([
      expect.objectContaining({ file_path: '/lib/run.ts', line_number: 2 }),
    ])
    expect(inline[0]!.content).toContain(fingerprintMarker('fp1'))
    expect(scans.setSummaryCommentId).toHaveBeenCalledWith('s1', '1:sum-1')

    // Only Codeup was called — and none of the undeclared write-backs.
    for (const [url] of codeup.fetch.mock.calls)
      expect(String(url)).toMatch(/^https:\/\/openapi-rdc\.aliyuncs\.com\//)
    expect(codeup.calls().some(c => c.startsWith('PUT'))).toBe(false)
    expect(prFindingThreadRepository.findByPullRequest).not.toHaveBeenCalled()
    expect(prFindingThreadRepository.upsert).not.toHaveBeenCalled()
  })

  it('re-push: the summary is updated in place (no second summary) and a finding already on the MR is not re-posted', async () => {
    // The next push's scan finds the PR's summary id from the earlier scan.
    scans.findSummaryCommentIdByPullRequest.mockResolvedValue('1:sum-1')
    useFake(
      fakeCodeup({
        createdIds: ['inl-2'],
        comments: {
          INLINE_COMMENT: [
            comment({
              comment_type: 'INLINE_COMMENT',
              content: `old comment ${fingerprintMarker('fp1')}`,
              filePath: '/lib/run.ts',
              line_number: 2,
            }),
          ],
        },
      })
    )
    scans.findByIdForReview.mockResolvedValue(
      scanRow({
        id: 's2',
        findings: [
          finding(),
          finding({
            id: 'f2',
            fingerprint: 'fp2',
            filePath: 'docs/login.md',
            line: 1,
            title: 'Second issue',
          }),
        ],
      }) as never
    )
    const out = await securityPrReviewService.syncReview('s2')

    expect(out).toMatchObject({ posted: true, inline: 1 })
    expect(posted('GLOBAL_COMMENT')).toEqual([])
    expect(codeup.bodies(`PUT ${MR_PATH}/comments/sum-1`)).toEqual([
      { content: expect.stringContaining(SUMMARY_MARKER) },
    ])
    expect(posted('INLINE_COMMENT')).toEqual([
      expect.objectContaining({ file_path: '/docs/login.md', line_number: 1 }),
    ])
    expect(scans.setSummaryCommentId).toHaveBeenCalledWith('s2', '1:sum-1')
  })

  it('a summary deleted on Codeup (404 on update) is written again', async () => {
    scans.findSummaryCommentIdByPullRequest.mockResolvedValue('1:gone')
    useFake(
      fakeCodeup({
        createdIds: ['sum-2', 'inl-1'],
        fail: { [`PUT ${MR_PATH}/comments/gone`]: 404 },
      })
    )
    scans.findByIdForReview.mockResolvedValue(scanRow() as never)
    await securityPrReviewService.syncReview('s1')
    expect(posted('GLOBAL_COMMENT')).toHaveLength(1)
    expect(scans.setSummaryCommentId).toHaveBeenCalledWith('s1', '1:sum-2')
  })
})
