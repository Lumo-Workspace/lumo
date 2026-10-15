/**
 * @jest-environment node
 *
 * LUM-1149 — the assessment's settings: the API schema, `.lumo.yaml`
 * (mode only — the privacy switch is never read from the file), the CLI
 * flags (switching the check off or opening task details to public
 * repositories is confirmed first) and the settings card's PATCH body.
 */
// The card's pure helpers are imported; its rendering is not exercised here.
jest.mock('react-intl', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}))

import {
  buildRepoReviewUpdate,
  describeRepoReviewTurnOffs,
  formatPreMergeChecks,
  type RepoReviewSettingView,
  type RepoReviewSettingsView,
} from '@/cli/src/commands/workspace-repo-review'
import { updateRepoReviewSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import {
  REPO_CONFIG_FIELDS,
  effectiveReviewConfig,
  parseRepoConfig,
  preMergeChecksOf,
  reviewSettingsWithFile,
} from '@/ee/security/security-scan/repo-config'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import {
  applyPreMergeChecksUpdate,
  parsePreMergeChecksSetting,
} from '@/ee/security/security-scan/pre-merge-checks'
import {
  draftOfChecks,
  preMergeChecksUpdate,
} from '@/ee/security/components/settings/RepoPreMergeChecksEditor'

const SETTING = parsePreMergeChecksSetting(null)

describe('setting', () => {
  it('default: warning; task details withheld on public repositories', () => {
    expect(SETTING.issueAssessment).toEqual({
      mode: 'warning',
      taskDetailsOnPublicRepos: false,
    })
    // Only an explicit true opens it.
    expect(
      parsePreMergeChecksSetting({
        issueAssessment: { mode: 'error', taskDetailsOnPublicRepos: 'yes' },
      }).issueAssessment
    ).toEqual({ mode: 'error', taskDetailsOnPublicRepos: false })
  })

  it('a partial update keeps what it does not name', () => {
    const to = applyPreMergeChecksUpdate(SETTING, {
      issueAssessment: { taskDetailsOnPublicRepos: true },
    })
    expect(to.issueAssessment).toEqual({
      mode: 'warning',
      taskDetailsOnPublicRepos: true,
    })
  })

  it('the API schema takes both keys and nothing else', () => {
    expect(
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        preMergeChecks: {
          issueAssessment: { mode: 'error', taskDetailsOnPublicRepos: true },
        },
      }).success
    ).toBe(true)
    expect(
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        preMergeChecks: { issueAssessment: { mode: 'loud' } },
      }).success
    ).toBe(false)
    expect(
      updateRepoReviewSettingsSchema.safeParse({
        repo: 'acme/app',
        preMergeChecks: { issueAssessment: { quote: true } },
      }).success
    ).toBe(false)
  })
})

describe('.lumo.yaml', () => {
  it('sets the mode on the base commit; the privacy switch stays Lumo-only', () => {
    const parsed = parseRepoConfig(
      'reviews:\n  pre_merge_checks:\n    issue_assessment:\n      mode: error\n'
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.unknownKeys).toEqual([])
    const stored = {
      ...DEFAULT_REPO_REVIEW_SETTING,
      preMergeChecks: {
        ...SETTING,
        issueAssessment: {
          mode: 'off' as const,
          taskDetailsOnPublicRepos: true,
        },
      },
    }
    const e = effectiveReviewConfig(
      { values: stored, stored: true },
      parsed.config
    )
    expect(e.preMergeIssueAssessmentMode).toMatchObject({
      value: 'error',
      source: 'file',
    })
    expect(REPO_CONFIG_FIELDS.preMergeIssueAssessmentMode.prBranch).toBe(
      'ignored'
    )
    // Without the stored value, the switch is off.
    expect(preMergeChecksOf(e).issueAssessment).toEqual({
      mode: 'error',
      taskDetailsOnPublicRepos: false,
    })
    expect(
      reviewSettingsWithFile(stored, parsed.config).preMergeChecks
        .issueAssessment
    ).toEqual({ mode: 'error', taskDetailsOnPublicRepos: true })
  })

  it('a file cannot open task details: an unknown key, never applied', () => {
    const parsed = parseRepoConfig(
      'reviews:\n  pre_merge_checks:\n    issue_assessment:\n      task_details_on_public_repos: true\n'
    )
    if (parsed.ok) {
      const e = effectiveReviewConfig(
        { values: DEFAULT_REPO_REVIEW_SETTING, stored: false },
        parsed.config
      )
      expect(preMergeChecksOf(e).issueAssessment.taskDetailsOnPublicRepos).toBe(
        false
      )
    } else {
      expect(parsed.ok).toBe(false)
    }
  })
})

const VIEW: RepoReviewSettingView = {
  repo: 'acme/app',
  autoReview: true,
  reviewDrafts: false,
  preMergeChecks: {
    title: { mode: 'warning', requirements: null },
    description: { mode: 'warning' },
    issueAssessment: { mode: 'warning', taskDetailsOnPublicRepos: false },
    customChecks: [],
    overrideRequestedReviewersOnly: false,
  },
}

const VIEWS: RepoReviewSettingsView = { canEdit: true, repositories: [VIEW] }

describe('CLI', () => {
  it('--issue-assessment / --task-details-on-public-repos map to a partial change', () => {
    expect(
      buildRepoReviewUpdate({
        repo: 'acme/app',
        issueAssessment: 'Error',
        taskDetailsOnPublicRepos: 'on',
      })?.preMergeChecks
    ).toEqual({
      issueAssessment: { mode: 'error', taskDetailsOnPublicRepos: true },
    })
    expect(() =>
      buildRepoReviewUpdate({ repo: 'acme/app', issueAssessment: 'block' })
    ).toThrow(/--issue-assessment takes off, warning or error/)
    expect(() => buildRepoReviewUpdate({ issueAssessment: 'error' })).toThrow(
      /need --repo/
    )
  })

  it('turning the check off, or quoting tasks on public repositories, is confirmed first', () => {
    const off = buildRepoReviewUpdate({
      repo: 'acme/app',
      issueAssessment: 'off',
    })!
    expect(describeRepoReviewTurnOffs(VIEWS, off)).toEqual([
      'Will turn OFF the pre-merge linked task / issue assessment for acme/app',
    ])
    const open = buildRepoReviewUpdate({
      repo: 'acme/app',
      taskDetailsOnPublicRepos: 'on',
    })!
    expect(describeRepoReviewTurnOffs(VIEWS, open)).toEqual([
      expect.stringMatching(/PUBLIC repository/),
    ])
    // Raising the mode or closing the switch needs no confirmation.
    expect(
      describeRepoReviewTurnOffs(
        VIEWS,
        buildRepoReviewUpdate({
          repo: 'acme/app',
          issueAssessment: 'error',
          taskDetailsOnPublicRepos: 'off',
        })!
      )
    ).toEqual([])
  })

  it('the repository view lists the assessment', () => {
    expect(formatPreMergeChecks(VIEW)[0]).toBe(
      '  pre-merge checks: title warning · description warning · issue assessment warning'
    )
    expect(
      formatPreMergeChecks({
        ...VIEW,
        preMergeChecks: {
          ...VIEW.preMergeChecks!,
          issueAssessment: { mode: 'error', taskDetailsOnPublicRepos: true },
        },
      })[0]
    ).toMatch(/issue assessment error \(task details shown on public repos\)/)
  })
})

describe('settings card', () => {
  it('saves only what changed in the assessment', () => {
    const draft = draftOfChecks(SETTING)
    expect(preMergeChecksUpdate('acme/app', SETTING, draft)).toBeNull()
    expect(
      preMergeChecksUpdate('acme/app', SETTING, {
        ...draft,
        issueMode: 'error',
        taskDetailsOnPublicRepos: true,
      })
    ).toEqual({
      repo: 'acme/app',
      preMergeChecks: {
        issueAssessment: { mode: 'error', taskDetailsOnPublicRepos: true },
      },
    })
  })
})
