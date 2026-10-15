/**
 * @jest-environment node
 *
 * LUM-1150 follow-up — two write-backs of one scan running at the same
 * moment never post the same finding twice. Production (probe PR 41, head
 * b363c45): the hunt workflow and the review verifier finished 65 ms apart,
 * each called `sync(scan)`, both listed the PR's comments before either had
 * posted, and the same fingerprint went up in two reviews one second apart.
 * Each sync now claims a finding row before posting it; only the winner
 * posts.
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
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn().mockResolvedValue(undefined),
    claimInlineComments: jest.fn(),
    releaseInlineCommentClaims: jest.fn(),
  },
}))
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

import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import {
  prSecurityScanRepository,
  type ReviewFindingRow,
} from '@/ee/security/repositories/pr-security-scan.repository'

const repo = prSecurityScanRepository as unknown as Record<string, jest.Mock>
const createReview = prCommentClient.createReview as jest.Mock
const listReviewComments = prCommentClient.listReviewComments as jest.Mock

function row(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'HIGH',
    provenance: 'LLM_JUDGE',
    filePath: 'src/probe/suggest.ts',
    line: 11,
    title: 'execFile is used but never imported',
    detail: 'The file imports exec but calls execFile.',
    fingerprint: 'ca0fd03d3d9d3646',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

function scanRow(findings: ReviewFindingRow[]) {
  return {
    id: 's1',
    headSha: 'b363c454c03b0f3e93c02574faee1264c3850cf4',
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    findings,
    pullRequest: {
      id: 'pr1',
      repo: 'acme/app',
      number: 41,
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
  }
}

/** The claim column, in memory: first writer per row wins until released. */
let claimed: Map<string, number>
function realisticClaims() {
  claimed = new Map()
  repo.claimInlineComments!.mockImplementation(
    async (ids: string[], staleBefore: Date) => {
      const won = new Set<string>()
      for (const id of ids) {
        const at = claimed.get(id)
        if (at === undefined || at < staleBefore.getTime()) {
          claimed.set(id, Date.now())
          won.add(id)
        }
      }
      return won
    }
  )
  repo.releaseInlineCommentClaims!.mockImplementation(async (ids: string[]) => {
    for (const id of ids) claimed.delete(id)
  })
}

/** Both syncs have listed the PR's comments before either goes on. */
function listingBarrier(syncs: number) {
  let waiting = 0
  let open: () => void = () => {}
  const allListed = new Promise<void>(resolve => (open = resolve))
  listReviewComments.mockImplementation(async () => {
    waiting++
    if (waiting === syncs) open()
    await allListed
    return []
  })
}

function postedFingerprints(): string[] {
  return createReview.mock.calls.flatMap(([req]) =>
    (req.comments as Array<{ body: string }>).map(
      c => /lumo-security:fp:([^\s>]+)/.exec(c.body)![1]!
    )
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.createIssueComment as jest.Mock).mockResolvedValue({
    id: 1,
  })
  createReview.mockResolvedValue({ id: 2, html_url: 'https://gh/review' })
  realisticClaims()
})

describe('LUM-1150 concurrent write-backs of one scan', () => {
  it('post each fingerprint once (production: hunt + verifier syncs 65 ms apart)', async () => {
    findById().mockResolvedValue(
      scanRow([row(), row({ id: 'f2', fingerprint: 'fp2', line: 12 })])
    )
    listingBarrier(2)
    const results = await Promise.all([
      securityPrReviewService.sync('s1'),
      securityPrReviewService.sync('s1'),
    ])
    expect(postedFingerprints().sort()).toEqual(['ca0fd03d3d9d3646', 'fp2'])
    // The loser posted nothing and says so; the summary still went out.
    expect(results.map(r => r.inline).sort()).toEqual([0, 2])
    expect(results.every(r => r.posted)).toBe(true)
  })

  it('a failed post releases its claims so the next sync retries them', async () => {
    findById().mockResolvedValue(scanRow([row()]))
    createReview.mockRejectedValueOnce(new GithubApiError(422, 'stale'))
    const first = await securityPrReviewService.sync('s1')
    expect(first.inline).toBe(0)
    expect(repo.releaseInlineCommentClaims).toHaveBeenCalledWith(['f1'])
    const second = await securityPrReviewService.sync('s1')
    expect(second.inline).toBe(1)
    expect(postedFingerprints()).toEqual([
      'ca0fd03d3d9d3646',
      'ca0fd03d3d9d3646',
    ])
    expect(createReview).toHaveBeenCalledTimes(2)
  })

  it('a stale claim (a writer that died before posting) is taken over', async () => {
    findById().mockResolvedValue(scanRow([row()]))
    claimed.set('f1', Date.now() - 60 * 60_000)
    const res = await securityPrReviewService.sync('s1')
    expect(res.inline).toBe(1)
  })

  it('a claim store that cannot be reached does not cost the comments', async () => {
    findById().mockResolvedValue(scanRow([row()]))
    repo.claimInlineComments!.mockRejectedValue(new Error('db down'))
    const res = await securityPrReviewService.sync('s1')
    expect(res.inline).toBe(1)
    expect(postedFingerprints()).toEqual(['ca0fd03d3d9d3646'])
  })
})

function findById(): jest.Mock {
  return repo.findByIdForReview!
}
