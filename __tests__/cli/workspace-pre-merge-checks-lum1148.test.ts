/**
 * @jest-environment node
 *
 * LUM-1148: `lumo workspace security-scan --repo <owner/name>
 * [--title-check off|warning|error] [--title-requirements <text>]
 * [--description-check …] [--override-reviewers-only on|off]` — the
 * pre-merge checks of one repository. Switching a check off (or opening the
 * override to everyone) is confirmed first; the repository view lists them.
 */
import {
  buildRepoReviewUpdate,
  describeRepoReviewTurnOffs,
  formatPreMergeChecks,
  type RepoReviewSettingsView,
} from '@/cli/src/commands/workspace-repo-review'

const CHECKS = {
  title: { mode: 'error' as const, requirements: 'feat:/fix: prefix' },
  description: { mode: 'warning' as const },
  customChecks: [
    { name: 'Changelog', mode: 'warning' as const, instructions: 'x' },
  ],
  overrideRequestedReviewersOnly: true,
}
const VIEW: RepoReviewSettingsView = {
  canEdit: true,
  repositories: [
    {
      repo: 'acme/app',
      autoReview: true,
      reviewDrafts: false,
      preMergeChecks: CHECKS,
    },
  ],
}

describe('buildRepoReviewUpdate — pre-merge checks', () => {
  it('maps the check flags to a partial change', () => {
    expect(
      buildRepoReviewUpdate({
        repo: 'acme/app',
        titleCheck: 'Error',
        titleRequirements: '',
        descriptionCheck: 'off',
        overrideReviewersOnly: 'on',
      })
    ).toEqual({
      repo: 'acme/app',
      preMergeChecks: {
        title: { mode: 'error', requirements: null },
        description: { mode: 'off' },
        overrideRequestedReviewersOnly: true,
      },
    })
  })

  it('rejects a bad mode, and the flags without --repo', () => {
    expect(() =>
      buildRepoReviewUpdate({ repo: 'acme/app', titleCheck: 'block' })
    ).toThrow(/off, warning or error/)
    expect(() => buildRepoReviewUpdate({ titleCheck: 'error' })).toThrow(
      /need --repo/
    )
  })
})

it('switching a check off or opening the override is confirmed first', () => {
  expect(
    describeRepoReviewTurnOffs(VIEW, {
      repo: 'acme/app',
      preMergeChecks: {
        title: { mode: 'off' },
        overrideRequestedReviewersOnly: false,
      },
    })
  ).toEqual([
    'Will turn OFF the pre-merge title check for acme/app',
    expect.stringMatching(/override the pre-merge checks of acme\/app/),
  ])
  expect(
    describeRepoReviewTurnOffs(VIEW, {
      repo: 'acme/app',
      preMergeChecks: { description: { mode: 'error' } },
    })
  ).toEqual([])
})

it('lists the checks of a repository', () => {
  expect(formatPreMergeChecks(VIEW.repositories[0]!)).toEqual([
    '  pre-merge checks: title error · description warning',
    '  title requirements: feat:/fix: prefix',
    '  custom check: Changelog (warning)',
    '  override: requested reviewers only (never the author) — `@uselumo ignore pre-merge checks` on the PR',
  ])
  expect(
    formatPreMergeChecks({ repo: 'a/b', autoReview: true, reviewDrafts: false })
  ).toEqual([])
})
