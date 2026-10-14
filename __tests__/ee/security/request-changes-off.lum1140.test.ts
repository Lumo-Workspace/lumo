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
  requestChangesOffService,
} from '@/ee/security/services/request-changes-off.service'
import {
  WITHDRAW_MESSAGE,
  isRateLimited,
  prReviewVerdictService,
} from '@/ee/security/services/pr-review-verdict.service'
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
        where: { workspaceId: 'ws_a', state: 'open' },
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
      where: { workspaceId: 'ws_a', state: 'open' },
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
