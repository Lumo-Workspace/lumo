/**
 * @jest-environment node
 *
 * LUM-1133 — which workspace automatically reviews a PR that has no Lumo
 * task: the pure decision (CodeRabbit `reviews.auto_review` parity).
 */
import {
  DEFAULT_REPO_REVIEW_SETTING,
  decideTasklessAutoReview,
  type ConfirmingWorkspace,
  type RepoReviewSettingValues,
} from '@/ee/security/security-scan/auto-review-policy'

const at = (iso: string) => new Date(iso)
const ws = (
  workspaceId: string,
  confirmedAt: string,
  setting: Partial<RepoReviewSettingValues> = {}
): ConfirmingWorkspace => ({
  workspaceId,
  confirmedAt: at(confirmedAt),
  setting: { ...DEFAULT_REPO_REVIEW_SETTING, ...setting },
})

const base = {
  action: 'opened',
  state: 'open',
  isDraft: false,
  workspaceId: 'A',
  confirming: [ws('A', '2026-01-01')],
  linkedElsewhere: false,
}

describe('decideTasklessAutoReview', () => {
  it('defaults: review on, drafts skipped', () => {
    expect(DEFAULT_REPO_REVIEW_SETTING).toMatchObject({
      autoReview: true,
      reviewDrafts: false,
    })
  })

  it.each(['opened', 'reopened', 'synchronize', 'ready_for_review'])(
    'reviews an open non-draft PR on %s',
    action => {
      expect(decideTasklessAutoReview({ ...base, action })).toEqual({
        review: true,
      })
    }
  )

  it.each([
    ['edited', 'open'],
    ['converted_to_draft', 'open'],
    ['closed', 'closed'],
    ['synchronize', 'merged'],
  ])('does not review on %s (%s)', (action, state) => {
    expect(decideTasklessAutoReview({ ...base, action, state })).toEqual({
      review: false,
      reason: 'not_a_review_event',
    })
  })

  it('skips a draft by default, reviews it when the repo opts drafts in', () => {
    expect(
      decideTasklessAutoReview({
        ...base,
        action: 'synchronize',
        isDraft: true,
      })
    ).toEqual({ review: false, reason: 'draft' })
    expect(
      decideTasklessAutoReview({
        ...base,
        isDraft: true,
        confirming: [
          ws('A', '2026-01-01', { autoReview: true, reviewDrafts: true }),
        ],
      })
    ).toEqual({ review: true })
  })

  it('skips a repository the workspace turned off', () => {
    expect(
      decideTasklessAutoReview({
        ...base,
        confirming: [
          ws('A', '2026-01-01', { autoReview: false, reviewDrafts: true }),
        ],
      })
    ).toEqual({ review: false, reason: 'repo_off' })
  })

  it('never reviews a repository this workspace has not confirmed', () => {
    expect(
      decideTasklessAutoReview({
        ...base,
        confirming: [ws('B', '2026-01-01')],
      })
    ).toEqual({ review: false, reason: 'repo_not_confirmed' })
  })

  it('leaves the PR to the workspace whose task it is linked to', () => {
    expect(
      decideTasklessAutoReview({
        ...base,
        confirming: [ws('A', '2026-01-01'), ws('B', '2026-02-01')],
        linkedElsewhere: true,
      })
    ).toEqual({ review: false, reason: 'linked_elsewhere' })
  })

  describe('several workspaces confirmed the repository — exactly one reviews', () => {
    const both = [ws('B', '2026-02-01'), ws('A', '2026-01-01')]

    it('the earliest confirmation reviews, the other does not', () => {
      expect(
        decideTasklessAutoReview({
          ...base,
          workspaceId: 'A',
          confirming: both,
        })
      ).toEqual({ review: true })
      expect(
        decideTasklessAutoReview({
          ...base,
          workspaceId: 'B',
          confirming: both,
        })
      ).toEqual({ review: false, reason: 'other_workspace_reviews' })
    })

    it('a workspace that turned the repo off hands the review to the next one', () => {
      const aOff = [
        ws('A', '2026-01-01', { autoReview: false, reviewDrafts: false }),
        ws('B', '2026-02-01'),
      ]
      expect(
        decideTasklessAutoReview({
          ...base,
          workspaceId: 'B',
          confirming: aOff,
        })
      ).toEqual({ review: true })
    })

    it('for a draft, only workspaces reviewing drafts are candidates', () => {
      const bDrafts = [
        ws('A', '2026-01-01'),
        ws('B', '2026-02-01', { autoReview: true, reviewDrafts: true }),
      ]
      expect(
        decideTasklessAutoReview({
          ...base,
          isDraft: true,
          workspaceId: 'B',
          confirming: bDrafts,
        })
      ).toEqual({ review: true })
    })

    it('ties on the confirmation time break on the workspace id', () => {
      const tie = [ws('B', '2026-01-01'), ws('A', '2026-01-01')]
      expect(
        decideTasklessAutoReview({ ...base, workspaceId: 'A', confirming: tie })
      ).toEqual({ review: true })
      expect(
        decideTasklessAutoReview({ ...base, workspaceId: 'B', confirming: tie })
      ).toEqual({ review: false, reason: 'other_workspace_reviews' })
    })
  })
})
