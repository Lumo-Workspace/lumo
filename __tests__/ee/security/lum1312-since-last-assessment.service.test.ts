/**
 * @jest-environment node
 *
 * LUM-1312 — the "since the last assessment" section through the runner:
 * read from an earlier scan's stored checks of another head, the compare
 * diff path-filtered and masked, a previous head that is not an ancestor
 * (or an unreadable compare) judged from scratch, a failed read of the
 * earlier scans dropping only the section — and the previous outcome never
 * credited: the stored outcome is the model's answer for this head.
 */
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDetails: jest.fn(),
  readPrTemplate: jest.fn(),
  fetchPrDiff: jest.fn(),
  fetchCompareDiff: jest.fn(),
}))
jest.mock('@/ee/security/llm/pre-merge-checks-client', () => ({
  runPreMergeChecksModel: jest.fn(),
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: { findSettings: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    setPreMergeChecks: jest.fn(),
    findPreMergeChecks: jest.fn(),
    findLatestChecksTarget: jest.fn(),
    listRecentPreMergeChecks: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/repo-config.service', () => ({
  repoConfigService: { fileForDecision: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { preMergeChecksService } from '@/ee/security/services/pre-merge-checks.service'
import {
  fetchCompareDiff,
  fetchPrDetails,
  readPrTemplate,
} from '@/lib/integrations/github/contents'
import { runPreMergeChecksModel } from '@/ee/security/llm/pre-merge-checks-client'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import { logger } from '@/lib/logger'
import { DEFAULT_REPO_REVIEW_SETTING } from '@/ee/security/security-scan/auto-review-policy'
import {
  BUILTIN_PRE_MERGE_CHECKS,
  parsePreMergeChecksSetting,
  type BuiltinPreMergeCheck,
} from '@/ee/security/security-scan/pre-merge-checks'
import { ISSUE_ASSESSMENT_CHECK_ID } from '@/ee/security/security-scan/issue-assessment'

const OLD = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HEAD = '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const compare = fetchCompareDiff as jest.Mock
const recent = prSecurityScanRepository.listRecentPreMergeChecks as jest.Mock
const model = runPreMergeChecksModel as jest.Mock

const target = {
  scanId: 's2',
  pullRequestId: 'pr1',
  workspaceId: 'w1',
  repo: 'acme/app',
  prNumber: 9,
  headSha: HEAD,
}

const DIFF =
  'diff --git a/src/retry.ts b/src/retry.ts\n--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -0,0 +1 @@\n+export const BACKOFF_MS = 200\n'

/** The issue assessment with fixed requirements (no database reads). */
const builtins: BuiltinPreMergeCheck[] = BUILTIN_PRE_MERGE_CHECKS.map(b =>
  b.assessesRequirements
    ? {
        ...b,
        requirements: async () => ({
          requirements: [
            {
              id: 'task:done:1',
              source: 'task' as const,
              label: 'LUM-1 · Requirement 1 of 2',
              text: 'A backoff constant is exported.',
              quotable: true,
            },
            {
              id: 'task:done:2',
              source: 'task' as const,
              label: 'LUM-1 · Requirement 2 of 2',
              text: 'Retries stop after five attempts.',
              quotable: true,
            },
          ],
        }),
      }
    : b
)

const storedOld = {
  headSha: OLD,
  ranAt: '2026-10-24T10:00:00.000Z',
  results: [
    {
      id: ISSUE_ASSESSMENT_CHECK_ID,
      name: 'Issue assessment',
      kind: 'builtin',
      mode: 'warning',
      verdict: 'inconclusive',
      explanation: '',
      resolution: null,
      requirements: [
        {
          id: 'task:done:1',
          source: 'task',
          label: 'LUM-1 · Requirement 1 of 2',
          text: null,
          quotable: false,
          outcome: 'unclear',
          explanation: '',
        },
        {
          id: 'task:done:2',
          source: 'task',
          label: 'LUM-1 · Requirement 2 of 2',
          text: null,
          quotable: false,
          outcome: 'addressed',
          explanation: '',
        },
      ],
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_PRE_MERGE_CHECKS
  ;(fetchPrDetails as jest.Mock).mockResolvedValue({
    title: 'feat: bounded retries',
    body: 'Both requirements are done.',
    authorLogin: 'bob',
    state: 'open',
    headSha: HEAD,
    baseRef: 'main',
    baseSha: 'b'.repeat(40),
    requestedReviewers: [],
  })
  ;(readPrTemplate as jest.Mock).mockResolvedValue(null)
  ;(repoConfigService.fileForDecision as jest.Mock).mockResolvedValue(null)
  ;(repoReviewSettingRepository.findSettings as jest.Mock).mockResolvedValue([
    {
      workspaceId: 'w1',
      ...DEFAULT_REPO_REVIEW_SETTING,
      pathFilters: ['!**/*.lock'],
      preMergeChecks: {
        ...parsePreMergeChecksSetting(null),
        title: { mode: 'off', requirements: null },
        description: { mode: 'off' },
        issueAssessment: { mode: 'warning', taskDetailsOnPublicRepos: false },
      },
    },
  ])
  recent.mockResolvedValue([storedOld])
  compare.mockResolvedValue({
    ancestor: true,
    aheadBy: 1,
    files: 2,
    complete: true,
    diff: `${DIFF}diff --git a/yarn.lock b/yarn.lock\n--- a/yarn.lock\n+++ b/yarn.lock\n@@ -1 +1 @@\n+lock\n`,
  })
  // The model answers for this head: requirement 2 is no longer met.
  model.mockImplementation(async (i: { checks: Array<{ id: string }> }) => ({
    results: i.checks.map(c => ({
      id: c.id,
      verdict: 'failed',
      explanation: '',
      resolution: '',
      requirements: [
        {
          id: 'task:done:1',
          outcome: 'addressed',
          explanation: 'The new commit exports BACKOFF_MS.',
        },
        {
          id: 'task:done:2',
          outcome: 'not_addressed',
          explanation: 'The retry loop has no attempt limit.',
        },
      ],
    })),
  }))
})

function material(): string {
  return model.mock.calls[0]![0].checks[0].material
}

it('a re-assessment reads the previous head, compares from it, and the section reaches the model', async () => {
  const record = await preMergeChecksService.run(target, DIFF, builtins)
  expect(recent).toHaveBeenCalledWith('pr1', 's2', 10)
  expect(compare).toHaveBeenCalledWith({
    workspaceId: 'w1',
    fullName: 'acme/app',
    base: OLD,
    head: HEAD,
  })
  const m = material()
  expect(m).toContain(
    'Lumo assessed this pull request before on 1111111; this head is 1 commit ahead of it.'
  )
  expect(m).toContain(
    'Previous outcomes (on 1111111): task:done:1=unclear, task:done:2=addressed.'
  )
  expect(m).toContain('Changes since 1111111 (1 file):')
  expect(m).toContain('+export const BACKOFF_MS = 200')
  // Path filters apply to the compare diff too.
  expect(m).not.toContain('yarn.lock')
  // Never credited from the previous outcome: this head's answer stands.
  const r = record!.results.find(x => x.id === ISSUE_ASSESSMENT_CHECK_ID)!
  expect(r.requirements!.map(x => [x.id, x.outcome])).toEqual([
    ['task:done:1', 'addressed'],
    ['task:done:2', 'not_addressed'],
  ])
})

it('a previous head that is not an ancestor ⇒ judged from scratch, and said so', async () => {
  compare.mockResolvedValue({ ancestor: false, status: 'diverged' })
  await preMergeChecksService.run(target, DIFF, builtins)
  const m = material()
  expect(m).toContain('which is not an ancestor of this head')
  expect(m).toContain('Judge every requirement from scratch')
  expect(m).not.toContain('Previous outcomes')
  expect(logger.info).toHaveBeenCalledWith(
    expect.stringContaining('not an ancestor (diverged); judging from scratch')
  )
})

it('an unreadable compare ⇒ from scratch', async () => {
  compare.mockRejectedValue(new Error('GitHub API error 404'))
  await preMergeChecksService.run(target, DIFF, builtins)
  expect(material()).toContain('could not read what changed since then')
})

it('a secret in the compare diff is masked', async () => {
  compare.mockResolvedValue({
    ancestor: true,
    aheadBy: 1,
    files: 1,
    complete: true,
    diff: `diff --git a/src/k.ts b/src/k.ts\n+const k = "ghp_${'a'.repeat(36)}"\n`,
  })
  await preMergeChecksService.run(target, DIFF, builtins)
  expect(material()).not.toContain(`ghp_${'a'.repeat(36)}`)
})

it('only this head assessed before (an edit re-check) ⇒ no section, no compare', async () => {
  recent.mockResolvedValue([{ ...storedOld, headSha: HEAD }])
  await preMergeChecksService.run(target, DIFF, builtins)
  expect(compare).not.toHaveBeenCalled()
  expect(material()).not.toContain('Since the last assessment')
})

it('earlier scans unreadable ⇒ only the section is dropped; the check still runs', async () => {
  recent.mockRejectedValue(new Error('db down'))
  const record = await preMergeChecksService.run(target, DIFF, builtins)
  expect(material()).not.toContain('Since the last assessment')
  expect(record!.results[0]!.verdict).toBe('failed')
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining('earlier assessments unreadable')
  )
})
