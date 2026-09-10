/**
 * @jest-environment node
 *
 * LUM-735 Task 2 — the PR write-back. Everything that talks to GitHub or the
 * database is mocked; the bodies themselves are asserted verbatim because they
 * are the contract (markers drive idempotency, and P8 forbids `evidence` from
 * ever reaching a request body).
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
  prSecurityScanRepository: { findByIdForReview: jest.fn() },
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
  buildInlineComment,
  buildSummary,
  parseFingerprintMarkers,
  provenanceLabel,
  fingerprintMarker,
  SUMMARY_MARKER,
  REVIEW_MAX_INLINE,
} from '@/lib/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { logger } from '@/lib/logger'
import type { FindingRow } from '@/lib/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const token = getGithubInstallationToken as jest.Mock
const listIssue = prCommentClient.listIssueComments as jest.Mock
const listReview = prCommentClient.listReviewComments as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const updateIssue = prCommentClient.updateIssueComment as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock

/** A plaintext AWS-shaped key: the RED LINE fixture — must never leave Lumo. */
const PLAINTEXT_KEY = 'AKIAIOSFODNN7EXAMPLE'

function finding(over: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'f1',
    scanId: 's1',
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'src/cfg.ts',
    line: 12,
    title: 'Hardcoded AWS access key',
    detail: 'Move it to an env var and rotate the key.',
    evidence: 'const k = "AKIA…REDACTED"',
    fingerprint: 'fp1',
    externalRef: null,
    disposition: null,
    dispositionNote: null,
    dispositionedById: null,
    dispositionedAt: null,
    inheritedFromFindingId: null,
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    ...over,
  }
}

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    status: 'FINDINGS',
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    findings: [],
    pullRequest: {
      repo: 'acme/app',
      number: 945,
      workspaceId: 'w1',
      taskId: 't1',
      task: { number: 735, team: { identifier: 'LUM' } },
      workspace: { slug: 'acme' },
    },
    ...over,
  }
}

/** Every string this sync sent to GitHub, in one haystack. */
function allSentBodies(): string {
  const calls = [
    ...createIssue.mock.calls,
    ...updateIssue.mock.calls,
    ...createReview.mock.calls,
  ]
  return JSON.stringify(calls)
}

beforeEach(() => {
  jest.clearAllMocks()
  token.mockResolvedValue('tok')
  listIssue.mockResolvedValue([])
  listReview.mockResolvedValue([])
  createIssue.mockResolvedValue({ id: 1 })
  updateIssue.mockResolvedValue({ id: 1 })
  createReview.mockResolvedValue({ id: 2, html_url: 'https://gh/review' })
})

// ── Pure builders ───────────────────────────────────────────────────────────

describe('pure builders', () => {
  it('labels provenance: pattern / tool slug / LLM review', () => {
    expect(
      provenanceLabel({
        provenance: 'DETERMINISTIC',
        ruleId: 'secret:aws-access-key',
      })
    ).toBe('pattern')
    expect(
      provenanceLabel({
        provenance: 'EXTERNAL_TOOL',
        ruleId: 'ext:semgrep:js.lang.security.audit',
      })
    ).toBe('semgrep')
    expect(
      provenanceLabel({ provenance: 'LLM_JUDGE', ruleId: 'judge:sqli' })
    ).toBe('LLM review')
  })

  it('builds the inline body for a blocking deterministic finding', () => {
    expect(buildInlineComment(finding())).toBe(
      [
        '**Lumo · pattern · HIGH** — Hardcoded AWS access key',
        '',
        'Move it to an env var and rotate the key.',
        '',
        'blocks DONE',
        '',
        '<!-- lumo-security:fp:fp1 -->',
      ].join('\n')
    )
  })

  it('builds the inline body for an external finding with a rule doc link', () => {
    expect(
      buildInlineComment(
        finding({
          provenance: 'EXTERNAL_TOOL',
          ruleId: 'ext:semgrep:js.lang.security.audit',
          severity: 'MEDIUM',
          title: 'Possible XSS sink',
          detail: 'User input reaches innerHTML.',
          externalRef: 'https://semgrep.dev/r/js.audit',
          fingerprint: 'fp2',
        })
      )
    ).toBe(
      [
        '**Lumo · semgrep · MEDIUM** — Possible XSS sink',
        '',
        'User input reaches innerHTML.',
        '',
        '[Rule docs](https://semgrep.dev/r/js.audit)',
        '',
        '<!-- lumo-security:fp:fp2 -->',
      ].join('\n')
    )
  })

  it('omits the detail block when the finding has none (LLM judge)', () => {
    expect(
      buildInlineComment(
        finding({
          provenance: 'LLM_JUDGE',
          ruleId: 'judge:authz',
          severity: 'LOW',
          title: 'Missing authorization check',
          detail: '',
          fingerprint: 'fp3',
        })
      )
    ).toBe(
      [
        '**Lumo · LLM review · LOW** — Missing authorization check',
        '',
        '<!-- lumo-security:fp:fp3 -->',
      ].join('\n')
    )
  })

  it('builds the summary with stages, external counts, the failure and the task link', () => {
    expect(
      buildSummary({
        headSha: 'abcdef1234567890',
        stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
        externalCounts: { semgrep: 3, gitleaks: 1 },
        open: 4,
        blocking: 1,
        error: 'external: semgrep exit 2',
        taskUrl: 'https://www.uselumo.ai/workspace/acme/my-tasks/LUM-735',
      })
    ).toBe(
      [
        '### 🛡️ Lumo security scan — abcdef1',
        '',
        '- secrets: RAN · external: FAILED (semgrep 3, gitleaks 1) · judge: RAN',
        '',
        '**4 open findings** (1 blocking DONE)',
        '',
        '⚠ External scanner failed: external: semgrep exit 2',
        '',
        '[Open in Lumo](https://www.uselumo.ai/workspace/acme/my-tasks/LUM-735)',
        '',
        SUMMARY_MARKER,
      ].join('\n')
    )
  })

  it('says so when nothing is open, and drops the link without a task', () => {
    expect(
      buildSummary({
        headSha: 'abcdef1234567890',
        stages: { secrets: 'RAN' },
        externalCounts: {},
        open: 0,
        blocking: 0,
        error: null,
        taskUrl: null,
      })
    ).toBe(
      [
        '### 🛡️ Lumo security scan — abcdef1',
        '',
        '- secrets: RAN',
        '',
        'No open findings on lines this PR added.',
        '',
        SUMMARY_MARKER,
      ].join('\n')
    )
  })

  it('parses fingerprint markers out of arbitrary comment bodies', () => {
    const set = parseFingerprintMarkers([
      `something ${fingerprintMarker('abc')}`,
      'no marker here',
      `${fingerprintMarker('def')}\n${fingerprintMarker('ghi')}`,
    ])
    expect([...set].sort()).toEqual(['abc', 'def', 'ghi'])
  })
})

// ── sync() ──────────────────────────────────────────────────────────────────

describe('securityPrReviewService.sync', () => {
  it('creates the summary comment when the PR carries no marker yet', async () => {
    findById.mockResolvedValue(scanRow({ findings: [finding()] }))
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 1, skipped: 0 })
    expect(token).toHaveBeenCalledWith('w1')
    expect(createIssue).toHaveBeenCalledWith({
      repo: { owner: 'acme', name: 'app' },
      prNumber: 945,
      token: 'tok',
      body: [
        '### 🛡️ Lumo security scan — abcdef1',
        '',
        '- secrets: RAN · external: RAN · judge: RAN',
        '',
        '**1 open finding** (1 blocking DONE)',
        '',
        '[Open in Lumo](https://www.uselumo.ai/workspace/acme/my-tasks/LUM-735)',
        '',
        SUMMARY_MARKER,
      ].join('\n'),
    })
    expect(updateIssue).not.toHaveBeenCalled()
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { owner: 'acme', name: 'app' },
        prNumber: 945,
        token: 'tok',
        commitId: 'abcdef1234567890abcdef1234567890abcdef12',
        comments: [
          {
            path: 'src/cfg.ts',
            line: 12,
            side: 'RIGHT',
            body: buildInlineComment(finding()),
          },
        ],
      })
    )
  })

  it('updates the existing summary comment found by its marker', async () => {
    findById.mockResolvedValue(scanRow())
    listIssue.mockResolvedValue([
      { id: 10, body: 'unrelated chatter', user: { id: 1, type: 'User' } },
      {
        id: 11,
        body: `old summary\n${SUMMARY_MARKER}`,
        user: { id: 2, type: 'Bot' },
      },
    ])
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 0, skipped: 0 })
    expect(createIssue).not.toHaveBeenCalled()
    expect(updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: { owner: 'acme', name: 'app' },
        externalId: '11',
        token: 'tok',
      })
    )
    expect(updateIssue.mock.calls[0][0].body).toContain(
      'No open findings on lines this PR added.'
    )
    expect(createReview).not.toHaveBeenCalled()
  })

  it('skips fingerprints already present in the PR review comments', async () => {
    findById.mockResolvedValue(
      scanRow({
        findings: [
          finding({ id: 'a', fingerprint: 'fp1' }),
          finding({ id: 'b', fingerprint: 'fp2', line: 20 }),
        ],
      })
    )
    listReview.mockResolvedValue([
      { id: 5, body: `earlier\n${fingerprintMarker('fp1')}`, user: { id: 1 } },
    ])
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 1, skipped: 1 })
    const comments = createReview.mock.calls[0][0].comments
    expect(comments).toHaveLength(1)
    expect(comments[0].body).toContain(fingerprintMarker('fp2'))
    // The summary still counts every open finding, posted or not.
    expect(createIssue.mock.calls[0][0].body).toContain('**2 open findings**')
  })

  it('caps inline comments at REVIEW_MAX_INLINE and reports the rest as skipped', async () => {
    const many = Array.from({ length: REVIEW_MAX_INLINE + 7 }, (_, i) =>
      finding({ id: `f${i}`, fingerprint: `fp${i}`, line: i + 1 })
    )
    findById.mockResolvedValue(scanRow({ findings: many }))
    const res = await securityPrReviewService.sync('s1')
    expect(REVIEW_MAX_INLINE).toBe(50)
    expect(res).toEqual({ posted: true, inline: 50, skipped: 7 })
    expect(createReview.mock.calls[0][0].comments).toHaveLength(50)
  })

  it('ignores dispositioned findings and findings without a line', async () => {
    findById.mockResolvedValue(
      scanRow({
        findings: [
          finding({
            id: 'a',
            fingerprint: 'fp1',
            disposition: 'FALSE_POSITIVE',
          }),
          finding({ id: 'b', fingerprint: 'fp2', line: null }),
          finding({ id: 'c', fingerprint: 'fp3', line: 9 }),
        ],
      })
    )
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 1, skipped: 0 })
    const comments = createReview.mock.calls[0][0].comments
    expect(comments).toHaveLength(1)
    expect(comments[0].body).toContain(fingerprintMarker('fp3'))
    // A finding with no line is still open, so the summary counts two.
    expect(createIssue.mock.calls[0][0].body).toContain('**2 open findings**')
  })

  it('posts summary only (no review) when the scan has no findings', async () => {
    findById.mockResolvedValue(scanRow({ status: 'CLEAN', findings: [] }))
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 0, skipped: 0 })
    expect(createReview).not.toHaveBeenCalled()
    expect(createIssue.mock.calls[0][0].body).toContain(
      'No open findings on lines this PR added.'
    )
  })

  it('sorts by severity then provenance and counts external findings per tool', async () => {
    findById.mockResolvedValue(
      scanRow({
        findings: [
          finding({
            id: 'a',
            fingerprint: 'fpLow',
            severity: 'LOW',
            provenance: 'LLM_JUDGE',
            ruleId: 'judge:x',
            line: 1,
          }),
          finding({
            id: 'b',
            fingerprint: 'fpExt',
            severity: 'HIGH',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:rule-1',
            line: 2,
          }),
          finding({ id: 'c', fingerprint: 'fpDet', severity: 'HIGH', line: 3 }),
          finding({
            id: 'd',
            fingerprint: 'fpExt2',
            severity: 'MEDIUM',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:gitleaks:generic',
            line: 4,
          }),
        ],
      })
    )
    await securityPrReviewService.sync('s1')
    const comments = createReview.mock.calls[0][0].comments
    expect(comments.map((c: { line: number }) => c.line)).toEqual([3, 2, 4, 1])
    expect(createIssue.mock.calls[0][0].body).toContain(
      '- secrets: RAN · external: RAN (gitleaks 1, semgrep 1) · judge: RAN'
    )
  })

  it('adds the external-failure line when the external stage FAILED', async () => {
    findById.mockResolvedValue(
      scanRow({
        stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
        error: 'external: semgrep exit 2',
      })
    )
    await securityPrReviewService.sync('s1')
    expect(createIssue.mock.calls[0][0].body).toContain(
      '⚠ External scanner failed: external: semgrep exit 2'
    )
  })

  it('omits the Lumo link when the PR is not linked to a task', async () => {
    findById.mockResolvedValue(
      scanRow({
        pullRequest: {
          repo: 'acme/app',
          number: 945,
          workspaceId: 'w1',
          taskId: null,
          task: null,
          workspace: { slug: 'acme' },
        },
      })
    )
    await securityPrReviewService.sync('s1')
    expect(createIssue.mock.calls[0][0].body).not.toContain('[Open in Lumo]')
  })

  it('a 422 on the review keeps the summary posted, warns, and does not throw', async () => {
    findById.mockResolvedValue(scanRow({ findings: [finding()] }))
    createReview.mockRejectedValue(
      new GithubApiError(422, { message: 'line must be part of the diff' })
    )
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 0, skipped: 1 })
    expect(createIssue).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[security-pr-review]')
    )
  })

  it('a non-422 failure on the review still counts the unposted comments as skipped', async () => {
    findById.mockResolvedValue(scanRow({ findings: [finding()] }))
    createReview.mockRejectedValue(
      new GithubApiError(500, { message: 'Internal Server Error' })
    )
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 0, skipped: 1 })
    expect(createIssue).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[security-pr-review]')
    )
  })

  it('only upserts the summary comment authored by the bot, never a human quoting the marker', async () => {
    findById.mockResolvedValue(scanRow())
    listIssue.mockResolvedValue([
      {
        id: 20,
        body: `I quoted the marker: ${SUMMARY_MARKER}`,
        user: { id: 3, type: 'User', login: 'alice' },
      },
      {
        id: 21,
        body: `old summary\n${SUMMARY_MARKER}`,
        user: { id: 99, type: 'Bot', login: 'lumo-bot[bot]' },
      },
    ])
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(createIssue).not.toHaveBeenCalled()
    expect(updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: '21' })
    )
  })

  it('creates a new summary comment when only a human comment carries the marker', async () => {
    findById.mockResolvedValue(scanRow())
    listIssue.mockResolvedValue([
      {
        id: 30,
        body: `I quoted the marker: ${SUMMARY_MARKER}`,
        user: { id: 3, type: 'User', login: 'alice' },
      },
    ])
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(createIssue).toHaveBeenCalled()
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('a 404 (PR gone / app uninstalled) returns posted:false and never throws', async () => {
    findById.mockResolvedValue(scanRow({ findings: [finding()] }))
    listReview.mockRejectedValue(
      new GithubApiError(404, { message: 'Not Found' })
    )
    await expect(securityPrReviewService.sync('s1')).resolves.toEqual({
      posted: false,
      inline: 0,
      skipped: 0,
    })
    expect(createIssue).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('scan=s1 pr=#945')
    )
  })

  it('a 403 on the summary write returns posted:false without throwing', async () => {
    findById.mockResolvedValue(scanRow())
    createIssue.mockRejectedValue(
      new GithubApiError(403, { message: 'Resource not accessible' })
    )
    await expect(securityPrReviewService.sync('s1')).resolves.toEqual({
      posted: false,
      inline: 0,
      skipped: 0,
    })
  })

  it('an unknown scan id posts nothing', async () => {
    findById.mockResolvedValue(null)
    await expect(securityPrReviewService.sync('nope')).resolves.toEqual({
      posted: false,
      inline: 0,
      skipped: 0,
    })
    expect(token).not.toHaveBeenCalled()
  })

  it('a token failure is swallowed', async () => {
    findById.mockResolvedValue(scanRow())
    token.mockRejectedValue(new Error('no installation'))
    await expect(securityPrReviewService.sync('s1')).resolves.toEqual({
      posted: false,
      inline: 0,
      skipped: 0,
    })
    expect(listReview).not.toHaveBeenCalled()
  })

  it('RED LINE: a finding’s evidence never reaches any GitHub request body', async () => {
    findById.mockResolvedValue(
      scanRow({
        findings: [
          finding({
            evidence: `const key = "${PLAINTEXT_KEY}"`,
            detail: 'Rotate this credential.',
          }),
        ],
      })
    )
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(res.inline).toBe(1)
    const sent = allSentBodies()
    expect(sent).toContain('Hardcoded AWS access key')
    expect(sent).not.toContain(PLAINTEXT_KEY)
    expect(sent).not.toContain('const key =')
  })
})
