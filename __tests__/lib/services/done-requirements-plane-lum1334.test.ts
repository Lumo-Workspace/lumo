/**
 * LUM-1334: the DONE gate's requirements plane end to end through
 * `readDoneVerdict` — the switches, the task's PRs, the latest runs, the
 * GitHub reviews and the plugin's review coverage, with the repositories
 * mocked.
 */
const mockReviewedPullRequests = jest.fn()
jest.mock('@/lib/plugins/registry', () => ({
  getPluginRegistry: () => ({
    doneGates: [
      {
        id: 'security',
        openBlockers: async () => [],
        reviewedPullRequests: (heads: unknown) =>
          mockReviewedPullRequests(heads),
      },
    ],
  }),
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findUndispositionedByTask: jest.fn(async () => []),
    isGateEnabledForWorkspace: jest.fn(async () => true),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listForTask: jest.fn(),
    runsPerCase: jest.fn(),
    listTaskPullRequests: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findDoneRequirements: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request-review.repository', () => ({
  pullRequestReviewRepository: { listByPullRequestIds: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn() } }))
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { readDoneVerdict } from '@/lib/services/done-verdict.service'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { pullRequestReviewRepository } from '@/lib/repositories/pull-request-review.repository'

const HEAD = 'a'.repeat(40)
const switches = workspaceRepository.findDoneRequirements as jest.Mock
const listPrs = testCaseRepository.listTaskPullRequests as jest.Mock
const listCases = testCaseRepository.listForTask as jest.Mock
const runsPerCase = testCaseRepository.runsPerCase as jest.Mock
const listReviews =
  pullRequestReviewRepository.listByPullRequestIds as jest.Mock

function passRun(over: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    result: 'PASS',
    environment: 'LOCAL',
    unprovenVerification: [],
    evidence: [{ type: 'link', url: 'https://x' }],
    stepResults: [{ phase: 'STEP', index: 0, text: 's', status: 'PASS' }],
    failureAttribution: null,
    disposition: null,
    pullRequestId: 'pr-1',
    commitSha: HEAD,
    commitDirty: false,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  listPrs.mockResolvedValue([
    {
      id: 'pr-1',
      number: 12,
      title: 't',
      url: 'u',
      state: 'open',
      headSha: HEAD,
      mergeCommitSha: null,
    },
  ])
  listCases.mockResolvedValue([
    {
      id: 'tc-1',
      number: 1,
      title: 'case',
      requiredEnvironment: null,
      steps: ['s'],
      verification: [],
    },
  ])
  runsPerCase.mockResolvedValue(new Map([['tc-1', [passRun()]]]))
  listReviews.mockResolvedValue([])
  mockReviewedPullRequests.mockResolvedValue([])
})

describe('requirements plane (LUM-1334)', () => {
  it('with both switches off reads nothing past the switches', async () => {
    switches.mockResolvedValue({ testCase: false, review: false })
    const v = await readDoneVerdict('t-1', 'w-1')
    expect(v.decision).toBe('CLEAR')
    expect(listPrs).not.toHaveBeenCalled()
    expect(listReviews).not.toHaveBeenCalled()
    expect(mockReviewedPullRequests).not.toHaveBeenCalled()
  })

  it('a passing run on the head meets the test-case requirement', async () => {
    switches.mockResolvedValue({ testCase: true, review: false })
    expect((await readDoneVerdict('t-1', 'w-1')).decision).toBe('CLEAR')
  })

  it('a failed or UNPROVEN-capped latest run does not', async () => {
    switches.mockResolvedValue({ testCase: true, review: false })
    runsPerCase.mockResolvedValue(
      new Map([['tc-1', [passRun({ result: 'FAIL' }), passRun()]]])
    )
    expect((await readDoneVerdict('t-1', 'w-1')).blockers).toEqual([
      {
        plane: 'DONE_REQUIREMENT',
        switches: { testCase: true, review: false },
        missing: [{ requirement: 'TEST_CASE', prNumber: 12 }],
      },
    ])
    runsPerCase.mockResolvedValue(
      new Map([['tc-1', [passRun({ evidence: [] })]]])
    )
    expect((await readDoneVerdict('t-1', 'w-1')).decision).toBe('BLOCKED')
  })

  it('the review requirement is met by the plugin or by a GitHub approval', async () => {
    switches.mockResolvedValue({ testCase: false, review: true })
    expect((await readDoneVerdict('t-1', 'w-1')).decision).toBe('BLOCKED')
    expect(mockReviewedPullRequests).toHaveBeenCalledWith([
      { pullRequestId: 'pr-1', headSha: HEAD },
    ])

    mockReviewedPullRequests.mockResolvedValue(['pr-1'])
    expect((await readDoneVerdict('t-1', 'w-1')).decision).toBe('CLEAR')

    mockReviewedPullRequests.mockResolvedValue([])
    listReviews.mockResolvedValue([
      {
        pullRequestId: 'pr-1',
        reviewerLogin: 'alice',
        state: 'APPROVED',
        commitSha: HEAD,
        submittedAt: new Date(),
      },
    ])
    expect((await readDoneVerdict('t-1', 'w-1')).decision).toBe('CLEAR')
  })

  it('a closed-unmerged PR is not required to have anything', async () => {
    switches.mockResolvedValue({ testCase: true, review: true })
    listPrs.mockResolvedValue([
      {
        id: 'pr-1',
        number: 12,
        title: 't',
        url: 'u',
        state: 'closed',
        headSha: HEAD,
        mergeCommitSha: null,
      },
    ])
    expect((await readDoneVerdict('t-1', 'w-1')).decision).toBe('CLEAR')
  })

  it('fails closed: a read that throws makes the gate throw', async () => {
    switches.mockResolvedValue({ testCase: false, review: true })
    mockReviewedPullRequests.mockRejectedValue(new Error('db down'))
    await expect(readDoneVerdict('t-1', 'w-1')).rejects.toThrow('db down')
  })
})
