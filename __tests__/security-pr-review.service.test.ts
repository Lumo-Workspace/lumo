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
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    // LUM-901: this scan is the PR's newest — the sync goes ahead.
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    // LUM-740: no stored summary id → the legacy marker path these
    // expectations describe.
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    // LUM-924: no other workspace holds the PR — the legacy marker path runs.
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn().mockResolvedValue(undefined),
  },
}))
// LUM-901: scanning on for the workspace — the sync goes ahead.
jest.mock('@/lib/services/security-workspace-switches.service', () => ({
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

import { SCAN_STAGE_DESCRIPTIONS as D } from '@/shared/src/security-scan'
import {
  securityPrReviewService,
  buildInlineComment,
  buildSummary,
  parseFingerprintMarkers,
  provenanceLabel,
  findingKindLabel,
  type InlineFinding,
  fingerprintMarker,
  SUMMARY_MARKER,
  REVIEW_MAX_INLINE,
} from '@/lib/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import { logger } from '@/lib/logger'
import type { ReviewFindingRow } from '@/lib/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const token = getRepoToken as jest.Mock
const listIssue = prCommentClient.listIssueComments as jest.Mock
const listReview = prCommentClient.listReviewComments as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const updateIssue = prCommentClient.updateIssueComment as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock

/** A plaintext AWS-shaped key: the RED LINE fixture — must never leave Lumo. */
const PLAINTEXT_KEY = 'AKIAIOSFODNN7EXAMPLE'

/**
 * The row shape `findByIdForReview` actually returns: no `evidence` column at
 * all (the select leaves it behind), which is what makes the RED LINE
 * structural rather than a rule the builder has to remember.
 */
function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'SECRET',
    ruleId: 'secret:aws-access-key',
    severity: 'HIGH',
    provenance: 'DETERMINISTIC',
    filePath: 'src/cfg.ts',
    line: 12,
    title: 'Hardcoded AWS access key',
    detail: 'Move it to an env var and rotate the key.',
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
    // LUM-740: these fixtures predate the suggestion pass — treat it as done.
    suggestedAt: new Date(0),
    findings: [],
    pullRequest: {
      repo: 'acme/app',
      number: 945,
      workspaceId: 'w1',
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
        partial: false,
        externalCounts: { semgrep: 3, gitleaks: 1 },
        open: 4,
        blocking: 1,
        error: 'external: semgrep exit 2',
        taskUrl: 'https://www.uselumo.ai/workspace/acme/my-tasks/LUM-735',
      })
    ).toBe(
      [
        '### 🛡️ Lumo security scan',
        '',
        '**4 open findings** (1 blocking DONE)',
        '',
        "- Part of this scan hasn't finished on our side — not counted as checked.",
        '',
        '⚠ Code scan failed: semgrep exit 2',
        '',
        '<details>',
        '<summary>What was checked</summary>',
        '',
        '- **Secrets** (checked): API keys, tokens and passwords written into the added lines',
        "- **Code scan** (⚠ didn't finish · semgrep 3, gitleaks 1): rule-based scanners for insecure code patterns, leaked credentials, CI workflows and infrastructure config",
        '- **AI review** (checked): an AI reviewer reads the added code, with the changed files for context, for security defects, bugs, code that contradicts its own comments, and tests that cannot catch their bug',
        '',
        '</details>',
        '',
        'Reviewed commit: abcdef1 · [Open in Lumo](https://www.uselumo.ai/workspace/acme/my-tasks/LUM-735)',
        '',
        SUMMARY_MARKER,
      ].join('\n')
    )
  })

  it('LUM-763: PR summary stage line renders human labels, not internal keys', () => {
    const summary = buildSummary({
      headSha: 'abcdef1234567890',
      stages: {
        secrets: 'RAN',
        external: 'RAN',
        supplyChain: 'RAN',
        judge: 'RAN',
        hunt: 'PARTIAL',
      },
      partial: false,
      externalCounts: { semgrep: 3, gitleaks: 1 },
      open: 4,
      blocking: 1,
      error: null,
      taskUrl: null,
    })

    for (const line of [
      `- **Secrets** (checked): ${D.secrets}`,
      `- **Code scan** (checked · semgrep 3, gitleaks 1): ${D.external}`,
      `- **Dependencies** (checked): ${D.supplyChain}`,
      `- **AI review** (checked): ${D.judge}`,
      `- **Exploit paths** (\u26a0 partly checked): ${D.hunt}`,
    ]) {
      expect(summary).toContain(line)
    }
    for (const key of [
      'secrets:',
      'external:',
      'supplyChain:',
      'judge:',
      'hunt:',
    ]) {
      expect(summary).not.toContain(key)
    }
  })

  it('says so when nothing is open, and drops the link without a task', () => {
    expect(
      buildSummary({
        headSha: 'abcdef1234567890',
        stages: { secrets: 'RAN' },
        partial: false,
        externalCounts: {},
        open: 0,
        blocking: 0,
        error: null,
        taskUrl: null,
      })
    ).toBe(
      [
        '### 🛡️ Lumo security scan',
        '',
        '**No open findings on lines this PR added.**',
        '',
        '<details>',
        '<summary>What was checked</summary>',
        '',
        `- **Secrets** (checked): ${D.secrets}`,
        '',
        '</details>',
        '',
        'Reviewed commit: abcdef1',
        '',
        SUMMARY_MARKER,
      ].join('\n')
    )
  })

  it('never calls an incomplete scan clean — a pending layer says "yet"', () => {
    expect(
      buildSummary({
        headSha: 'abcdef1234567890',
        stages: { secrets: 'RAN', external: 'PENDING' },
        partial: false,
        externalCounts: {},
        open: 0,
        blocking: 0,
        error: null,
        taskUrl: null,
      })
    ).toContain('No open findings yet — the scan is still running.')
  })

  it('a partial scan says "yet" too, even with every layer RAN', () => {
    const body = buildSummary({
      headSha: 'abcdef1234567890',
      stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
      partial: true,
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
    })
    // LUM-740: every layer RAN, so the honest reason is the cap, not "still
    // incomplete" (which reads as "still running").
    expect(body).toContain(
      "No open findings so far — part of this scan hasn't finished on our side — not counted as checked."
    )
    expect(body).not.toContain('No open findings on lines this PR added.')
  })

  it('P8: an error without the external prefix is never published as a scanner reason', () => {
    const body = buildSummary({
      headSha: 'abcdef1234567890',
      stages: { secrets: 'RAN', external: 'FAILED' },
      partial: false,
      externalCounts: {},
      open: 1,
      blocking: 0,
      error: 'TypeError: Cannot read properties of undefined',
      taskUrl: null,
    })
    expect(body).not.toContain('Code scan failed')
    expect(body).not.toContain('TypeError')
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
    expect(token).toHaveBeenCalledWith('w1', 'acme/app', {
      pull_requests: 'write',
    })
    expect(createIssue).toHaveBeenCalledWith({
      repo: { owner: 'acme', name: 'app' },
      prNumber: 945,
      token: 'tok',
      body: [
        '### 🛡️ Lumo security scan',
        '',
        '**1 open finding** (1 blocking DONE)',
        '',
        '**Files needing attention:** `src/cfg.ts`',
        '',
        '<details>',
        '<summary>What was checked</summary>',
        '',
        `- **Secrets** (checked): ${D.secrets}`,
        `- **Code scan** (checked): ${D.external}`,
        `- **AI review** (checked): ${D.judge}`,
        '',
        '</details>',
        '',
        'Reviewed commit: [abcdef1](https://github.com/acme/app/commit/abcdef1234567890abcdef1234567890abcdef12) · [Open in Lumo](https://www.uselumo.ai/workspace/acme/my-tasks/LUM-735)',
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

  // LUM-924: two workspaces sharing one App installation scan the same PR and
  // post as the same bot — the marker cannot tell whose summary it is.
  it('does not adopt a summary comment recorded by another workspace scan of the same PR', async () => {
    findById.mockResolvedValue(scanRow())
    ;(
      prSecurityScanRepository.isPullRequestHeldElsewhere as jest.Mock
    ).mockResolvedValueOnce(true)
    listIssue.mockResolvedValue([
      {
        id: 11,
        body: `the other workspace's summary\n${SUMMARY_MARKER}`,
        user: { id: 2, type: 'Bot' },
      },
    ])
    createIssue.mockResolvedValue({ id: 99 })
    const res = await securityPrReviewService.sync('s1')
    expect(res).toMatchObject({ posted: true })
    expect(updateIssue).not.toHaveBeenCalled()
    expect(createIssue).toHaveBeenCalledTimes(1)
    expect(prSecurityScanRepository.setSummaryCommentId).toHaveBeenCalledWith(
      's1',
      '99'
    )
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

  it('LUM-851 file-level trivy DS-0002 is counted in the summary but gets no inline comment', async () => {
    findById.mockResolvedValue(
      scanRow({
        findings: [
          finding({
            id: 'a',
            kind: 'VULNERABILITY',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:trivy:DS-0002',
            filePath: 'Dockerfile',
            line: null,
            title: "Image user should not be 'root'",
            fingerprint: 'fpTrivy',
          }),
        ],
      })
    )
    const res = await securityPrReviewService.sync('s1')
    expect(res).toEqual({ posted: true, inline: 0, skipped: 0 })
    expect(createReview).not.toHaveBeenCalled()
    expect(createIssue.mock.calls[0][0].body).toContain('**1 open finding**')
  })

  it('posts summary only (no review) when the scan has no findings', async () => {
    findById.mockResolvedValue(scanRow({ findings: [] }))
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
          // LUM-740: LOW rows get no inline comment any more, so the
          // lowest-ranked row here is a MEDIUM LLM finding.
          finding({
            id: 'a',
            fingerprint: 'fpLlm',
            severity: 'MEDIUM',
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
      `- **Code scan** (checked · gitleaks 1, semgrep 1): ${D.external}`
    )
  })

  it('adds the external-failure line, prefix stripped, when the workflow scrubbed a reason', async () => {
    findById.mockResolvedValue(
      scanRow({
        stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
        error: 'external: semgrep exit 90',
      })
    )
    await securityPrReviewService.sync('s1')
    expect(createIssue.mock.calls[0][0].body).toContain(
      '⚠ Code scan failed: semgrep exit 90'
    )
  })

  it('P8: stage A’s own raw error is never published as an external-scanner reason', async () => {
    // Stage A can stamp stages.external=FAILED and, on its catch-all path,
    // write an unscrubbed `error.message` into the same column. Only the
    // workflow's prefixed, scrubbed text may reach the PR.
    findById.mockResolvedValue(
      scanRow({
        stages: { secrets: 'RAN', external: 'FAILED', judge: 'RAN' },
        error: 'TypeError: boom',
      })
    )
    await securityPrReviewService.sync('s1')
    const body = createIssue.mock.calls[0][0].body
    expect(body).not.toContain('Code scan failed')
    expect(body).not.toContain('TypeError: boom')
    // The stage line still says FAILED — the fact is published, the text is not.
    expect(body).toContain("- **Code scan** (⚠ didn't finish):")
  })

  it('a comment whose author was deleted (user: null) is skipped, not thrown on', async () => {
    findById.mockResolvedValue(scanRow())
    listIssue.mockResolvedValue([
      { id: 40, body: `ghost quoted it: ${SUMMARY_MARKER}`, user: null },
    ])
    const res = await securityPrReviewService.sync('s1')
    expect(res.posted).toBe(true)
    expect(updateIssue).not.toHaveBeenCalled()
    expect(createIssue).toHaveBeenCalled()
  })

  it('omits the Lumo link when the PR is not linked to a task', async () => {
    findById.mockResolvedValue(
      scanRow({
        pullRequest: {
          repo: 'acme/app',
          number: 945,
          workspaceId: 'w1',
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
    // `findByIdForReview` does not select `evidence`, so this fixture is
    // deliberately MORE hostile than production: the column is forced back
    // onto the row to prove the builders would still not render it.
    findById.mockResolvedValue(
      scanRow({
        findings: [
          {
            ...finding({ detail: 'Rotate this credential.' }),
            evidence: `const key = "${PLAINTEXT_KEY}"`,
          },
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

// ── LUM-738: supply chain on the PR ─────────────────────────────────────────

describe('LUM-738 supplyChain surface — PR summary', () => {
  const base = {
    headSha: 'abcdef1234567890',
    partial: false,
    externalCounts: {},
    open: 0,
    blocking: 0,
    error: null,
    taskUrl: null,
  }

  it('puts new vs already-on-main counts on the Dependencies layer line', () => {
    const body = buildSummary({
      ...base,
      stages: {
        secrets: 'RAN',
        external: 'RAN',
        supplyChain: 'RAN',
        judge: 'RAN',
      },
      open: 2,
      dependencies: { open: 2, persisting: 3 },
    })
    expect(body).toContain(
      `- **Dependencies** (checked · 2 vulnerable dependencies (3 already on main)): ${D.supplyChain}`
    )
    // LUM-849: one Dependencies line, not a layer line plus a result line.
    expect(body.match(/Dependencies/g)).toHaveLength(1)
    expect(body).toContain('**2 open findings**')
  })

  it('singular / clean / skipped / pending phrasings', () => {
    expect(
      buildSummary({
        ...base,
        stages: { supplyChain: 'RAN' },
        open: 1,
        dependencies: { open: 1, persisting: 0 },
      })
    ).toContain('- **Dependencies** (checked · 1 vulnerable dependency): ')
    expect(
      buildSummary({
        ...base,
        stages: { supplyChain: 'RAN' },
        dependencies: { open: 0, persisting: 0 },
      })
    ).toContain('- **Dependencies** (checked · no known vulnerabilities): ')
    expect(
      buildSummary({ ...base, stages: { supplyChain: 'SKIPPED' } })
    ).toContain('(skipped · no package sources found): ')
    // Pending with nothing yet: the layer line states no result, and the
    // scan is not clean.
    const pending = buildSummary({
      ...base,
      stages: { secrets: 'RAN', external: 'PENDING', supplyChain: 'PENDING' },
      dependencies: { open: 0, persisting: 0 },
    })
    expect(pending).toContain(`- **Dependencies** (scanning): ${D.supplyChain}`)
    expect(pending).not.toContain('no known vulnerabilities')
    expect(pending).toContain('still running')
    // No supply-chain layer at all (LUM-735 shape): nothing added.
    expect(
      buildSummary({ ...base, stages: { secrets: 'RAN', external: 'RAN' } })
    ).not.toContain('Dependencies')
  })

  it('publishes a scrubbed supply-chain failure under its own label, external untouched', () => {
    const body = buildSummary({
      ...base,
      stages: { secrets: 'RAN', external: 'RAN', supplyChain: 'FAILED' },
      error: 'external: osv-scanner exit 129',
    })
    expect(body).toContain('⚠ Dependency scan failed: osv-scanner exit 129')
    expect(body).not.toContain('Code scan failed')
    // An external failure keeps its LUM-735 label even when supplyChain also failed.
    expect(
      buildSummary({
        ...base,
        stages: { external: 'FAILED', supplyChain: 'FAILED' },
        error: 'external: gitleaks exit 2; osv-scanner exit 129',
      })
    ).toContain('⚠ Code scan failed: gitleaks exit 2; osv-scanner exit 129')
    // P8 still holds: an unprefixed error is never published.
    expect(
      buildSummary({
        ...base,
        stages: { supplyChain: 'FAILED' },
        error: 'raw TypeError',
      })
    ).not.toContain('raw TypeError')
  })
})

describe('LUM-738 supplyChain surface — sync excludes persisting rows', () => {
  it('a persisting finding is not open, not blocking, not inline-commented, and not in the external tool counts; dependencies are counted on their own line', async () => {
    findById.mockResolvedValue(
      scanRow({
        stages: {
          secrets: 'RAN',
          external: 'RAN',
          supplyChain: 'RAN',
          judge: 'RAN',
        },
        findings: [
          // New semgrep hit on an added line → open + inline.
          finding({
            id: 'new',
            fingerprint: 'fpNew',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:r',
            line: 2,
            persisting: false,
          }),
          // Same rule, already on main → muted everywhere.
          finding({
            id: 'old',
            fingerprint: 'fpOld',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:semgrep:r',
            line: 5,
            persisting: true,
          }),
          // A new vulnerable dependency (no line) and a pre-existing one.
          finding({
            id: 'dep-new',
            kind: 'DEPENDENCY',
            fingerprint: 'fpDep1',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:osv-scanner:GHSA-1',
            line: null,
            persisting: false,
          }),
          finding({
            id: 'dep-old',
            kind: 'DEPENDENCY',
            fingerprint: 'fpDep2',
            provenance: 'EXTERNAL_TOOL',
            ruleId: 'ext:osv-scanner:GHSA-2',
            line: null,
            persisting: true,
          }),
        ],
      })
    )
    const out = await securityPrReviewService.sync('s1')
    expect(out).toEqual({ posted: true, inline: 1, skipped: 0 })
    const comments = createReview.mock.calls[0][0].comments
    expect(comments.map((c: { line: number }) => c.line)).toEqual([2])
    const body = createIssue.mock.calls[0][0].body as string
    expect(body).toContain(
      `- **Code scan** (checked · semgrep 1): ${D.external}`
    )
    expect(body).toContain(
      `- **Dependencies** (checked · 1 vulnerable dependency (1 already on main)): ${D.supplyChain}`
    )
    expect(body).toContain('**2 open findings**')
  })
})

// ── LUM-988: correctness findings from the AI review ──────────────────────

const llm = (over: Partial<InlineFinding> = {}): InlineFinding => ({
  provenance: 'LLM_JUDGE',
  ruleId: 'review:logic_error',
  severity: 'HIGH',
  title: 'Inverted permission check',
  detail: 'The guard returns early for admins instead of non-admins.',
  externalRef: null,
  fingerprint: 'fp988',
  disposition: null,
  suggestedDisposition: null,
  kind: 'CORRECTNESS',
  ...over,
})

describe('LUM-988 PR review comment — correctness findings', () => {
  it('labels a CORRECTNESS finding as a bug and never says it blocks DONE', () => {
    expect(buildInlineComment(llm())).toBe(
      [
        '**Lumo · LLM review · bug · HIGH** — Inverted permission check',
        '',
        'The guard returns early for admins instead of non-admins.',
        '',
        '<!-- lumo-security:fp:fp988 -->',
      ].join('\n')
    )
  })

  it('keeps the security heading for every other kind, and when kind is absent', () => {
    expect(
      buildInlineComment(llm({ kind: 'VULNERABILITY', ruleId: 'vuln:xss' }))
    ).toMatch(/^\*\*Lumo · LLM review · HIGH\*\*/)
    const legacy: InlineFinding = llm()
    delete legacy.kind
    expect(buildInlineComment(legacy)).toMatch(
      /^\*\*Lumo · LLM review · HIGH\*\*/
    )
  })

  it('findingKindLabel names only CORRECTNESS', () => {
    expect(findingKindLabel('CORRECTNESS')).toBe('bug')
    for (const k of [
      'SECRET',
      'VULNERABILITY',
      'DEPENDENCY',
      undefined,
    ] as const)
      expect(findingKindLabel(k)).toBeNull()
  })
})
