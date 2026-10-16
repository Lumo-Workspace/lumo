/**
 * @jest-environment node
 *
 * LUM-1212 — a finding that would be commented inline but has no line (the
 * model gave none and its evidence anchored nowhere) is not silently left in
 * the count: the summary lists it by name and says it could not be placed
 * on the diff. Setup mirrors lum1147-review-profile-writeback.test.ts.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    // LUM-901: this scan is the PR's newest — the sync goes ahead.
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    // LUM-740: no stored summary id → the legacy marker path these
    // expectations describe.
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    // LUM-924: no other workspace holds the PR — the legacy marker path runs.
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn().mockResolvedValue(undefined),
  },
}))
// LUM-901: scanning on for the workspace — the sync goes ahead.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
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
  unanchoredBlock,
} from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock

function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f',
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'MEDIUM',
    provenance: 'LLM_JUDGE',
    filePath: 'src/a.ts',
    line: 10,
    title: 'Wrong condition',
    detail: 'The check is inverted.',
    fingerprint: 'fp',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

/** One HIGH, two MEDIUM and two LOW findings, each on its own line. */
const MIX = [
  finding({
    id: 'u',
    fingerprint: 'fpU',
    severity: 'MEDIUM',
    line: null,
    title: 'Unplaced problem',
  }),
  finding({ id: 'h', fingerprint: 'fpH', severity: 'HIGH', line: 1 }),
  finding({ id: 'm1', fingerprint: 'fpM1', severity: 'MEDIUM', line: 2 }),
  finding({
    id: 'm2',
    fingerprint: 'fpM2',
    severity: 'MEDIUM',
    line: 3,
    title: 'Missing null check',
  }),
  finding({ id: 'l1', fingerprint: 'fpL1', severity: 'LOW', line: 4 }),
  finding({ id: 'l2', fingerprint: 'fpL2', severity: 'LOW', line: 5 }),
]

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    status: 'FINDINGS',
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    // The verifier already finished: judge rows are not held.
    verifierStartedAt: new Date(0),
    verifiedAt: new Date(0),
    findings: MIX,
    pullRequest: {
      repo: 'acme/app',
      number: 9,
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
    ...over,
  }
}

async function postedFingerprints(profile: string | null): Promise<string[]> {
  findById.mockResolvedValue(scanRow({ reviewProfile: profile }))
  await securityPrReviewService.sync('s1')
  const call = createReview.mock.calls[0]
  if (!call) return []
  return (call[0].comments as Array<{ body: string }>).map(
    c => /lumo-security:fp:(\S+) -->/.exec(c.body)![1]!
  )
}

function summaryBody(): string {
  return createIssue.mock.calls[0]![0].body as string
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
  createIssue.mockResolvedValue({ id: 1 })
  ;(prCommentClient.updateIssueComment as jest.Mock).mockResolvedValue({
    id: 1,
  })
  createReview.mockResolvedValue({ id: 2 })
})

describe('LUM-1212 line-less findings in the summary', () => {
  it('lists an inline-eligible finding without a line and says why it is not on the diff', async () => {
    const fps = await postedFingerprints(null)
    expect(fps.sort()).toEqual(['fpH', 'fpM1', 'fpM2'])
    const body = summaryBody()
    expect(body).toContain(
      '1 finding could not be placed on a line of the diff'
    )
    expect(body).toContain('**MEDIUM** · bug — Unplaced problem — `src/a.ts`')
  })

  it('does not list it twice: a LOW one under assertive is not "shown in Lumo only"', async () => {
    findById.mockResolvedValue(
      scanRow({
        reviewProfile: 'assertive',
        findings: [
          ...MIX,
          finding({
            id: 'u2',
            fingerprint: 'fpU2',
            severity: 'LOW',
            line: null,
            title: 'Unplaced low',
          }),
        ],
      })
    )
    await securityPrReviewService.sync('s1')
    const body = summaryBody()
    expect(body).toContain(
      '2 findings could not be placed on a line of the diff'
    )
    expect(body).not.toContain('low-severity finding')
  })

  it('says nothing when every finding has a line, or a line-less one would not be inline anyway', () => {
    expect(unanchoredBlock([])).toBeNull()
    expect(unanchoredBlock(undefined)).toBeNull()
  })
})
