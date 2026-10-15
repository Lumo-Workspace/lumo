/**
 * @jest-environment node
 *
 * LUM-1143 — CodeRabbit `reviews.auto_review` filters on the automatic review
 * of PRs without a task: each key, the precedence order, the enabled=false
 * opt-in path and the labeled / edited events that newly let a PR through.
 */
import {
  DEFAULT_REPO_REVIEW_SETTING,
  EMPTY_BASE_BRANCHES_MEANS,
  baseBranchRegExp,
  decideTasklessAutoReview,
  evaluateReviewFilters,
  isFilterChangeEvent,
  splitLabelFilters,
  type PrReviewFacts,
  type RepoReviewSettingValues,
  type TasklessReviewInput,
} from '@/ee/security/security-scan/auto-review-policy'

const setting = (
  over: Partial<RepoReviewSettingValues> = {}
): RepoReviewSettingValues => ({ ...DEFAULT_REPO_REVIEW_SETTING, ...over })

const PR: PrReviewFacts = {
  isDraft: false,
  baseBranch: 'main',
  defaultBranch: 'main',
  labels: [],
  title: 'Add search',
  body: 'Adds search.',
  authorLogin: 'alice',
}
const pr = (over: Partial<PrReviewFacts> = {}): PrReviewFacts => ({
  ...PR,
  ...over,
})

describe('evaluateReviewFilters — each key', () => {
  it('defaults review an ordinary PR', () => {
    expect(evaluateReviewFilters(setting(), pr())).toEqual({ review: true })
  })

  it('ignoreTitleKeywords: a title containing WIP (any case) is not auto-reviewed', () => {
    const s = setting({ ignoreTitleKeywords: ['WIP'] })
    expect(evaluateReviewFilters(s, pr({ title: '[wip] Add search' }))).toEqual(
      { review: false, reason: 'ignored_title' }
    )
    expect(evaluateReviewFilters(s, pr({ title: 'Add search' }))).toEqual({
      review: true,
    })
  })

  it('ignoreUsernames: exact and case-sensitive', () => {
    const s = setting({ ignoreUsernames: [' dependabot[bot] '] })
    expect(
      evaluateReviewFilters(s, pr({ authorLogin: 'dependabot[bot]' }))
    ).toEqual({ review: false, reason: 'ignored_author' })
    expect(
      evaluateReviewFilters(s, pr({ authorLogin: 'Dependabot[bot]' }))
    ).toEqual({ review: true })
  })

  it('labels: `!label` excludes; positive labels restrict when review is on', () => {
    expect(
      evaluateReviewFilters(
        setting({ labels: ['!wip'] }),
        pr({ labels: ['WIP'] })
      )
    ).toEqual({ review: false, reason: 'excluded_label' })
    const s = setting({ labels: ['bug', 'feature'] })
    expect(evaluateReviewFilters(s, pr({ labels: [] }))).toEqual({
      review: false,
      reason: 'label_missing',
    })
    expect(evaluateReviewFilters(s, pr({ labels: ['Feature'] }))).toEqual({
      review: true,
    })
  })

  it('base branches: the default branch is always in; others must fully match a regex', () => {
    const s = setting({ baseBranches: ['release/.*'] })
    expect(evaluateReviewFilters(s, pr())).toEqual({ review: true })
    expect(evaluateReviewFilters(s, pr({ baseBranch: 'release/1.2' }))).toEqual(
      { review: true }
    )
    expect(evaluateReviewFilters(s, pr({ baseBranch: 'develop' }))).toEqual({
      review: false,
      reason: 'base_branch',
    })
    // Anchored: `release` does not match `prerelease`.
    expect(
      evaluateReviewFilters(
        setting({ baseBranches: ['release'] }),
        pr({ baseBranch: 'prerelease' })
      )
    ).toEqual({ review: false, reason: 'base_branch' })
    expect(
      evaluateReviewFilters(
        setting({ baseBranches: ['.*'] }),
        pr({ baseBranch: 'anything' })
      )
    ).toEqual({ review: true })
  })

  it('base branches: an empty list follows EMPTY_BASE_BRANCHES_MEANS', () => {
    const verdict = evaluateReviewFilters(
      setting(),
      pr({ baseBranch: 'feature/x' })
    )
    expect(verdict).toEqual(
      EMPTY_BASE_BRANCHES_MEANS === 'all_branches'
        ? { review: true }
        : { review: false, reason: 'base_branch' }
    )
  })

  it('an unknown base / default branch never skips (fail-open)', () => {
    expect(
      evaluateReviewFilters(
        setting({ baseBranches: ['release/.*'] }),
        pr({ baseBranch: 'develop', defaultBranch: null })
      )
    ).toEqual({ review: true })
  })

  it('drafts: skipped unless opted in', () => {
    expect(evaluateReviewFilters(setting(), pr({ isDraft: true }))).toEqual({
      review: false,
      reason: 'draft',
    })
    expect(
      evaluateReviewFilters(
        setting({ reviewDrafts: true }),
        pr({ isDraft: true })
      )
    ).toEqual({ review: true })
  })
})

describe('enabled = false: only opt-ins are reviewed', () => {
  const off = setting({
    autoReview: false,
    labels: ['review-me', '!wip'],
    descriptionKeyword: '@lumo-review',
  })

  it('without an opt-in the PR is skipped', () => {
    expect(evaluateReviewFilters(off, pr())).toEqual({
      review: false,
      reason: 'repo_off',
    })
  })

  it('a positive label opts the PR in', () => {
    expect(evaluateReviewFilters(off, pr({ labels: ['review-me'] }))).toEqual({
      review: true,
    })
  })

  it('the description keyword opts the PR in (exact substring)', () => {
    expect(
      evaluateReviewFilters(off, pr({ body: 'Please @lumo-review this' }))
    ).toEqual({ review: true })
    expect(
      evaluateReviewFilters(off, pr({ body: 'Please @LUMO-REVIEW this' }))
    ).toEqual({ review: false, reason: 'repo_off' })
  })

  it('negative-only labels never opt a PR in', () => {
    expect(
      evaluateReviewFilters(
        setting({ autoReview: false, labels: ['!wip'] }),
        pr({ labels: ['bug'] })
      )
    ).toEqual({ review: false, reason: 'repo_off' })
  })

  it('an opted-in PR still has to pass the base branch and draft rules', () => {
    const s = { ...off, baseBranches: ['release/.*'] }
    expect(
      evaluateReviewFilters(
        s,
        pr({ labels: ['review-me'], baseBranch: 'develop' })
      )
    ).toEqual({ review: false, reason: 'base_branch' })
    expect(
      evaluateReviewFilters(s, pr({ labels: ['review-me'], isDraft: true }))
    ).toEqual({ review: false, reason: 'draft' })
  })
})

describe('precedence: usernames > title / negative labels > opt-in > base > drafts', () => {
  const s = setting({
    autoReview: false,
    labels: ['review-me', '!wip'],
    ignoreTitleKeywords: ['DO NOT REVIEW'],
    ignoreUsernames: ['bot'],
    baseBranches: ['release/.*'],
  })
  const everything = pr({
    authorLogin: 'bot',
    title: 'do not review',
    labels: ['wip', 'review-me'],
    baseBranch: 'develop',
    isDraft: true,
  })

  it('peels one rule at a time in order', () => {
    expect(evaluateReviewFilters(s, everything)).toMatchObject({
      reason: 'ignored_author',
    })
    const noAuthor = { ...everything, authorLogin: 'alice' }
    expect(evaluateReviewFilters(s, noAuthor)).toMatchObject({
      reason: 'ignored_title',
    })
    const noTitle = { ...noAuthor, title: 'Add search' }
    expect(evaluateReviewFilters(s, noTitle)).toMatchObject({
      reason: 'excluded_label',
    })
    const noWip = { ...noTitle, labels: [] }
    expect(evaluateReviewFilters(s, noWip)).toMatchObject({
      reason: 'repo_off',
    })
    const optedIn = { ...noWip, labels: ['review-me'] }
    expect(evaluateReviewFilters(s, optedIn)).toMatchObject({
      reason: 'base_branch',
    })
    const onRelease = { ...optedIn, baseBranch: 'release/2' }
    expect(evaluateReviewFilters(s, onRelease)).toMatchObject({
      reason: 'draft',
    })
    expect(evaluateReviewFilters(s, { ...onRelease, isDraft: false })).toEqual({
      review: true,
    })
  })

  it('an ignored author is skipped even with an opt-in label', () => {
    expect(
      evaluateReviewFilters(
        s,
        pr({ authorLogin: 'bot', labels: ['review-me'], baseBranch: 'main' })
      )
    ).toEqual({ review: false, reason: 'ignored_author' })
  })
})

describe('decideTasklessAutoReview with filters', () => {
  const at = new Date('2026-01-01')
  const input = (
    over: Partial<TasklessReviewInput> & {
      settingOver?: Partial<RepoReviewSettingValues>
    } = {}
  ): TasklessReviewInput => {
    const { settingOver, ...rest } = over
    const { isDraft: _d, ...facts } = PR
    return {
      action: 'opened',
      state: 'open',
      isDraft: false,
      pr: facts,
      workspaceId: 'A',
      confirming: [
        { workspaceId: 'A', confirmedAt: at, setting: setting(settingOver) },
      ],
      linkedElsewhere: false,
      ...rest,
    }
  }

  it('a WIP title is not auto-reviewed when the repository ignores WIP', () => {
    expect(
      decideTasklessAutoReview(
        input({
          settingOver: { ignoreTitleKeywords: ['WIP'] },
          pr: { ...input().pr!, title: 'WIP: search' },
        })
      )
    ).toEqual({ review: false, reason: 'ignored_title' })
  })

  it('labeled: reviews when the new label newly opts the PR in', () => {
    const off = { autoReview: false, labels: ['review-me'] }
    expect(
      decideTasklessAutoReview(
        input({
          action: 'labeled',
          settingOver: off,
          pr: { ...input().pr!, labels: ['review-me'] },
          before: { ...input().pr!, labels: [] },
        })
      )
    ).toEqual({ review: true })
  })

  it('labeled: a PR that already passed is not reviewed again', () => {
    expect(
      decideTasklessAutoReview(
        input({
          action: 'labeled',
          pr: { ...input().pr!, labels: ['docs'] },
          before: { ...input().pr!, labels: [] },
        })
      )
    ).toEqual({ review: false, reason: 'not_newly_matching' })
  })

  it('unlabeled: removing an excluding label lets the PR through', () => {
    expect(
      decideTasklessAutoReview(
        input({
          action: 'unlabeled',
          settingOver: { labels: ['!wip'] },
          pr: { ...input().pr!, labels: [] },
          before: { ...input().pr!, labels: ['wip'] },
        })
      )
    ).toEqual({ review: true })
  })

  it('edited: dropping WIP from the title reviews; an edit that still matches does not', () => {
    const settingOver = { ignoreTitleKeywords: ['WIP'] }
    expect(
      decideTasklessAutoReview(
        input({
          action: 'edited',
          settingOver,
          pr: { ...input().pr!, title: 'Search' },
          before: { ...input().pr!, title: 'WIP Search' },
        })
      )
    ).toEqual({ review: true })
    expect(
      decideTasklessAutoReview(
        input({
          action: 'edited',
          settingOver,
          pr: { ...input().pr!, title: 'WIP still' },
          before: { ...input().pr!, title: 'WIP Search' },
        })
      )
    ).toEqual({ review: false, reason: 'ignored_title' })
  })

  it('edited: adding the description keyword with review off opts in', () => {
    expect(
      decideTasklessAutoReview(
        input({
          action: 'edited',
          settingOver: { autoReview: false, descriptionKeyword: '/review' },
          pr: { ...input().pr!, body: 'please /review' },
          before: { ...input().pr!, body: 'please' },
        })
      )
    ).toEqual({ review: true })
  })

  it('a filter-change event without a previous state is not a review event', () => {
    expect(decideTasklessAutoReview(input({ action: 'labeled' }))).toEqual({
      review: false,
      reason: 'not_a_review_event',
    })
    expect(
      decideTasklessAutoReview(
        input({ action: 'labeled', state: 'closed', before: input().pr })
      )
    ).toEqual({ review: false, reason: 'not_a_review_event' })
  })

  it('with several workspaces, one whose filters skip the PR hands it on', () => {
    expect(
      decideTasklessAutoReview(
        input({
          workspaceId: 'B',
          pr: { ...input().pr!, title: 'WIP x' },
          confirming: [
            {
              workspaceId: 'A',
              confirmedAt: at,
              setting: setting({ ignoreTitleKeywords: ['wip'] }),
            },
            {
              workspaceId: 'B',
              confirmedAt: new Date('2026-02-01'),
              setting: setting(),
            },
          ],
        })
      )
    ).toEqual({ review: true })
  })
})

describe('helpers', () => {
  it('isFilterChangeEvent: labeled / unlabeled / edited on an open PR', () => {
    expect(isFilterChangeEvent('labeled', 'open')).toBe(true)
    expect(isFilterChangeEvent('unlabeled', 'open')).toBe(true)
    expect(isFilterChangeEvent('edited', 'open')).toBe(true)
    expect(isFilterChangeEvent('edited', 'merged')).toBe(false)
    expect(isFilterChangeEvent('opened', 'open')).toBe(false)
  })

  it('splitLabelFilters lower-cases and drops blanks', () => {
    expect(splitLabelFilters(['Bug', ' !WIP ', '', '!'])).toEqual({
      positive: ['bug'],
      negative: ['wip'],
    })
  })

  it('baseBranchRegExp anchors and refuses an invalid pattern', () => {
    expect(baseBranchRegExp('rel.*')!.test('release')).toBe(true)
    expect(baseBranchRegExp('rel')!.test('release')).toBe(false)
    expect(baseBranchRegExp('(')).toBeNull()
  })
})
