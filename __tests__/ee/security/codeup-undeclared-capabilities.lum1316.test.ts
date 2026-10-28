/**
 * @jest-environment node
 *
 * LUM-1316 — the write-backs whose capability the Codeup adapter does not
 * declare are skipped by the scan services themselves (the capabilities
 * LUM-1318 declared but nothing enforced yet): review verdict and its
 * withdrawal, the unmet-requirements review, the PR description summary and
 * repository issues. Each case calls nothing on Codeup; the GitHub control
 * shows the same input still goes through on a platform that has it.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      listReviews: jest.fn(),
      createReview: jest.fn(),
      getPullRequestBody: jest.fn(),
      updatePullRequestBody: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchRepoIssues: jest.fn().mockResolvedValue([]),
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn() },
}))
jest.mock('@/ee/security/services/repo-absence-search.service', () => ({
  repoAbsenceSearchService: { search: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { prReviewVerdictService } from '@/ee/security/services/pr-review-verdict.service'
import { issueAssessmentReviewService } from '@/ee/security/services/issue-assessment-review.service'
import { prDescriptionSummaryService } from '@/ee/security/services/pr-description-summary.service'
import { linkedRequirementsService } from '@/ee/security/services/linked-requirements.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { fetchRepoIssues } from '@/lib/integrations/github/contents'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { ISSUE_ASSESSMENT_CHECK_ID } from '@/ee/security/security-scan/issue-assessment'
import type { PreMergeChecksRecord } from '@/ee/security/security-scan/pre-merge-checks'
import type { PreMergeCheckGatherInput } from '@/ee/security/security-scan/pre-merge-checks'

const realFetch = global.fetch
const fetchSpy = jest.fn()
beforeAll(() => {
  global.fetch = fetchSpy as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = realFetch
})
beforeEach(() => {
  jest.clearAllMocks()
  ;(prCommentClient.listReviews as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.createReview as jest.Mock).mockResolvedValue({ id: 1 })
  ;(prCommentClient.getPullRequestBody as jest.Mock).mockResolvedValue({
    body: 'Authored.',
    state: 'open',
  })
})

const HEAD = 'a'.repeat(40)
const base = {
  repo: { owner: 'org/group', name: 'demo' },
  prNumber: 1,
  token: 'tok',
  headSha: HEAD,
}
const codeup = { provider: 'codeup' as const }
const github = { provider: 'github' as const }

const record: PreMergeChecksRecord = {
  headSha: HEAD,
  ranAt: '2026-10-27T00:00:00Z',
  results: [
    {
      id: ISSUE_ASSESSMENT_CHECK_ID,
      name: 'Linked task',
      kind: 'builtin',
      mode: 'warning',
      verdict: 'failed',
      explanation: '',
      resolution: null,
      requirements: [
        {
          id: 'task:LUM-12:1',
          source: 'task',
          label: 'LUM-12 · Requirement 1 of 1',
          text: 'Log the user in',
          quotable: true,
          outcome: 'not_addressed',
          explanation: 'No login code.',
        },
      ],
    },
  ],
}

describe('LUM-1316 undeclared capabilities are skipped, not attempted', () => {
  it('review verdict: none on Codeup; withdrawing finds nothing to withdraw', async () => {
    await expect(
      prReviewVerdictService.apply({
        ...codeup,
        ...base,
        scan: {
          status: 'FINDINGS',
          partial: false,
          stages: null,
          partialCauses: [],
        },
        openThreads: 2,
        blocking: 1,
        unpostedActionable: 0,
      })
    ).resolves.toBe('none')
    await expect(
      prReviewVerdictService.withdrawChangeRequests({ ...codeup, ...base })
    ).resolves.toBe(0)
    expect(prCommentClient.listReviews).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('unmet-requirements review: kept in the summary on Codeup; posted on GitHub', async () => {
    await expect(
      issueAssessmentReviewService.flagUnmet({ ...codeup, ...base, record })
    ).resolves.toBe('nothing')
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(
      issueAssessmentReviewService.flagUnmet({ ...github, ...base, record })
    ).resolves.toBe('posted')
  })

  it('description summary: not written on Codeup (the comment keeps it); written on GitHub', async () => {
    const input = {
      ...base,
      prSummary: { intent: 'Adds login.', changes: ['Login form'] },
    }
    await expect(
      prDescriptionSummaryService.sync({ ...codeup, ...input })
    ).resolves.toBe('failed')
    expect(fetchSpy).not.toHaveBeenCalled()
    await expect(
      prDescriptionSummaryService.sync({ ...github, ...input })
    ).resolves.toBe('written')
    expect(prCommentClient.updatePullRequestBody).toHaveBeenCalledTimes(1)
  })

  it('repository issues: `Fixes #12` reads no issue on Codeup; does on GitHub', async () => {
    const gather = (provider: string) => {
      ;(pullRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: 'pr1',
        taskId: null,
        provider,
      })
      return linkedRequirementsService.gather({
        workspaceId: 'w1',
        repo: 'org/demo',
        prNumber: 1,
        pullRequestId: 'pr1',
        baseSha: null,
        headSha: HEAD,
        pr: { title: 'Add login', body: 'Fixes #12' },
        setting: {},
      } as unknown as PreMergeCheckGatherInput)
    }
    await expect(gather('codeup')).resolves.toMatchObject({ requirements: [] })
    expect(fetchRepoIssues).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    await gather('github')
    expect(fetchRepoIssues).toHaveBeenCalledWith(
      expect.objectContaining({ numbers: [12] })
    )
  })
})
