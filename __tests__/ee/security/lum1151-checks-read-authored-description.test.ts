/**
 * @jest-environment node
 *
 * LUM-1151 — Lumo's own summary section (and the `@uselumo summary`
 * placeholder line) is not the author's description: the pre-merge checks'
 * model prompt — the description check and the LUM-1149 issue assessment —
 * and the linked-issue lookup read the author's text only.
 */
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDetails: jest.fn(),
  readPrTemplate: jest.fn().mockResolvedValue(null),
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/ee/security/llm/pre-merge-checks-client', () => ({
  runPreMergeChecksModel: jest.fn(),
}))
jest.mock('@/ee/security/repositories/repo-review-setting.repository', () => ({
  repoReviewSettingRepository: {
    findSettings: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    setPreMergeChecks: jest.fn(),
    findPreMergeChecks: jest.fn().mockResolvedValue(null),
    findLatestChecksTarget: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/repo-config.service', () => ({
  repoConfigService: { fileForDecision: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findById: jest.fn() },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { preMergeChecksService } from '@/ee/security/services/pre-merge-checks.service'
import { fetchPrDetails } from '@/lib/integrations/github/contents'
import { runPreMergeChecksModel } from '@/ee/security/llm/pre-merge-checks-client'
import {
  DESCRIPTION_SUMMARY_END,
  DESCRIPTION_SUMMARY_START,
} from '@/ee/security/security-scan/pr-description-summary'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const model = runPreMergeChecksModel as jest.Mock
const OLD_SLUG = process.env.GITHUB_APP_SLUG
const OLD_SWITCH = process.env.LUMO_PRE_MERGE_CHECKS

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  delete process.env.LUMO_PRE_MERGE_CHECKS
  model.mockImplementation(
    async (input: { checks: Array<{ id: string }> }) => ({
      results: input.checks.map(c => ({
        id: c.id,
        verdict: 'passed',
        explanation: 'ok',
        resolution: '',
      })),
    })
  )
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
  if (OLD_SWITCH === undefined) delete process.env.LUMO_PRE_MERGE_CHECKS
  else process.env.LUMO_PRE_MERGE_CHECKS = OLD_SWITCH
})

it("the model reads the author's description without Lumo's section", async () => {
  ;(fetchPrDetails as jest.Mock).mockResolvedValue({
    title: 'Retry webhooks',
    body: [
      'Author text.',
      '',
      DESCRIPTION_SUMMARY_START,
      '### Summary by Lumo',
      'LUMO-WRITTEN closes #77',
      DESCRIPTION_SUMMARY_END,
    ].join('\n'),
    authorLogin: 'bob',
    state: 'open',
    headSha: HEAD,
    baseRef: 'main',
    baseSha: 'b'.repeat(40),
    requestedReviewers: [],
  })
  await preMergeChecksService.run(
    {
      scanId: 's1',
      pullRequestId: 'pr1',
      workspaceId: 'w1',
      repo: 'acme/app',
      prNumber: 9,
      headSha: HEAD,
    },
    'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+x\n'
  )
  const input = model.mock.calls[0]![0]
  expect(input.body.text).toContain('Author text.')
  expect(input.body.text).not.toContain('LUMO-WRITTEN')
  expect(input.body.text).not.toContain('lumo:summary')
})
