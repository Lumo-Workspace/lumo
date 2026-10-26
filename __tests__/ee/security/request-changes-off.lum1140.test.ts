/**
 * @jest-environment node
 *
 * LUM-1140 — turning the request-changes workflow off dismisses Lumo's
 * standing "changes requested" reviews: the settings change on → off runs a
 * bounded background pass over the workspace's open PRs (the real
 * settings service → real withdrawal service → mocked GitHub), human
 * reviews and other workspaces' PRs are untouched, and a PR the pass missed
 * is caught at its next review sync while the mode is off.
 */
const mockPrisma = {
  pullRequest: { findMany: jest.fn(), count: jest.fn() },
}
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      findMany: (...a: unknown[]) => mockPrisma.pullRequest.findMany(...a),
      count: (...a: unknown[]) => mockPrisma.pullRequest.count(...a),
    },
  },
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      listReviews: jest.fn(),
      dismissReview: jest.fn().mockResolvedValue(undefined),
      submitReview: jest.fn(),
      getPullRequestHead: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: { findSecuritySwitches: jest.fn() },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberRoleById: jest.fn() },
}))
jest.mock('@/lib/services/workspace.service', () => ({
  workspaceService: { updateWorkspace: jest.fn().mockResolvedValue({}) },
}))
const mockBackground: Promise<unknown>[] = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockBackground.push(p)
  },
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
  GithubApiError,
  prCommentClient,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { securityScanSettingsService } from '@/ee/security/services/security-scan-settings.service'
import {
  BULK_MAX_PRS,
  BULK_TIME_BUDGET_MS,
  RETRY_DELAYS_MS,
  requestChangesOffService,
} from '@/ee/security/services/request-changes-off.service'
import {
  WITHDRAW_MESSAGE,
  describeGithubFailure,
  isRateLimited,
  isTransientGithubFailure,
  prReviewVerdictService,
} from '@/ee/security/services/pr-review-verdict.service'
import { logger } from '@/lib/logger'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const listReviews = m(prCommentClient.listReviews)
const dismissReview = m(prCommentClient.dismissReview)
const submitReview = m(prCommentClient.submitReview)
const switches = m(securityColumnsRepository.findSecuritySwitches)

const CALLER = { workspaceId: 'ws_a', workspaceSlug: 'acme', memberId: 'm_1' }
const lumoBot = { login: 'uselumo[bot]', type: 'Bot' }
const human = { login: 'alice', type: 'User' }
const review = (
  id: number,
  state: string,
  user: { login: string; type: string } = lumoBot
) => ({ id, state, commit_id: 'abc', user })

const ON = {
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
  securityRequestChangesEnabled: true,
}
const OFF = { ...ON, securityRequestChangesEnabled: false }

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
  mockBackground.length = 0
  m(miscRepository.findMemberRoleById).mockResolvedValue('OWNER')
  mockPrisma.pullRequest.findMany.mockResolvedValue([
    { id: 'pr1', repo: 'acme/app', number: 1 },
    { id: 'pr2', repo: 'acme/app', number: 2 },
  ])
  mockPrisma.pullRequest.count.mockResolvedValue(0)
  listReviews.mockImplementation(async ({ prNumber }: { prNumber: number }) =>
    prNumber === 1
      ? [
          review(11, 'CHANGES_REQUESTED'),
          review(12, 'CHANGES_REQUESTED', human),
        ]
      : [review(21, 'DISMISSED'), review(22, 'CHANGES_REQUESTED')]
  )
})

/** Turn the workflow from `before` to off through the real settings service. */
async function turnOff(before: typeof ON) {
  // read before the write, then the settings read-back after it
  switches.mockResolvedValueOnce(before).mockResolvedValue(OFF)
  await securityScanSettingsService.update(CALLER, {
    securityRequestChangesEnabled: false,
  })
  await Promise.all(mockBackground)
}

describe('LUM-1140 turning the request-changes workflow off', () => {
  it("off ⇒ Lumo's CHANGES_REQUESTED reviews on open PRs are dismissed", async () => {
    await turnOff(ON)
    expect(dismissReview.mock.calls.map(c => c[0].reviewId).sort()).toEqual([
      11, 22,
    ])
    expect(dismissReview).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { owner: 'acme', name: 'app' },
        prNumber: 1,
        message: WITHDRAW_MESSAGE,
      })
    )
    // never an approval
    expect(submitReview).not.toHaveBeenCalled()
  })

  it("human reviews and Lumo's already-dismissed ones are untouched", async () => {
    await turnOff(ON)
    const ids = dismissReview.mock.calls.map(c => c[0].reviewId)
    expect(ids).not.toContain(12)
    expect(ids).not.toContain(21)
  })

  it("only this workspace's open PRs are visited, with this workspace's token", async () => {
    await turnOff(ON)
    expect(mockPrisma.pullRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws_a', provider: 'github', state: 'open' },
        take: BULK_MAX_PRS,
      })
    )
    for (const call of m(getRepoToken).mock.calls) expect(call[0]).toBe('ws_a')
    // one token per repository, not per PR
    expect(getRepoToken).toHaveBeenCalledTimes(1)
  })

  it('a PR another workspace holds with the mode on is left alone', async () => {
    mockPrisma.pullRequest.count.mockImplementation(
      async ({ where }: { where: { number: number } }) =>
        where.number === 1 ? 1 : 0
    )
    await turnOff(ON)
    expect(mockPrisma.pullRequest.count).toHaveBeenCalledWith({
      where: {
        provider: 'github',
        repo: 'acme/app',
        number: 1,
        id: { not: 'pr1' },
        workspace: { securityRequestChangesEnabled: true },
      },
    })
    expect(dismissReview.mock.calls.map(c => c[0].reviewId)).toEqual([22])
  })

  it('no pass when the workflow was already off or stays on', async () => {
    await turnOff(OFF)
    switches.mockReset()
    switches.mockResolvedValueOnce(ON).mockResolvedValue(ON)
    await securityScanSettingsService.update(CALLER, {
      securityHuntEnabled: true,
    })
    await Promise.all(mockBackground)
    expect(mockBackground).toHaveLength(0)
    expect(listReviews).not.toHaveBeenCalled()
    expect(dismissReview).not.toHaveBeenCalled()
  })
})

describe('LUM-1140 bulk pass bounds', () => {
  it('turned back on before the pass runs ⇒ nothing', async () => {
    switches.mockResolvedValue(ON)
    const r = await requestChangesOffService.withdrawAcrossWorkspace('ws_a')
    expect(r.stopped).toBe('mode_on')
    expect(listReviews).not.toHaveBeenCalled()
  })

  it('stops at a GitHub rate limit', async () => {
    switches.mockResolvedValue(OFF)
    listReviews.mockRejectedValue(
      new GithubApiError(403, { message: 'rate limit' }, new Date())
    )
    const r = await requestChangesOffService.withdrawAcrossWorkspace('ws_a')
    expect(r).toEqual({ checked: 1, dismissed: 0, stopped: 'rate_limited' })
  })

  it('stops at the time budget', async () => {
    switches.mockResolvedValue(OFF)
    let t = 0
    const now = () => {
      const v = t
      t += BULK_TIME_BUDGET_MS
      return v
    }
    const r = await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      now
    )
    expect(r.stopped).toBe('time_budget')
    expect(r.checked).toBe(1)
  })

  it('one failing PR does not stop the pass', async () => {
    switches.mockResolvedValue(OFF)
    listReviews.mockRejectedValueOnce(new GithubApiError(404, null))
    const r = await requestChangesOffService.withdrawAcrossWorkspace('ws_a')
    expect(r).toEqual({ checked: 2, dismissed: 1, stopped: null })
  })
})

describe('LUM-1140 lazy path (withdrawOnPullRequest)', () => {
  const pr = { id: 'pr1', workspaceId: 'ws_a', repo: 'acme/app', number: 1 }
  it('dismisses with the given token and never throws', async () => {
    expect(
      await requestChangesOffService.withdrawOnPullRequest(pr, 'sync')
    ).toBe(1)
    expect(dismissReview).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'sync', reviewId: 11 })
    )
    listReviews.mockRejectedValueOnce(new Error('boom'))
    expect(await requestChangesOffService.withdrawOnPullRequest(pr)).toBe(0)
  })
  it('an unparseable repository name is skipped', async () => {
    expect(
      await requestChangesOffService.withdrawOnPullRequest(
        { ...pr, repo: 'x' },
        't'
      )
    ).toBe(0)
    expect(listReviews).not.toHaveBeenCalled()
  })
})

describe('LUM-1140 withdrawChangeRequests / isRateLimited', () => {
  it('a failed dismissal is logged and the rest still go; a rate limit throws', async () => {
    listReviews.mockResolvedValue([
      review(1, 'CHANGES_REQUESTED'),
      review(2, 'CHANGES_REQUESTED'),
    ])
    dismissReview.mockRejectedValueOnce(new GithubApiError(422, null))
    const input = { repo: { owner: 'a', name: 'b' }, prNumber: 3, token: 't' }
    expect(await prReviewVerdictService.withdrawChangeRequests(input)).toBe(1)
    dismissReview.mockRejectedValueOnce(
      new GithubApiError(429, null, new Date())
    )
    await expect(
      prReviewVerdictService.withdrawChangeRequests(input)
    ).rejects.toBeInstanceOf(GithubApiError)
  })
  it('isRateLimited only for an error carrying the reset time', () => {
    expect(isRateLimited(new GithubApiError(403, null, new Date()))).toBe(true)
    expect(isRateLimited(new GithubApiError(403, null))).toBe(false)
    expect(isRateLimited(new Error('x'))).toBe(false)
    expect(isRateLimited(null)).toBe(false)
  })
})

describe('LUM-1140 repository', () => {
  it('findOpenPullRequestsOfWorkspace: open PRs of the workspace, newest first, capped', async () => {
    await prSecurityScanRepository.findOpenPullRequestsOfWorkspace('ws_a', 5)
    expect(mockPrisma.pullRequest.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_a', provider: 'github', state: 'open' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, repo: true, number: true },
    })
  })
  it('isRequestChangesOnElsewhere counts other holders with the mode on', async () => {
    mockPrisma.pullRequest.count.mockResolvedValueOnce(2)
    expect(
      await prSecurityScanRepository.isRequestChangesOnElsewhere({
        id: 'pr1',
        repo: 'acme/app',
        number: 1,
      })
    ).toBe(true)
  })
})

/**
 * What production saw on lumo-agent-test#24: the token mint (Octokit) lost
 * its connection to GitHub. Octokit turns fetch's `TypeError: fetch failed`
 * into a RequestError with status 500 and the CAUSE's message — and a refused
 * or timed-out multi-address connect is an `AggregateError` whose message is
 * empty. Reproduced against @octokit/request 10.0.8: message "" status 500.
 */
function octokitNetworkFailure(): Error {
  // Node's AggregateError (empty message) — built by hand: the TS lib here
  // predates ES2021's AggregateError / ES2022's error `cause` option.
  const connect = Object.assign(new Error(''), {
    name: 'AggregateError',
    code: 'ETIMEDOUT',
  })
  const fetchFailed = Object.assign(new TypeError('fetch failed'), {
    cause: connect,
  })
  return Object.assign(new Error(''), {
    name: 'HttpError',
    status: 500,
    cause: fetchFailed,
  })
}

describe('LUM-1140 regression: a transient GitHub failure does not leave the change request standing', () => {
  const noSleep = jest.fn(async () => undefined)
  const warns = () => m(logger.warn).mock.calls.map(c => String(c[0]))

  beforeEach(() => {
    noSleep.mockClear()
    switches.mockResolvedValue(OFF)
    mockPrisma.pullRequest.findMany.mockResolvedValue([
      { id: 'pr24', repo: 'Lumo-Workspace/lumo-agent-test', number: 24 },
    ])
    m(getRepoToken).mockReset().mockResolvedValue('tok')
    listReviews
      .mockReset()
      .mockResolvedValue([review(5520255111, 'CHANGES_REQUESTED')])
  })

  it('the bulk pass retries a failed token mint and dismisses', async () => {
    m(getRepoToken)
      .mockRejectedValueOnce(octokitNetworkFailure())
      .mockResolvedValue('tok')
    const r = await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      Date.now,
      noSleep
    )
    expect(r).toEqual({ checked: 1, dismissed: 1, stopped: null })
    expect(dismissReview).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 24, reviewId: 5520255111 })
    )
    expect(noSleep).toHaveBeenCalledWith(RETRY_DELAYS_MS[0])
  })

  it("a failed mint is not reused for the repository's next PR", async () => {
    mockPrisma.pullRequest.findMany.mockResolvedValue([
      { id: 'pr24', repo: 'Lumo-Workspace/lumo-agent-test', number: 24 },
      { id: 'pr25', repo: 'Lumo-Workspace/lumo-agent-test', number: 25 },
    ])
    const tries = RETRY_DELAYS_MS.length + 1
    for (let i = 0; i < tries; i++)
      m(getRepoToken).mockRejectedValueOnce(octokitNetworkFailure())
    m(getRepoToken).mockResolvedValue('tok')
    const r = await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      Date.now,
      noSleep
    )
    // #24 gives up after every retry; #25 mints afresh and is dismissed
    expect(r).toEqual({ checked: 2, dismissed: 1, stopped: null })
    expect(getRepoToken).toHaveBeenCalledTimes(tries + 1)
    expect(dismissReview.mock.calls.map(c => c[0].prNumber)).toEqual([25])
  })

  it('the warning says what failed: status and cause, never an empty text', async () => {
    m(getRepoToken).mockRejectedValue(octokitNetworkFailure())
    await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      Date.now,
      noSleep
    )
    const line = warns().find(w => w.includes('withdraw failed pr=#24'))
    expect(line).toBe(
      '[request-changes-off] withdraw failed pr=#24: status=500 HttpError: (no message) cause=TypeError: fetch failed cause=AggregateError ETIMEDOUT'
    )
    expect(line).not.toContain('tok')
  })

  it("a GitHub refusal (4xx) is not retried and the log carries GitHub's message", async () => {
    listReviews.mockRejectedValue(
      new GithubApiError(403, {
        message: 'Resource not accessible by integration',
      })
    )
    const r = await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      Date.now,
      noSleep
    )
    expect(r.dismissed).toBe(0)
    expect(listReviews).toHaveBeenCalledTimes(1)
    expect(noSleep).not.toHaveBeenCalled()
    expect(warns()).toContain(
      '[request-changes-off] withdraw failed pr=#24: status=403 Error: Resource not accessible by integration'
    )
  })

  it('no retry past the time budget', async () => {
    m(getRepoToken).mockRejectedValue(octokitNetworkFailure())
    let t = 0
    const now = () => {
      const v = t
      t += BULK_TIME_BUDGET_MS - 100
      return v
    }
    const r = await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      now,
      noSleep
    )
    expect(r.dismissed).toBe(0)
    expect(noSleep).not.toHaveBeenCalled()
  })

  it('a transient failure of the dismissal itself is retried too', async () => {
    dismissReview
      .mockReset()
      .mockRejectedValueOnce(new GithubApiError(502, null))
      .mockResolvedValue(undefined)
    const r = await requestChangesOffService.withdrawAcrossWorkspace(
      'ws_a',
      Date.now,
      noSleep
    )
    expect(r).toEqual({ checked: 1, dismissed: 1, stopped: null })
    expect(dismissReview).toHaveBeenCalledTimes(2)
    expect(listReviews).toHaveBeenCalledTimes(2)
  })

  it('the lazy path retries a 5xx listing too', async () => {
    listReviews
      .mockRejectedValueOnce(new GithubApiError(502, null))
      .mockResolvedValue([review(5520255111, 'CHANGES_REQUESTED')])
    expect(
      await requestChangesOffService.withdrawOnPullRequest(
        {
          id: 'pr24',
          workspaceId: 'ws_a',
          repo: 'Lumo-Workspace/lumo-agent-test',
          number: 24,
        },
        'sync',
        noSleep
      )
    ).toBe(1)
  })

  it('isTransientGithubFailure / describeGithubFailure', () => {
    expect(isTransientGithubFailure(octokitNetworkFailure())).toBe(true)
    expect(isTransientGithubFailure(new TypeError('fetch failed'))).toBe(true)
    expect(isTransientGithubFailure(new GithubApiError(503, null))).toBe(true)
    expect(isTransientGithubFailure(new GithubApiError(404, null))).toBe(false)
    expect(
      isTransientGithubFailure(new GithubApiError(429, null, new Date()))
    ).toBe(false)
    expect(isTransientGithubFailure(new Error('boom'))).toBe(false)
    expect(isTransientGithubFailure('x')).toBe(false)
    expect(describeGithubFailure(new GithubApiError(422, null))).toBe(
      'status=422 Error: GitHub API error 422'
    )
    expect(describeGithubFailure('')).toBe(
      'status=none non-error string: (empty)'
    )
  })
})
