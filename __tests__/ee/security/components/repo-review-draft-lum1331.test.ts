/**
 * LUM-1331 — the repository settings sheet's pure draft logic: branch scope
 * and label round-trips, one PATCH body for every section that changed
 * (ported from the fold-out editors of LUM-1143 / 1147 / 1148 / 1151 /
 * 1155), and the list's one-line summary.
 */
import {
  baseBranchesFor,
  branchScopeOf,
  branchScopesFor,
  changedCount,
  draftOfChecks,
  draftOfRepo,
  draftProblems,
  filtersUpdate,
  invalidRegExp,
  joinLabels,
  preMergeChecksUpdate,
  repoReviewSummary,
  repoReviewUpdate,
  splitLabels,
  styleUpdate,
} from '@/ee/security/components/settings/repo-review-draft'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import { parsePreMergeChecksSetting } from '@/ee/security/security-scan/pre-merge-checks'
import type { RepoReviewSettingView } from '@/ee/security/services/repo-review-settings.service'

const REPO: RepoReviewSettingView = {
  repo: 'acme/app',
  ...DEFAULT_REPO_REVIEW_SETTING,
  emptyBaseBranchesMeans: 'default_branch_only',
}

describe('branch scope', () => {
  it('reads an empty list by what empty means for the repository', () => {
    expect(branchScopeOf([], 'default_branch_only')).toBe('default')
    expect(branchScopeOf([], 'all_branches')).toBe('any')
    expect(branchScopeOf(['.*'], 'default_branch_only')).toBe('any')
    expect(branchScopeOf(['release/.*'], 'all_branches')).toBe('patterns')
    expect(branchScopeOf(['.*', 'x'], 'default_branch_only')).toBe('patterns')
  })

  it('writes the list each scope means, and round-trips', () => {
    expect(baseBranchesFor('default', ['x'], 'default_branch_only')).toEqual([])
    expect(baseBranchesFor('any', [], 'default_branch_only')).toEqual(['.*'])
    expect(baseBranchesFor('any', [], 'all_branches')).toEqual([])
    expect(baseBranchesFor('patterns', ['a', 'b'], 'all_branches')).toEqual([
      'a',
      'b',
    ])
    for (const means of ['default_branch_only', 'all_branches'] as const)
      for (const scope of branchScopesFor(means))
        expect(
          branchScopeOf(baseBranchesFor(scope, ['release/.*'], means), means)
        ).toBe(scope)
  })

  it('an "empty means all branches" repository has no "default only"', () => {
    expect(branchScopesFor('all_branches')).toEqual(['any', 'patterns'])
    expect(branchScopesFor('default_branch_only')).toEqual([
      'default',
      'any',
      'patterns',
    ])
  })

  it('flags patterns that do not compile', () => {
    expect(invalidRegExp('release/.*')).toBe(false)
    expect(invalidRegExp('release/(')).toBe(true)
  })

  it('patterns with no pattern cannot be saved', () => {
    const draft = draftOfRepo(REPO)
    expect(draftProblems(draft)).toEqual([])
    expect(
      draftProblems({
        ...draft,
        filters: { ...draft.filters, branchScope: 'patterns' },
      })
    ).toEqual(['branchPatternsEmpty'])
  })
})

describe('untouched branch scope', () => {
  it('a stored ".*" under all-branches is not a change on open', () => {
    const setting = {
      ...REPO,
      baseBranches: ['.*'],
      emptyBaseBranchesMeans: 'all_branches' as const,
    }
    expect(repoReviewUpdate(setting, draftOfRepo(setting))).toBeNull()
  })
})

describe('incomplete rows', () => {
  it('a row with one half filled blocks the save; an empty one does not', () => {
    const draft = draftOfRepo(REPO)
    const withRow = (path: string, instructions: string) => ({
      ...draft,
      style: { ...draft.style, pathInstructions: [{ path, instructions }] },
    })
    expect(draftProblems(withRow('', ''))).toEqual([])
    expect(draftProblems(withRow('scripts/**', ''))).toEqual(['incompleteRows'])
    expect(
      draftProblems({
        ...draft,
        checks: {
          ...draft.checks,
          customChecks: [{ name: '', mode: 'error', instructions: 'x' }],
        },
      })
    ).toEqual(['incompleteRows'])
  })
})

describe('labels', () => {
  it('splits `!label` into skip and joins back', () => {
    expect(splitLabels(['bug', '!wip', 'ready'])).toEqual({
      only: ['bug', 'ready'],
      skip: ['wip'],
    })
    expect(joinLabels(['bug'], ['wip'])).toEqual(['bug', '!wip'])
  })

  it('reordering by the split is not a change; a new skip label is', () => {
    const setting = { ...REPO, labels: ['!wip', 'bug'] }
    const draft = draftOfRepo(setting).filters
    expect(filtersUpdate(setting, draft)).toEqual({})
    expect(
      filtersUpdate(setting, { ...draft, skipLabels: ['wip', 'chore'] })
    ).toEqual({ labels: ['bug', '!wip', '!chore'] })
  })
})

describe('filtersUpdate', () => {
  it('an emptied keyword clears; unchanged is empty', () => {
    const setting = { ...REPO, descriptionKeyword: 'lumo-review' }
    const draft = draftOfRepo(setting).filters
    expect(filtersUpdate(setting, draft)).toEqual({})
    expect(
      filtersUpdate(setting, { ...draft, descriptionKeyword: '  ' })
    ).toEqual({ descriptionKeyword: null })
  })

  it('sends the base branches the chosen scope stores', () => {
    const draft = draftOfRepo(REPO).filters
    expect(
      filtersUpdate(REPO, {
        ...draft,
        branchScope: 'patterns',
        branchPatterns: ['release/.*'],
      })
    ).toEqual({ baseBranches: ['release/.*'] })
    expect(filtersUpdate(REPO, { ...draft, branchScope: 'any' })).toEqual({
      baseBranches: ['.*'],
    })
  })
})

describe('preMergeChecksUpdate', () => {
  it('blank custom rows are dropped, "" clears the requirements', () => {
    const s = {
      ...parsePreMergeChecksSetting(null),
      title: { mode: 'warning' as const, requirements: 'prefix' },
    }
    const d = draftOfChecks(s)
    expect(preMergeChecksUpdate('a/b', s, d)).toBeNull()
    expect(
      preMergeChecksUpdate('a/b', s, {
        ...d,
        titleRequirements: ' ',
        customChecks: [{ name: '', mode: 'error', instructions: 'x' }],
        overrideRequestedReviewersOnly: true,
      })
    ).toEqual({
      repo: 'a/b',
      preMergeChecks: {
        title: { requirements: null },
        overrideRequestedReviewersOnly: true,
      },
    })
  })
})

describe('styleUpdate', () => {
  const setting = {
    ...REPO,
    pathInstructions: [{ path: 'lib/**', instructions: 'Check limits.' }],
  }
  const draft = draftOfRepo(setting).style

  it('unchanged is null; profile change and cleared rows are sent', () => {
    expect(styleUpdate(setting, draft)).toBeNull()
    expect(
      styleUpdate(setting, {
        ...draft,
        reviewProfile: 'quiet',
        pathInstructions: [{ path: '', instructions: '' }],
      })
    ).toEqual({
      repo: 'acme/app',
      reviewProfile: 'quiet',
      pathInstructions: [],
    })
  })

  it('sends only a changed summary mode or diagram switch', () => {
    expect(styleUpdate(setting, { ...draft, highLevelSummary: 'off' })).toEqual(
      { repo: 'acme/app', highLevelSummary: 'off' }
    )
    expect(
      styleUpdate(setting, {
        ...draft,
        sequenceDiagrams: !setting.sequenceDiagrams,
      })
    ).toEqual({ repo: 'acme/app', sequenceDiagrams: !setting.sequenceDiagrams })
  })
})

describe('repoReviewUpdate', () => {
  it('is null until something changes', () => {
    expect(repoReviewUpdate(REPO, draftOfRepo(REPO))).toBeNull()
    expect(changedCount(null)).toBe(0)
  })

  it('merges every changed section into one PATCH body', () => {
    const draft = draftOfRepo(REPO)
    const update = repoReviewUpdate(REPO, {
      filters: { ...draft.filters, ignoreUsernames: ['dependabot[bot]'] },
      checks: { ...draft.checks, titleMode: 'error', descriptionMode: 'off' },
      style: { ...draft.style, reviewProfile: 'assertive' },
    })
    expect(update).toEqual({
      repo: 'acme/app',
      ignoreUsernames: ['dependabot[bot]'],
      preMergeChecks: {
        title: { mode: 'error' },
        description: { mode: 'off' },
      },
      reviewProfile: 'assertive',
    })
    // Each check and each field counts once.
    expect(changedCount(update)).toBe(4)
  })
})

describe('repoReviewSummary', () => {
  it('a repository on the defaults reads "default"', () => {
    expect(repoReviewSummary(REPO)).toEqual([{ id: 'default' }])
  })

  it('lists what sets the repository apart, in order', () => {
    const checks = parsePreMergeChecksSetting(null)
    expect(
      repoReviewSummary({
        ...REPO,
        baseBranches: ['release/.*', 'hotfix/.*'],
        labels: ['!wip', 'ready'],
        ignoreUsernames: ['renovate[bot]'],
        descriptionKeyword: 'lumo-review',
        pathFilters: ['!**/*.snap'],
        preMergeChecks: {
          ...checks,
          title: { mode: 'error', requirements: null },
          description: { mode: 'off' },
        },
        reviewProfile: 'assertive',
        pathInstructions: [{ path: 'a/**', instructions: 'x' }],
      })
    ).toEqual([
      { id: 'branchPatterns', values: { count: 2 } },
      { id: 'skipRules', values: { count: 2 } },
      { id: 'onlyRules', values: { count: 2 } },
      { id: 'pathFilters', values: { count: 1 } },
      { id: 'checks', values: { count: 2, blocking: 1 } },
      { id: 'profile.assertive' },
      { id: 'pathInstructions', values: { count: 1 } },
    ])
  })

  it('"any branch" shows for a stored ".*" and for empty-means-all', () => {
    expect(repoReviewSummary({ ...REPO, baseBranches: ['.*'] })).toEqual([
      { id: 'anyBranch' },
    ])
    expect(
      repoReviewSummary({ ...REPO, emptyBaseBranchesMeans: 'all_branches' })
    ).toEqual([{ id: 'anyBranch' }])
  })
})
