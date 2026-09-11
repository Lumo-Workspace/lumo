/**
 * @jest-environment node
 *
 * LUM-740 — PR write-back denoising (spec §6 L5 items 3 + 6): no inline
 * comment for LOW findings or LLM-suggested false positives (the summary
 * carries one line each instead), an honest "why" when only `partial` makes
 * the scan incomplete, and the summary upserted by the id stored on the scan
 * row rather than by re-listing the PR's comments.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    findSummaryCommentIdByPullRequest: jest.fn(),
    setSummaryCommentId: jest.fn(),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  securityPrReviewService,
  buildSummary,
} from '@/lib/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import type { ReviewFindingRow } from '@/lib/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const findSummaryId =
  prSecurityScanRepository.findSummaryCommentIdByPullRequest as jest.Mock
const setSummaryId = prSecurityScanRepository.setSummaryCommentId as jest.Mock
const token = getGithubInstallationToken as jest.Mock
const listIssue = prCommentClient.listIssueComments as jest.Mock
const listReview = prCommentClient.listReviewComments as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const updateIssue = prCommentClient.updateIssueComment as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock

function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'VULNERABILITY',
    ruleId: 'ext:semgrep:cmd-injection',
    severity: 'MEDIUM',
    provenance: 'EXTERNAL_TOOL',
    filePath: 'lib/run.ts',
    line: 12,
    title: 'Command injection',
    detail: 'User input reaches exec.',
    fingerprint: 'fp1',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    ...over,
  }
}

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    summaryCommentId: null,
    suggestedAt: new Date('2026-09-11T00:00:00Z'),
    findings: [],
    pullRequest: {
      id: 'pr1',
      repo: 'acme/app',
      number: 945,
      workspaceId: 'w1',
      task: { number: 740, team: { identifier: 'LUM' } },
      workspace: { slug: 'acme', securityPolicy: null },
    },
    ...over,
  }
}

const inlinePaths = () =>
  createReview.mock.calls.flatMap(c =>
    (c[0].comments as { path: string }[]).map(x => x.path)
  )
const summaryBody = () =>
  String(
    (updateIssue.mock.calls[0]?.[0] ?? createIssue.mock.calls[0]?.[0])?.body ??
      ''
  )

beforeEach(() => {
  jest.clearAllMocks()
  token.mockResolvedValue('tok')
  listIssue.mockResolvedValue([])
  listReview.mockResolvedValue([])
  createIssue.mockResolvedValue({ id: 901 })
  updateIssue.mockResolvedValue({ id: 901 })
  createReview.mockResolvedValue({ id: 2 })
  findSummaryId.mockResolvedValue(null)
  setSummaryId.mockResolvedValue(undefined)
})

describe('LUM-740 PR review', () => {
  describe('inline denoising', () => {
    it('a LOW finding in a test path gets no inline comment; the summary says so in one line', async () => {
      findById.mockResolvedValue(
        scanRow({
          findings: [
            finding({
              id: 'low',
              severity: 'LOW',
              provenance: 'DETERMINISTIC',
              ruleId: 'secret:aws-access-key',
              filePath: '__tests__/fixtures/keys.test.ts',
              fingerprint: 'fp-low',
            }),
            finding({ id: 'med', fingerprint: 'fp-med' }),
          ],
        })
      )
      const out = await securityPrReviewService.sync('s1')
      expect(out.inline).toBe(1)
      expect(inlinePaths()).toEqual(['lib/run.ts'])
      expect(summaryBody()).toContain('**2 open findings**')
      expect(summaryBody()).toContain(
        '- 1 low-severity finding in test/fixture paths — shown in Lumo only'
      )
    })

    it('drops the test/fixture qualifier when a LOW finding sits in production code', async () => {
      findById.mockResolvedValue(
        scanRow({
          findings: [
            finding({ id: 'a', severity: 'LOW', fingerprint: 'a' }),
            finding({
              id: 'b',
              severity: 'LOW',
              fingerprint: 'b',
              filePath: '__tests__/x.test.ts',
            }),
          ],
        })
      )
      await securityPrReviewService.sync('s1')
      expect(createReview).not.toHaveBeenCalled()
      expect(summaryBody()).toContain(
        '- 2 low-severity findings — shown in Lumo only'
      )
    })

    it('a suggested false positive gets no inline comment; the summary points at Lumo', async () => {
      findById.mockResolvedValue(
        scanRow({
          findings: [
            finding({
              id: 'sug',
              fingerprint: 'fp-sug',
              suggestedDisposition: 'FALSE_POSITIVE',
            }),
            finding({ id: 'med', fingerprint: 'fp-med', filePath: 'lib/b.ts' }),
          ],
        })
      )
      const out = await securityPrReviewService.sync('s1')
      expect(out.inline).toBe(1)
      expect(inlinePaths()).toEqual(['lib/b.ts'])
      expect(summaryBody()).toContain('**2 open findings**')
      expect(summaryBody()).toContain(
        '- 1 suspected false positive (LLM) — confirm or overrule in Lumo'
      )
      // Not counted as "skipped": nothing is waiting for a later sync.
      expect(out.skipped).toBe(0)
    })

    it('holds EXTERNAL_TOOL inline comments until the suggestion pass has run on the scan', async () => {
      // The hunt run syncs concurrently with the managed run; without this
      // it would post the very comments the suggestion pass is about to
      // suppress. Deterministic rows are not affected.
      findById.mockResolvedValue(
        scanRow({
          suggestedAt: null,
          findings: [
            finding({ id: 'ext', fingerprint: 'fp-ext' }),
            finding({
              id: 'det',
              fingerprint: 'fp-det',
              provenance: 'DETERMINISTIC',
              severity: 'HIGH',
              ruleId: 'secret:aws',
              filePath: 'lib/cfg.ts',
            }),
          ],
        })
      )
      const out = await securityPrReviewService.sync('s1')
      expect(inlinePaths()).toEqual(['lib/cfg.ts'])
      expect(out.skipped).toBe(0)
      expect(summaryBody()).toContain('**2 open findings**')
    })

    it('posts EXTERNAL_TOOL inline comments once the suggestion pass has run, or when it is switched off', async () => {
      findById.mockResolvedValue(
        scanRow({ findings: [finding({ id: 'ext', fingerprint: 'fp-ext' })] })
      )
      await securityPrReviewService.sync('s1')
      expect(inlinePaths()).toEqual(['lib/run.ts'])

      jest.clearAllMocks()
      token.mockResolvedValue('tok')
      listIssue.mockResolvedValue([])
      listReview.mockResolvedValue([])
      createIssue.mockResolvedValue({ id: 901 })
      createReview.mockResolvedValue({ id: 2 })
      findSummaryId.mockResolvedValue(null)
      process.env.LUMO_SECURITY_SUGGEST = 'off'
      try {
        findById.mockResolvedValue(
          scanRow({
            suggestedAt: null,
            findings: [finding({ id: 'ext', fingerprint: 'fp-ext' })],
          })
        )
        await securityPrReviewService.sync('s1')
        expect(inlinePaths()).toEqual(['lib/run.ts'])
      } finally {
        delete process.env.LUMO_SECURITY_SUGGEST
      }
    })

    it('says neither line when there is nothing LOW or suggested', async () => {
      findById.mockResolvedValue(scanRow({ findings: [finding()] }))
      await securityPrReviewService.sync('s1')
      expect(summaryBody()).not.toContain('low-severity')
      expect(summaryBody()).not.toContain('suspected false positive')
    })
  })

  describe('summary wording', () => {
    it('names the budget cap when every layer RAN but partial is set (the #950 reading)', () => {
      const body = buildSummary({
        headSha: 'ee2fb78aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
        },
        partial: true,
        externalCounts: {},
        open: 0,
        blocking: 0,
        low: { count: 0, allDowngradedPaths: true },
        suggested: 0,
        error: null,
        taskUrl: null,
      })
      expect(body).toContain(
        'No open findings yet — a layer hit its budget cap, so the scan is not whole.'
      )
    })

    it('keeps the "still incomplete" wording when a layer is actually incomplete', () => {
      const body = buildSummary({
        headSha: 'ee2fb78aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        stages: { secrets: 'RAN', external: 'PENDING' },
        partial: false,
        externalCounts: {},
        open: 0,
        blocking: 0,
        low: { count: 0, allDowngradedPaths: true },
        suggested: 0,
        error: null,
        taskUrl: null,
      })
      expect(body).toContain(
        'No open findings yet — the scan is still incomplete.'
      )
    })
  })

  describe('summary upsert by stored id', () => {
    it('updates the comment whose id is on the scan row without listing comments', async () => {
      findById.mockResolvedValue(scanRow({ summaryCommentId: '77' }))
      await securityPrReviewService.sync('s1')
      expect(updateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '77' })
      )
      expect(listIssue).not.toHaveBeenCalled()
      expect(createIssue).not.toHaveBeenCalled()
      expect(findSummaryId).not.toHaveBeenCalled()
    })

    it('falls back to the PR-level id from an earlier scan and records it on this row', async () => {
      findById.mockResolvedValue(scanRow())
      findSummaryId.mockResolvedValue('55')
      await securityPrReviewService.sync('s1')
      expect(findSummaryId).toHaveBeenCalledWith('pr1')
      expect(updateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '55' })
      )
      expect(listIssue).not.toHaveBeenCalled()
      expect(setSummaryId).toHaveBeenCalledWith('s1', '55')
    })

    it('a 404 on the stored id (comment deleted) creates a fresh summary and stores the new id', async () => {
      findById.mockResolvedValue(scanRow({ summaryCommentId: '77' }))
      updateIssue.mockRejectedValueOnce(new GithubApiError(404, 'Not Found'))
      createIssue.mockResolvedValue({ id: 902 })
      const out = await securityPrReviewService.sync('s1')
      expect(out.posted).toBe(true)
      expect(createIssue).toHaveBeenCalledTimes(1)
      expect(setSummaryId).toHaveBeenCalledWith('s1', '902')
    })

    it('with no id anywhere, adopts the bot comment found by marker and stores its id', async () => {
      findById.mockResolvedValue(scanRow())
      listIssue.mockResolvedValue([
        {
          id: 31,
          body: 'human quoting <!-- lumo-security:summary -->',
          user: { id: 1, type: 'User' },
        },
        {
          id: 32,
          body: '### old summary\n\n<!-- lumo-security:summary -->',
          user: { id: 2, type: 'Bot' },
        },
      ])
      await securityPrReviewService.sync('s1')
      expect(updateIssue).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: '32' })
      )
      expect(setSummaryId).toHaveBeenCalledWith('s1', '32')
    })

    it('with no id and no bot comment, creates one and stores its id', async () => {
      findById.mockResolvedValue(scanRow())
      createIssue.mockResolvedValue({ id: 903 })
      await securityPrReviewService.sync('s1')
      expect(createIssue).toHaveBeenCalledTimes(1)
      expect(setSummaryId).toHaveBeenCalledWith('s1', '903')
    })

    it('a failed id write never fails the sync', async () => {
      findById.mockResolvedValue(scanRow())
      setSummaryId.mockRejectedValue(new Error('db'))
      await expect(securityPrReviewService.sync('s1')).resolves.toMatchObject({
        posted: true,
      })
    })
  })
})
