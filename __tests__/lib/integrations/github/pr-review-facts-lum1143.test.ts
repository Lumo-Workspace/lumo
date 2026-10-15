/**
 * @jest-environment node
 *
 * LUM-1143 — the auto-review filter facts off a pull_request payload, and
 * the same facts before a labeled / unlabeled / edited event.
 */
import {
  pullRequestReviewFacts,
  pullRequestReviewFactsBefore,
  type PullRequestFactsPayload,
} from '@/lib/integrations/github/pr-review-facts'

const payload = (
  over: Partial<PullRequestFactsPayload> = {}
): PullRequestFactsPayload => ({
  action: 'opened',
  pull_request: {
    title: 'Search',
    body: 'Adds search',
    user: { login: 'alice' },
    base: { ref: 'develop' },
    labels: [{ name: 'bug' }, { name: 'review-me' }],
  },
  repository: { default_branch: 'main' },
  ...over,
})

describe('pullRequestReviewFacts', () => {
  it('reads base, default branch, labels, title, body and author', () => {
    expect(pullRequestReviewFacts(payload())).toEqual({
      baseBranch: 'develop',
      defaultBranch: 'main',
      labels: ['bug', 'review-me'],
      title: 'Search',
      body: 'Adds search',
      authorLogin: 'alice',
    })
  })

  it('a stripped payload gives nulls / [] (never a fabricated value)', () => {
    expect(
      pullRequestReviewFacts({
        action: 'opened',
        pull_request: { body: null, labels: null },
        repository: {},
      })
    ).toEqual({
      baseBranch: null,
      defaultBranch: null,
      labels: [],
      title: null,
      body: null,
      authorLogin: null,
    })
  })
})

describe('pullRequestReviewFactsBefore', () => {
  it('labeled: the label was not there before', () => {
    const p = payload({ action: 'labeled', label: { name: 'review-me' } })
    expect(
      pullRequestReviewFactsBefore(p, pullRequestReviewFacts(p))?.labels
    ).toEqual(['bug'])
  })

  it('unlabeled: the label was there before', () => {
    const p = payload({ action: 'unlabeled', label: { name: 'wip' } })
    expect(
      pullRequestReviewFactsBefore(p, pullRequestReviewFacts(p))?.labels
    ).toEqual(['bug', 'review-me', 'wip'])
  })

  it('edited: the previous title / body / base from `changes`', () => {
    const p = payload({
      action: 'edited',
      changes: {
        title: { from: 'WIP Search' },
        body: { from: null },
        base: { ref: { from: 'main' } },
      },
    })
    expect(pullRequestReviewFactsBefore(p, pullRequestReviewFacts(p))).toEqual(
      expect.objectContaining({
        title: 'WIP Search',
        body: null,
        baseBranch: 'main',
      })
    )
  })

  it('nothing a filter reads changed → undefined', () => {
    const after = pullRequestReviewFacts(payload())
    expect(pullRequestReviewFactsBefore(payload(), after)).toBeUndefined()
    expect(
      pullRequestReviewFactsBefore(
        payload({ action: 'edited', changes: {} }),
        after
      )
    ).toBeUndefined()
    expect(
      pullRequestReviewFactsBefore(payload({ action: 'edited' }), after)
    ).toBeUndefined()
  })
})
