/**
 * LUM-1334: the opt-in DONE requirements, per pull request — a passing test
 * case on its head (or merge) commit, a review on its head.
 */
import {
  approvalCoversHead,
  countedPullRequests,
  missingDoneRequirements,
  runCoversPullRequest,
  type RequirementPullRequest,
  type StoredReview,
} from '@/lib/acceptance/done-requirements'

const HEAD = 'a'.repeat(40)
const MERGE = 'b'.repeat(40)
const OLD = 'c'.repeat(40)

function pr(
  over: Partial<RequirementPullRequest> = {}
): RequirementPullRequest {
  return {
    id: 'pr-1',
    number: 12,
    state: 'open',
    headSha: HEAD,
    mergeCommitSha: null,
    ...over,
  }
}

function review(over: Partial<StoredReview> = {}): StoredReview {
  return {
    pullRequestId: 'pr-1',
    reviewerLogin: 'alice',
    state: 'APPROVED',
    commitSha: HEAD,
    submittedAt: new Date('2026-10-28T10:00:00Z'),
    ...over,
  }
}

const BOTH = { testCase: true, review: true }

describe('countedPullRequests', () => {
  it('drops a PR closed without merging', () => {
    expect(
      countedPullRequests([
        pr({ id: 'a', state: 'open' }),
        pr({ id: 'b', state: 'closed' }),
        pr({ id: 'c', state: 'merged' }),
      ]).map(p => p.id)
    ).toEqual(['a', 'c'])
  })
})

describe('runCoversPullRequest', () => {
  it('accepts a clean run on the head, full or abbreviated sha', () => {
    expect(
      runCoversPullRequest(
        { pullRequestId: 'pr-1', commitSha: HEAD, commitDirty: false },
        pr()
      )
    ).toBe(true)
    expect(
      runCoversPullRequest(
        {
          pullRequestId: 'pr-1',
          commitSha: HEAD.slice(0, 7),
          commitDirty: null,
        },
        pr()
      )
    ).toBe(true)
  })

  it('accepts the merge commit, so a squash merge does not turn runs stale', () => {
    const merged = pr({ state: 'merged', mergeCommitSha: MERGE })
    for (const sha of [HEAD, MERGE])
      expect(
        runCoversPullRequest(
          { pullRequestId: 'pr-1', commitSha: sha, commitDirty: false },
          merged
        )
      ).toBe(true)
  })

  it('accepts a run with no PR bound when it names the head commit', () => {
    expect(
      runCoversPullRequest(
        { pullRequestId: null, commitSha: HEAD, commitDirty: false },
        pr()
      )
    ).toBe(true)
  })

  it('refuses an older commit, a dirty tree, no sha, or another PR', () => {
    const base = { pullRequestId: 'pr-1', commitSha: HEAD, commitDirty: false }
    expect(runCoversPullRequest({ ...base, commitSha: OLD }, pr())).toBe(false)
    expect(runCoversPullRequest({ ...base, commitDirty: true }, pr())).toBe(
      false
    )
    expect(runCoversPullRequest({ ...base, commitSha: null }, pr())).toBe(false)
    expect(runCoversPullRequest({ ...base, pullRequestId: 'pr-2' }, pr())).toBe(
      false
    )
  })

  it('refuses everything when the PR head is unknown', () => {
    expect(
      runCoversPullRequest(
        { pullRequestId: 'pr-1', commitSha: HEAD, commitDirty: false },
        pr({ headSha: null })
      )
    ).toBe(false)
  })
})

describe('approvalCoversHead', () => {
  it('an approval on the head covers it', () => {
    expect(approvalCoversHead([review()], pr())).toBe(true)
  })

  it('an approval on an older commit does not', () => {
    expect(approvalCoversHead([review({ commitSha: OLD })], pr())).toBe(false)
  })

  it("the reviewer's later change request withdraws it", () => {
    expect(
      approvalCoversHead(
        [
          review(),
          review({
            state: 'CHANGES_REQUESTED',
            submittedAt: new Date('2026-10-28T11:00:00Z'),
          }),
        ],
        pr()
      )
    ).toBe(false)
  })

  it('a dismissed approval does not count', () => {
    expect(approvalCoversHead([review({ state: 'DISMISSED' })], pr())).toBe(
      false
    )
  })

  it("dismissing a later review leaves the reviewer's earlier approval standing", () => {
    expect(
      approvalCoversHead(
        [
          review(),
          review({
            state: 'DISMISSED',
            submittedAt: new Date('2026-10-28T11:00:00Z'),
          }),
        ],
        pr()
      )
    ).toBe(true)
  })

  it("another reviewer's change request does not withdraw an approval", () => {
    expect(
      approvalCoversHead(
        [
          review(),
          review({
            reviewerLogin: 'bob',
            state: 'CHANGES_REQUESTED',
            submittedAt: new Date('2026-10-28T11:00:00Z'),
          }),
        ],
        pr()
      )
    ).toBe(true)
  })

  it('ignores reviews of another PR and a PR with no head', () => {
    expect(approvalCoversHead([review({ pullRequestId: 'pr-2' })], pr())).toBe(
      false
    )
    expect(approvalCoversHead([review()], pr({ headSha: null }))).toBe(false)
  })
})

describe('missingDoneRequirements', () => {
  const none = {
    passingRuns: [],
    reviews: [],
    pluginReviewed: new Set<string>(),
  }

  it('is empty with both switches off, whatever the PRs lack', () => {
    expect(
      missingDoneRequirements({
        switches: { testCase: false, review: false },
        pullRequests: [pr()],
        ...none,
      })
    ).toEqual([])
  })

  it('is empty when the task has no counted PR', () => {
    expect(
      missingDoneRequirements({
        switches: BOTH,
        pullRequests: [pr({ state: 'closed' })],
        ...none,
      })
    ).toEqual([])
  })

  it('lists each PR and what it lacks, test case before review', () => {
    expect(
      missingDoneRequirements({
        switches: BOTH,
        pullRequests: [pr(), pr({ id: 'pr-2', number: 13 })],
        passingRuns: [
          { pullRequestId: 'pr-2', commitSha: HEAD, commitDirty: false },
        ],
        reviews: [],
        pluginReviewed: new Set(),
      })
    ).toEqual([
      { requirement: 'TEST_CASE', prNumber: 12 },
      { requirement: 'REVIEW', prNumber: 12 },
      { requirement: 'REVIEW', prNumber: 13 },
    ])
  })

  it('checks only the switches that are on', () => {
    expect(
      missingDoneRequirements({
        switches: { testCase: false, review: true },
        pullRequests: [pr()],
        ...none,
      })
    ).toEqual([{ requirement: 'REVIEW', prNumber: 12 }])
  })

  it('a plugin review or a GitHub approval each satisfies the review requirement', () => {
    const base = {
      switches: { testCase: false, review: true },
      pullRequests: [pr()],
      passingRuns: [],
    }
    expect(
      missingDoneRequirements({
        ...base,
        reviews: [],
        pluginReviewed: new Set(['pr-1']),
      })
    ).toEqual([])
    expect(
      missingDoneRequirements({
        ...base,
        reviews: [review()],
        pluginReviewed: new Set(),
      })
    ).toEqual([])
  })

  it('a plugin review never covers a PR whose head is unknown', () => {
    expect(
      missingDoneRequirements({
        switches: { testCase: false, review: true },
        pullRequests: [pr({ headSha: null })],
        passingRuns: [],
        reviews: [],
        pluginReviewed: new Set(['pr-1']),
      })
    ).toEqual([{ requirement: 'REVIEW', prNumber: 12 }])
  })
})
