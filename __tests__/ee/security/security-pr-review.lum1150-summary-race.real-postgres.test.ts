/**
 * @jest-environment node
 *
 * LUM-1150 follow-up — the summary-comment claim against a REAL Postgres
 * replayed from every migration (the claim table's migration included):
 *
 * - the repository: of two concurrent claims on one PR exactly one wins; a
 *   held claim is not won again; a release only drops the holder's own
 *   claim; a stale claim is taken over;
 * - end to end: two write-backs of one scan racing (production: PR 51, two
 *   summaries created in the same second) create exactly one summary
 *   comment, and the claim is gone afterwards.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      deleteIssueComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
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

import { prSecurityScanRepository as repo } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  securityPrReviewService,
  SUMMARY_MARKER,
} from '@/ee/security/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'

jest.setTimeout(180_000)

const gh = prCommentClient as unknown as Record<string, jest.Mock>

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws', name: 'W', slug: 'w' })
  for (const [id, number] of [
    ['pr_claim', 50],
    ['pr_race', 51],
  ] as const) {
    await harness.insert('pull_requests', {
      id,
      workspaceId: 'ws',
      repo: 'o/r',
      number,
      state: 'closed',
    })
  }
  await harness.insert('pr_security_scans', {
    id: 'scan_race',
    pullRequestId: 'pr_race',
    workspaceId: 'ws',
    headSha: '77de048aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    status: 'CLEAN',
    stages: JSON.stringify({ secrets: 'RAN', external: 'RAN', judge: 'RAN' }),
    trigger: 'PR_EVENT',
    detectorVersion: 'x',
  })
})
afterAll(async () => harness.stop())

const staleBefore = () => new Date(Date.now() - 5 * 60_000)

describe('summary claim (repository)', () => {
  it('two concurrent claims on one PR: exactly one wins', async () => {
    const [a, b] = await Promise.all([
      repo.claimSummaryComment('pr_claim', staleBefore()),
      repo.claimSummaryComment('pr_claim', staleBefore()),
    ])
    expect([a, b].filter(x => x !== null)).toHaveLength(1)
    const held = (a ?? b)!
    expect(await repo.claimSummaryComment('pr_claim', staleBefore())).toBeNull()

    // A release with someone else's token leaves the claim alone.
    await repo.releaseSummaryCommentClaim('pr_claim', new Date(0))
    expect(await repo.claimSummaryComment('pr_claim', staleBefore())).toBeNull()

    await repo.releaseSummaryCommentClaim('pr_claim', held)
    const again = await repo.claimSummaryComment('pr_claim', staleBefore())
    expect(again).toBeInstanceOf(Date)
    await repo.releaseSummaryCommentClaim('pr_claim', again!)
  })

  it('a claim older than staleBefore is taken over, and the old holder cannot release it', async () => {
    const first = await repo.claimSummaryComment('pr_claim', staleBefore())
    expect(first).not.toBeNull()
    await new Promise(r => setTimeout(r, 5))
    // Everything claimed before "a minute from now" counts as stale.
    const taken = await repo.claimSummaryComment(
      'pr_claim',
      new Date(Date.now() + 60_000)
    )
    expect(taken).not.toBeNull()
    await repo.releaseSummaryCommentClaim('pr_claim', first!)
    expect(await repo.claimSummaryComment('pr_claim', staleBefore())).toBeNull()
    await repo.releaseSummaryCommentClaim('pr_claim', taken!)
  })
})

describe('two concurrent write-backs of one scan (end to end)', () => {
  it('create exactly one summary comment', async () => {
    const comments: Array<{
      id: number
      body: string
      user: { id: number; type: string; login: string }
    }> = []
    let nextId = 6192504041
    gh.createIssueComment!.mockImplementation(async ({ body }) => {
      const c = {
        id: nextId++,
        body,
        user: { id: 9, type: 'Bot', login: 'lumo[bot]' },
      }
      comments.push(c)
      return { id: c.id }
    })
    gh.updateIssueComment!.mockImplementation(async ({ externalId, body }) => {
      const c = comments.find(x => String(x.id) === String(externalId))
      if (!c) throw new GithubApiError(404, 'Not Found')
      c.body = body
      return { id: c.id }
    })
    gh.listReviewComments!.mockResolvedValue([])
    // Both syncs have listed the PR's issue comments (and found no summary)
    // before either goes on — the production interleaving.
    let listed = 0
    let open: () => void = () => {}
    const allListed = new Promise<void>(r => (open = r))
    gh.listIssueComments!.mockImplementation(async () => {
      const snapshot = comments.map(c => ({ ...c }))
      listed++
      if (listed === 2) open()
      if (listed <= 2) await allListed
      return snapshot
    })

    const results = await Promise.all([
      securityPrReviewService.sync('scan_race'),
      securityPrReviewService.sync('scan_race'),
    ])

    expect(gh.createIssueComment).toHaveBeenCalledTimes(1)
    const summaries = comments.filter(c => c.body.includes(SUMMARY_MARKER))
    expect(summaries).toHaveLength(1)
    expect(results.every(r => r.posted)).toBe(true)
    const [row] = await harness.query<{ summaryCommentId: string | null }>(
      `SELECT "summaryCommentId" FROM pr_security_scans WHERE id = 'scan_race'`
    )
    expect(row!.summaryCommentId).toBe(String(summaries[0]!.id))
    const claims = await harness.query(
      `SELECT * FROM pr_security_summary_claims WHERE "pullRequestId" = 'pr_race'`
    )
    expect(claims).toEqual([])
  })
})
