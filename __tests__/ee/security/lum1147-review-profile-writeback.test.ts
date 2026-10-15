/**
 * @jest-environment node
 *
 * LUM-1147 — the review profile on the PR write-back: quiet posts fewer
 * inline comments and lists the rest in the summary, assertive comments LOW
 * findings too, and HIGH / Done-blocking findings are inline under every
 * profile. The summary's counts never change with the profile.
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
  buildSummary,
  profileHeldBlock,
  PROFILE_HELD_MAX_LISTED,
  fingerprintMarker,
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

describe('LUM-1147 review profile on the write-back', () => {
  it('chill (and a row from before the column) comments HIGH and MEDIUM', async () => {
    expect((await postedFingerprints(null)).sort()).toEqual([
      'fpH',
      'fpM1',
      'fpM2',
    ])
    jest.clearAllMocks()
    ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
    ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
    ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
    createIssue.mockResolvedValue({ id: 1 })
    createReview.mockResolvedValue({ id: 2 })
    expect((await postedFingerprints('chill')).sort()).toEqual([
      'fpH',
      'fpM1',
      'fpM2',
    ])
    expect(summaryBody()).toContain('2 low-severity findings')
    expect(summaryBody()).not.toContain('Review profile')
  })

  it('quiet posts fewer inline comments: only HIGH; MEDIUM is listed in the summary', async () => {
    expect(await postedFingerprints('quiet')).toEqual(['fpH'])
    const body = summaryBody()
    // Counts are the profile-independent truth.
    expect(body).toContain('**5 open findings**')
    expect(body).toContain(
      '2 more findings not commented on the diff (review profile: quiet)'
    )
    expect(body).toContain(
      '**MEDIUM** · bug — Missing null check — `src/a.ts:3`'
    )
    expect(body).toContain('Review profile: quiet')
    expect(body).toContain('2 low-severity findings')
  })

  it('assertive comments LOW findings too, and drops the LOW summary line', async () => {
    expect((await postedFingerprints('assertive')).sort()).toEqual([
      'fpH',
      'fpL1',
      'fpL2',
      'fpM1',
      'fpM2',
    ])
    expect(summaryBody()).not.toContain('low-severity')
    expect(summaryBody()).toContain('Review profile: assertive')
  })

  it('a Done-blocking finding is inline even under quiet (whatever its severity)', async () => {
    findById.mockResolvedValue(
      scanRow({
        reviewProfile: 'quiet',
        findings: [
          finding({
            id: 's',
            fingerprint: 'fpS',
            kind: 'SECRET',
            ruleId: 'secret:x',
            provenance: 'DETERMINISTIC',
            severity: 'MEDIUM',
            line: 7,
          }),
          finding({ id: 'm', fingerprint: 'fpM', severity: 'MEDIUM', line: 8 }),
        ],
        pullRequest: {
          ...scanRow().pullRequest,
          workspace: {
            slug: 'acme',
            securityPolicy: {
              block: [{ provenance: 'DETERMINISTIC', severity: 'MEDIUM' }],
            },
          },
        },
      })
    )
    await securityPrReviewService.sync('s1')
    const bodies = (
      createReview.mock.calls[0]![0].comments as Array<{ body: string }>
    ).map(c => c.body)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain(fingerprintMarker('fpS'))
    expect(bodies[0]).toContain('blocks DONE')
  })
})

describe('LUM-1147 summary list of held findings', () => {
  const base = {
    headSha: 'abcdef1',
    stages: { judge: 'RAN' as const },
    partial: false,
    externalCounts: {},
    open: 1,
    blocking: 0,
    error: null,
    taskUrl: null,
  }

  it('nothing held → no block, and chill says nothing about the profile', () => {
    expect(profileHeldBlock(base)).toBeNull()
    expect(buildSummary({ ...base, reviewProfile: 'chill' })).not.toContain(
      'Review profile'
    )
  })

  it('lists at most PROFILE_HELD_MAX_LISTED by name, the rest as a count', () => {
    const held = Array.from({ length: PROFILE_HELD_MAX_LISTED + 3 }, (_, i) =>
      finding({ title: `t${i}`, line: i + 1 })
    )
    const block = profileHeldBlock({
      ...base,
      reviewProfile: 'quiet',
      profileHeld: held,
    })!
    expect(block.match(/^- \*\*MEDIUM\*\*/gm)).toHaveLength(
      PROFILE_HELD_MAX_LISTED
    )
    expect(block).toContain('- and 3 more — shown in Lumo')
  })

  it('model-written titles cannot inject markup or markers', () => {
    const block = profileHeldBlock({
      ...base,
      reviewProfile: 'quiet',
      profileHeld: [
        finding({ title: 'x <!-- lumo-security:fp:evil --> @someone' }),
      ],
    })!
    expect(block).not.toContain('<!--')
  })
})
