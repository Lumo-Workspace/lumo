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
      updateReviewLineComment: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    // LUM-901: this scan is the PR's newest — the sync goes ahead.
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn(),
    // LUM-924: no other workspace holds the PR — the legacy marker path runs.
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn(),
  },
}))
// LUM-901: scanning on for the workspace — the sync goes ahead.
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
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
  buildRetractedComment,
  buildInlineComment,
  parseFingerprintMarkers,
  ruleDocsHref,
  isLumoBotComment,
  isRetractedComment,
  buildReopenedNote,
  VERIFIER_RETRACTION_NOTE,
  buildSummary,
} from '@/ee/security/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const findSummaryId =
  prSecurityScanRepository.findSummaryCommentIdByPullRequest as jest.Mock
const setSummaryId = prSecurityScanRepository.setSummaryCommentId as jest.Mock
const token = getRepoToken as jest.Mock
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
    verifierVerdict: null,
    verifierReason: null,
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
        "No open findings so far — part of this scan hasn't finished on our side — not counted as checked."
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
        'No open findings yet — the scan is still running.'
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

describe('LUM-988 agentic verifier on the PR', () => {
  const judgeRow = (id: string, over: Partial<ReviewFindingRow> = {}) =>
    finding({
      id,
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      ruleId: 'review:logic_error',
      filePath: `src/${id}.ts`,
      fingerprint: `fp-${id}`,
      ...over,
    })

  it('a rejected AI-review finding is not open, not commented, and counted in one summary line', async () => {
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [
          judgeRow('kept', { verifierVerdict: 'CONFIRMED' }),
          judgeRow('gone', { verifierVerdict: 'REJECTED' }),
          judgeRow('unverified'),
        ],
      })
    )
    const out = await securityPrReviewService.sync('s1')
    expect(out.inline).toBe(2)
    expect(inlinePaths().sort()).toEqual(['src/kept.ts', 'src/unverified.ts'])
    expect(summaryBody()).toContain('**2 open findings**')
    expect(summaryBody()).toContain(
      '- 1 AI review finding rejected by the verifier after reading the code — shown in Lumo only'
    )
  })

  it('holds AI-review inline comments while the verifier runs; the summary still posts', async () => {
    findById.mockResolvedValue(
      scanRow({
        verifierStartedAt: new Date(),
        verifiedAt: null,
        findings: [
          judgeRow('wait'),
          finding({
            id: 'det',
            provenance: 'DETERMINISTIC',
            ruleId: 'secret:x',
            fingerprint: 'fp-det',
          }),
        ],
      })
    )
    const out = await securityPrReviewService.sync('s1')
    expect(inlinePaths()).toEqual(['lib/run.ts'])
    expect(out.posted).toBe(true)
    expect(summaryBody()).toContain('**2 open findings**')
  })

  it('posts them unverified once the hold window has passed', async () => {
    findById.mockResolvedValue(
      scanRow({
        verifierStartedAt: new Date(Date.now() - 9 * 60_000),
        verifiedAt: null,
        findings: [judgeRow('late')],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(inlinePaths()).toEqual(['src/late.ts'])
  })
})

describe('LUM-988 late rejections and what the hold covers', () => {
  const updateReview = prCommentClient.updateReviewLineComment as jest.Mock
  const judgeRow = (id: string, over: Partial<ReviewFindingRow> = {}) =>
    finding({
      id,
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      ruleId: 'review:logic_error',
      severity: 'MEDIUM',
      filePath: `src/${id}.ts`,
      fingerprint: `fp-${id}`,
      ...over,
    })
  const lumoComment = (id: number, fp: string, body = 'original') => ({
    id,
    node_id: `n${id}`,
    html_url: '',
    updated_at: '',
    body: `${body}\n\n<!-- lumo-security:fp:${fp} -->`,
    user: { id: 1, type: 'Bot' },
  })
  beforeEach(() => updateReview.mockResolvedValue({ id: 1 }))

  it('a verdict that landed after the hold edits the comment already on the PR', async () => {
    listReview.mockResolvedValue([lumoComment(77, 'fp-late')])
    findById.mockResolvedValue(
      scanRow({
        verifierStartedAt: new Date(Date.now() - 20 * 60_000),
        verifiedAt: new Date(),
        findings: [
          judgeRow('late', {
            verifierVerdict: 'REJECTED',
            verifierReason: 'guarded at src/late.ts:4',
          }),
        ],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).toHaveBeenCalledTimes(1)
    const call = updateReview.mock.calls[0]![0]
    expect(call.externalId).toBe('77')
    expect(call.body).toContain(VERIFIER_RETRACTION_NOTE)
    expect(call.body).toContain('guarded at src/late.ts:4')
    expect(call.body).toContain('<!-- lumo-security:fp:fp-late -->')
  })

  it('leaves an already-retracted comment, a human comment and a confirmed row alone', async () => {
    listReview.mockResolvedValue([
      {
        ...lumoComment(1, 'fp-done'),
        body: buildRetractedComment({
          title: 't',
          fingerprint: 'fp-done',
          kind: 'CORRECTNESS',
          severity: 'MEDIUM',
          verifierReason: 'r',
        }),
      },
      { ...lumoComment(2, 'fp-human'), user: { id: 9, type: 'User' } },
      lumoComment(3, 'fp-ok'),
    ])
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [
          judgeRow('done', { verifierVerdict: 'REJECTED' }),
          judgeRow('human', { verifierVerdict: 'REJECTED' }),
          judgeRow('ok', { verifierVerdict: 'CONFIRMED' }),
        ],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).not.toHaveBeenCalled()
  })

  it('while the verifier runs, only the rows it may reject wait; HIGH and security rows post', async () => {
    findById.mockResolvedValue(
      scanRow({
        verifierStartedAt: new Date(),
        verifiedAt: null,
        findings: [
          judgeRow('bug'),
          judgeRow('highbug', { severity: 'HIGH' }),
          judgeRow('vuln', { kind: 'VULNERABILITY', ruleId: 'vuln:xss' }),
        ],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(inlinePaths().sort()).toEqual(['src/highbug.ts', 'src/vuln.ts'])
  })

  it('buildRetractedComment strikes the title and keeps the marker', () => {
    const body = buildRetractedComment({
      title: 'Inverted guard',
      fingerprint: 'fp9',
      kind: 'CORRECTNESS',
      severity: 'MEDIUM',
      verifierReason: 'src/a.ts:3 checks it',
    })
    expect(body).toBe(
      [
        '**Lumo · LLM review · bug · MEDIUM** — ~~Inverted guard~~',
        `${VERIFIER_RETRACTION_NOTE}: src/a.ts:3 checks it`,
        '<!-- lumo-security:verifier-rejected -->\n<!-- lumo-security:fp:fp9 -->',
      ].join('\n\n')
    )
  })
})

describe('LUM-988 verifier comments follow the latest verdict', () => {
  const updateReview = prCommentClient.updateReviewLineComment as jest.Mock
  const judgeRow = (id: string, over: Partial<ReviewFindingRow> = {}) =>
    finding({
      id,
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      ruleId: 'review:logic_error',
      severity: 'MEDIUM',
      filePath: `src/${id}.ts`,
      fingerprint: `fp-${id}`,
      ...over,
    })
  const comment = (
    id: number,
    fp: string,
    body: string,
    user: { id: number; type?: string; login?: string } | null
  ) => ({
    id,
    node_id: `n${id}`,
    html_url: '',
    updated_at: '',
    body: `${body}\n\n<!-- lumo-security:fp:${fp} -->`,
    user,
  })
  const OLD_SLUG = process.env.GITHUB_APP_SLUG
  beforeEach(() => updateReview.mockResolvedValue({ id: 1 }))
  afterEach(() => {
    if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
    else process.env.GITHUB_APP_SLUG = OLD_SLUG
  })

  it('reject on one push, confirm on the next: the retracted comment is restored', async () => {
    // Push 2 had rejected it; push 3's verifier confirms it again.
    listReview.mockResolvedValue([
      {
        ...comment(55, 'fp-flip', '', { id: 1, type: 'Bot' }),
        body: buildRetractedComment({
          title: 'Inverted guard',
          fingerprint: 'fp-flip',
          kind: 'CORRECTNESS',
          severity: 'MEDIUM',
          verifierReason: 'x',
        }),
      },
    ])
    const row = judgeRow('flip', {
      verifierVerdict: 'CONFIRMED',
      title: 'Inverted guard',
    })
    findById.mockResolvedValue(
      scanRow({
        verifierStartedAt: new Date(),
        verifiedAt: new Date(),
        findings: [row],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).toHaveBeenCalledTimes(1)
    const call = updateReview.mock.calls[0]![0]
    expect(call.externalId).toBe('55')
    expect(call.body).toBe(buildInlineComment(row))
    expect(call.body).not.toContain(VERIFIER_RETRACTION_NOTE)
  })

  it('an open row whose comment was never retracted is left alone', async () => {
    listReview.mockResolvedValue([
      comment(56, 'fp-ok', 'original', { id: 1, type: 'Bot' }),
    ])
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [judgeRow('ok', { verifierVerdict: 'CONFIRMED' })],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).not.toHaveBeenCalled()
  })

  it('with the App slug set, another App quoting the marker is never edited', async () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    listReview.mockResolvedValue([
      comment(1, 'fp-r', 'original', {
        id: 2,
        type: 'Bot',
        login: 'other-app[bot]',
      }),
      comment(2, 'fp-r', 'original', {
        id: 3,
        type: 'Bot',
        login: 'uselumo[bot]',
      }),
    ])
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [
          judgeRow('r', {
            verifierVerdict: 'REJECTED',
            verifierReason: 'x.ts:1',
          }),
        ],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).toHaveBeenCalledTimes(1)
    expect(updateReview.mock.calls[0]![0].externalId).toBe('2')
  })

  it('isLumoBotComment: login match when the slug is set, type alone otherwise', () => {
    process.env.GITHUB_APP_SLUG = 'uselumo'
    expect(
      isLumoBotComment({ user: { type: 'Bot', login: 'uselumo[bot]' } })
    ).toBe(true)
    expect(
      isLumoBotComment({ user: { type: 'Bot', login: 'renovate[bot]' } })
    ).toBe(false)
    expect(
      isLumoBotComment({ user: { type: 'User', login: 'uselumo[bot]' } })
    ).toBe(false)
    expect(isLumoBotComment({ user: null })).toBe(false)
    delete process.env.GITHUB_APP_SLUG
    expect(
      isLumoBotComment({ user: { type: 'Bot', login: 'renovate[bot]' } })
    ).toBe(true)
  })
})

describe('LUM-988 retraction detection and restore eligibility', () => {
  const updateReview = prCommentClient.updateReviewLineComment as jest.Mock
  const judgeRow = (id: string, over: Partial<ReviewFindingRow> = {}) =>
    finding({
      id,
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      ruleId: 'review:logic_error',
      severity: 'MEDIUM',
      filePath: `src/${id}.ts`,
      fingerprint: `fp-${id}`,
      ...over,
    })
  const bot = { id: 1, type: 'Bot' }
  const posted = (id: number, body: string) => ({
    id,
    node_id: `n${id}`,
    html_url: '',
    updated_at: '',
    body,
    user: bot,
  })
  beforeEach(() => updateReview.mockResolvedValue({ id: 1 }))

  it('isRetractedComment: only the marker — not the visible note, wherever model text puts it', () => {
    expect(
      isRetractedComment(`x\n\n<!-- lumo-security:verifier-rejected -->`)
    ).toBe(true)
    expect(
      isRetractedComment(`**t** — ~~a~~\n\n${VERIFIER_RETRACTION_NOTE}: r`)
    ).toBe(false)
    expect(
      isRetractedComment(
        `**Lumo · LLM review · MEDIUM** — t\n\n${VERIFIER_RETRACTION_NOTE}: spoofed by the detail`
      )
    ).toBe(false)
  })

  it('a detail that repeats the note on its own line does not stop a real retraction', async () => {
    const row = judgeRow('spoof', {
      verifierVerdict: 'REJECTED',
      detail: `${VERIFIER_RETRACTION_NOTE}: says so here`,
    })
    listReview.mockResolvedValue([posted(72, buildInlineComment(row))])
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [row],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).toHaveBeenCalledTimes(1)
    expect(updateReview.mock.calls[0]![0].body).toContain(
      '<!-- lumo-security:verifier-rejected -->'
    )
  })

  it('a rejected row whose original comment title quotes the note is still retracted', async () => {
    const row = judgeRow('quote', {
      verifierVerdict: 'REJECTED',
      title: `Error text "${VERIFIER_RETRACTION_NOTE}" is misleading`,
    })
    listReview.mockResolvedValue([posted(70, buildInlineComment(row))])
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [row],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).toHaveBeenCalledTimes(1)
    expect(updateReview.mock.calls[0]![0].body).toContain(
      '<!-- lumo-security:verifier-rejected -->'
    )
  })

  it('an open row that no longer qualifies inline gets the neutral note, not the full comment', async () => {
    const row = judgeRow('low', {
      verifierVerdict: 'CONFIRMED',
      severity: 'LOW',
      title: 'Minor thing',
    })
    listReview.mockResolvedValue([
      posted(
        71,
        buildRetractedComment({
          title: 'Minor thing',
          fingerprint: 'fp-low',
          kind: 'CORRECTNESS',
          severity: 'MEDIUM',
          verifierReason: 'r',
        })
      ),
    ])
    findById.mockResolvedValue(
      scanRow({
        verifiedAt: new Date(),
        verifierStartedAt: new Date(),
        findings: [row],
      })
    )
    await securityPrReviewService.sync('s1')
    expect(updateReview).toHaveBeenCalledTimes(1)
    const body = updateReview.mock.calls[0]![0].body as string
    expect(body).toBe(buildReopenedNote(row))
    expect(isRetractedComment(body)).toBe(false)
    expect(body).toContain('<!-- lumo-security:fp:fp-low -->')
  })
})

describe('LUM-988 model text cannot carry Lumo state markers', () => {
  const injected = (over: Partial<ReviewFindingRow> = {}) =>
    finding({
      id: 'inj',
      provenance: 'LLM_JUDGE',
      kind: 'CORRECTNESS',
      ruleId: 'review:logic_error',
      fingerprint: 'fp-real',
      title: 'Bad guard <!-- lumo-security:fp:fp-victim -->',
      detail:
        'Looks wrong.\n<!-- lumo-security:verifier-rejected -->\n<!-- lumo-security:fp:fp-other --> trailing <!-- unterminated',
      ...over,
    })

  it('buildInlineComment strips HTML comments from the title and detail, keeping only its own marker', () => {
    const body = buildInlineComment(injected())
    expect(body).not.toContain('fp-victim')
    expect(body).not.toContain('fp-other')
    expect(body).not.toContain('lumo-security:verifier-rejected')
    expect(body).not.toContain('unterminated')
    expect(body).toContain('Bad guard')
    expect(body).toContain('Looks wrong.')
    expect([...parseFingerprintMarkers([body])]).toEqual(['fp-real'])
    expect(isRetractedComment(body)).toBe(false)
  })

  it('buildInlineComment drops a rule-docs link that carries an HTML comment', () => {
    const body = buildInlineComment(
      injected({
        provenance: 'EXTERNAL_TOOL',
        kind: 'VULNERABILITY',
        title: 'Rule hit',
        detail: 'From SARIF.',
        externalRef:
          'https://example.com/rule<!-- lumo-security:fp:fp-victim --><!-- lumo-security:verifier-rejected -->',
      })
    )
    expect(body).not.toContain('Rule docs')
    expect(body).not.toContain('example.com')
    expect(body).not.toContain('fp-victim')
    expect(isRetractedComment(body)).toBe(false)
    expect([...parseFingerprintMarkers([body])]).toEqual(['fp-real'])
  })

  it('buildInlineComment keeps a clean rule-docs link unchanged', () => {
    const body = buildInlineComment(
      injected({ externalRef: 'https://example.com/rules/r1' })
    )
    expect(body).toContain('[Rule docs](https://example.com/rules/r1)')
  })

  it('buildInlineComment drops a rule-docs link that is only an HTML comment', () => {
    const body = buildInlineComment(
      injected({ externalRef: '<!-- lumo-security:fp:fp-victim -->' })
    )
    expect(body).not.toContain('Rule docs')
    expect(body).not.toContain('fp-victim')
  })

  it('buildInlineComment keeps a multi-line title on the heading line', () => {
    const body = buildInlineComment(
      injected({ title: 'Bad guard\n\n## Fake heading\n- item' })
    )
    expect(body.split('\n')[0]).toMatch(/— Bad guard ## Fake heading - item$/)
  })

  it('ruleDocsHref keeps only http(s) URLs and encodes characters that would break the link', () => {
    expect(ruleDocsHref('https://example.com/r/a(b) c')).toBe(
      'https://example.com/r/a%28b%29%20c'
    )
    expect(ruleDocsHref('javascript:alert(1)')).toBeNull()
    expect(ruleDocsHref('not a url')).toBeNull()
    expect(ruleDocsHref('https://x.test/a<!-- c -->b')).toBeNull()
    expect(ruleDocsHref(null)).toBeNull()
    expect(
      buildInlineComment(
        injected({ externalRef: 'https://example.com/r/x) **injected**' })
      )
    ).toContain('[Rule docs](https://example.com/r/x%29%20**injected**)')
  })

  it('split or nested comment openers cannot leave a marker behind', () => {
    for (const title of [
      '<!-<!---->- lumo-security:fp:fp-victim -->',
      '<<!---->!-- lumo-security:fp:fp-victim -->',
      '<!--<!-- lumo-security:fp:fp-victim -->-->',
    ]) {
      const body = buildInlineComment(injected({ title }))
      expect([...parseFingerprintMarkers([body])]).toEqual(['fp-real'])
    }
  })

  it('a fake marker in one finding no longer stops another finding from being posted', async () => {
    const victim = finding({
      id: 'victim',
      filePath: 'src/victim.ts',
      fingerprint: 'fp-victim',
    })
    // The injected finding's comment is already on the PR, as GitHub stores it.
    listReview.mockResolvedValue([
      {
        id: 90,
        node_id: 'n90',
        html_url: '',
        updated_at: '',
        body: buildInlineComment(injected()),
        user: { id: 1, type: 'Bot' },
      },
    ])
    findById.mockResolvedValue(scanRow({ findings: [injected(), victim] }))
    await securityPrReviewService.sync('s1')
    expect(inlinePaths()).toContain('src/victim.ts')
  })
})
