/**
 * @jest-environment node
 *
 * LUM-1150 follow-up — one security summary comment per PR, even when two
 * write-backs of the same scan run at the same moment. Production (probe
 * PR 51, head 77de048): the hunt workflow and the verifier finished within
 * milliseconds, each listed the PR's comments, found no summary and created
 * one — two summaries in the same second, and only the first was ever
 * updated again (the second stayed at "6 open findings", "Exploit paths
 * (scanning)"). Creating the summary is now single-writer per PR; a sync
 * that finds more than one Lumo summary keeps the oldest and deletes the rest.
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
      deleteIssueComment: jest.fn(),
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
    findSummaryCommentIdByPullRequest: jest.fn(),
    isPullRequestHeldElsewhere: jest.fn(),
    setSummaryCommentId: jest.fn(),
    claimInlineComments: jest.fn(),
    releaseInlineCommentClaims: jest.fn(),
    claimSummaryComment: jest.fn(),
    releaseSummaryCommentClaim: jest.fn(),
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

import {
  securityPrReviewService,
  SUMMARY_MARKER,
} from '@/ee/security/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const repo = prSecurityScanRepository as unknown as Record<string, jest.Mock>
const gh = prCommentClient as unknown as Record<string, jest.Mock>

const BOT = { id: 9, type: 'Bot', login: 'lumo[bot]' }
const HUMAN = { id: 1, type: 'User', login: 'alice' }

interface FakeComment {
  id: number
  body: string
  user: { id: number; type?: string; login?: string } | null
}

/** The PR's issue comments on "GitHub", in creation order. */
let comments: FakeComment[]
let nextId: number
/** The summary id stored per scan row (the DB column), by scan id. */
let storedIds: Map<string, string>
/** The summary claim table, in memory: pullRequestId → claimedAt ms. */
let claims: Map<string, number>

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    headSha: '77de048aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    summaryCommentId: null,
    findings: [],
    pullRequest: {
      id: 'pr1',
      repo: 'acme/app',
      number: 51,
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
    ...over,
  }
}

function lumoSummaries(): FakeComment[] {
  return comments.filter(
    c => c.body.includes(SUMMARY_MARKER) && c.user?.type === 'Bot'
  )
}

/** Fake GitHub + fake DB that behave like the real ones under concurrency. */
function realisticWorld() {
  comments = []
  nextId = 6192504041
  storedIds = new Map()
  claims = new Map()
  gh.createIssueComment!.mockImplementation(async ({ body }) => {
    const c = { id: nextId++, body, user: BOT }
    comments.push(c)
    return { id: c.id }
  })
  gh.updateIssueComment!.mockImplementation(async ({ externalId, body }) => {
    const c = comments.find(x => String(x.id) === String(externalId))
    if (!c) throw new GithubApiError(404, 'Not Found')
    c.body = body
    return { id: c.id }
  })
  gh.deleteIssueComment!.mockImplementation(async ({ externalId }) => {
    const i = comments.findIndex(x => String(x.id) === String(externalId))
    if (i < 0) throw new GithubApiError(404, 'Not Found')
    comments.splice(i, 1)
  })
  gh.listIssueComments!.mockImplementation(async () =>
    comments.map(c => ({ ...c }))
  )
  gh.listReviewComments!.mockResolvedValue([])
  gh.createReview!.mockResolvedValue({ id: 2 })
  repo.isPullRequestHeldElsewhere!.mockResolvedValue(false)
  repo.setSummaryCommentId!.mockImplementation(
    async (scanId: string, id: string) => {
      storedIds.set(scanId, id)
    }
  )
  repo.findSummaryCommentIdByPullRequest!.mockImplementation(
    async () => [...storedIds.values()].pop() ?? null
  )
  repo.claimSummaryComment!.mockImplementation(
    async (prId: string, staleBefore: Date) => {
      const at = claims.get(prId)
      if (at !== undefined && at >= staleBefore.getTime()) return null
      const now = Date.now()
      claims.set(prId, now)
      return new Date(now)
    }
  )
  repo.releaseSummaryCommentClaim!.mockImplementation(
    async (prId: string, claimedAt: Date) => {
      if (claims.get(prId) === claimedAt.getTime()) claims.delete(prId)
    }
  )
}

/** Every sync has listed the PR's issue comments before any goes on. */
function listingBarrier(syncs: number) {
  let waiting = 0
  let open: () => void = () => {}
  const allListed = new Promise<void>(resolve => (open = resolve))
  const listed = gh.listIssueComments!.getMockImplementation()!
  gh.listIssueComments!.mockImplementation(async (input: unknown) => {
    const snapshot = await listed(input)
    waiting++
    if (waiting === syncs) open()
    if (waiting <= syncs) await allListed
    return snapshot
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  realisticWorld()
})

describe('LUM-1150 one summary comment per PR', () => {
  it('two concurrent syncs that both found no summary create exactly one (production: PR 51, 6192504041 + 6192504059)', async () => {
    repo.findByIdForReview!.mockResolvedValue(scanRow())
    listingBarrier(2)
    const results = await Promise.all([
      securityPrReviewService.sync('s1'),
      securityPrReviewService.sync('s1'),
    ])
    expect(gh.createIssueComment).toHaveBeenCalledTimes(1)
    expect(lumoSummaries()).toHaveLength(1)
    // The loser wrote its (equally fresh) body into the winner's comment.
    expect(gh.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: String(lumoSummaries()[0]!.id) })
    )
    expect(results.every(r => r.posted)).toBe(true)
    expect(storedIds.get('s1')).toBe(String(lumoSummaries()[0]!.id))
    // The claim was given back once the id was on the row.
    expect(claims.size).toBe(0)
  })

  it('heals a PR that already carries two Lumo summaries: updates the oldest, deletes the extra, leaves others alone', async () => {
    comments = [
      { id: 6192504041, body: `old A\n\n${SUMMARY_MARKER}`, user: BOT },
      { id: 6192504059, body: `stale B\n\n${SUMMARY_MARKER}`, user: BOT },
      { id: 7, body: `quoting ${SUMMARY_MARKER}`, user: HUMAN },
      { id: 8, body: 'another bot comment', user: BOT },
      { id: 9, body: `deleted account ${SUMMARY_MARKER}`, user: null },
    ]
    // An earlier scan of the PR stored the NEWER duplicate's id.
    storedIds.set('s0', '6192504059')
    repo.findByIdForReview!.mockResolvedValue(scanRow())
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(gh.deleteIssueComment).toHaveBeenCalledTimes(1)
    expect(gh.deleteIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '6192504059' })
    )
    expect(comments.map(c => c.id)).toEqual([6192504041, 7, 8, 9])
    expect(lumoSummaries()).toHaveLength(1)
    expect(lumoSummaries()[0]!.body).not.toContain('old A')
    expect(storedIds.get('s1')).toBe('6192504041')
    expect(gh.createIssueComment).not.toHaveBeenCalled()
  })

  it('never deletes by marker on a PR another workspace also holds (its summary looks the same)', async () => {
    repo.isPullRequestHeldElsewhere!.mockResolvedValue(true)
    comments = [
      { id: 100, body: `other workspace\n\n${SUMMARY_MARKER}`, user: BOT },
      { id: 101, body: `ours\n\n${SUMMARY_MARKER}`, user: BOT },
    ]
    storedIds.set('s0', '101')
    repo.findByIdForReview!.mockResolvedValue(scanRow())
    await securityPrReviewService.sync('s1')
    expect(gh.deleteIssueComment).not.toHaveBeenCalled()
    expect(gh.updateIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '101' })
    )
  })

  it('a delete that fails does not fail the sync', async () => {
    comments = [
      { id: 41, body: `a\n\n${SUMMARY_MARKER}`, user: BOT },
      { id: 59, body: `b\n\n${SUMMARY_MARKER}`, user: BOT },
    ]
    storedIds.set('s0', '41')
    gh.deleteIssueComment!.mockRejectedValue(new GithubApiError(403, 'nope'))
    repo.findByIdForReview!.mockResolvedValue(scanRow())
    await expect(securityPrReviewService.sync('s1')).resolves.toMatchObject({
      posted: true,
    })
  })

  it('a claim store that cannot be reached still posts the summary (fail-open)', async () => {
    repo.claimSummaryComment!.mockRejectedValue(new Error('db down'))
    repo.findByIdForReview!.mockResolvedValue(scanRow())
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(lumoSummaries()).toHaveLength(1)
  })

  it('a stale claim (a writer that died before creating) is taken over', async () => {
    claims.set('pr1', Date.now() - 60 * 60_000)
    repo.findByIdForReview!.mockResolvedValue(scanRow())
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(gh.createIssueComment).toHaveBeenCalledTimes(1)
  })

  it('a writer that holds a live claim but never finishes: the other waits, then creates nothing', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      claims.set('pr1', Date.now())
      repo.findByIdForReview!.mockResolvedValue(scanRow())
      const pending = securityPrReviewService.sync('s1')
      await jest.advanceTimersByTimeAsync(60_000)
      const res = await pending
      expect(gh.createIssueComment).not.toHaveBeenCalled()
      expect(res.posted).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it('a sync whose scan already carries the id does not list comments (no extra GitHub call per sync)', async () => {
    comments = [{ id: 77, body: `x\n\n${SUMMARY_MARKER}`, user: BOT }]
    repo.findByIdForReview!.mockResolvedValue(
      scanRow({ summaryCommentId: '77' })
    )
    await securityPrReviewService.sync('s1')
    expect(gh.listIssueComments).not.toHaveBeenCalled()
    expect(repo.claimSummaryComment).not.toHaveBeenCalled()
  })
})
