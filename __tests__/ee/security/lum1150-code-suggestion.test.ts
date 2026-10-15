/**
 * @jest-environment node
 *
 * LUM-1150 — committable suggestions in the AI review's inline comments: the
 * pure range validation, the comment body, and the review request's anchor
 * (exactly the replaced lines), with the comment kept whenever the
 * suggestion is dropped.
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
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
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
  buildInlineComment,
  inlineSuggestion,
  suggestionWinners,
  type InlineFinding,
} from '@/ee/security/services/security-pr-review.service'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  CODE_SUGGESTION_MAX_LINES,
  parseCodeSuggestion,
  suggestionAnchor,
  suggestionBlock,
  validateCodeSuggestion,
  type ValidateCodeSuggestionInput,
} from '@/ee/security/security-scan/code-suggestion'
import { SecurityJudgeSchema } from '@/ee/security/llm/security-judge-client'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
// Built at runtime so the secret scanner never sees a key-shaped literal.
const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')
const createReview = prCommentClient.createReview as jest.Mock

// ── validateCodeSuggestion (pure) ───────────────────────────────────────────

const FILES = [
  {
    path: 'lib/auth.ts',
    lines: [
      { lineNo: 10, text: 'export function canEdit(user: User): boolean {' },
      { lineNo: 11, text: "  if (user.role === 'admin') return false" },
      { lineNo: 12, text: '  return user.owner' },
      { lineNo: 13, text: '}' },
      // 14-15 are context lines; 16 is added again (a second hunk).
      { lineNo: 16, text: 'export const x = 1' },
    ],
  },
]

function input(
  over: Partial<ValidateCodeSuggestionInput> = {}
): ValidateCodeSuggestionInput {
  return {
    suggestion: {
      startLine: 11,
      endLine: 11,
      code: "  if (user.role !== 'admin') return false",
    },
    line: 11,
    severity: 'HIGH',
    filePath: 'lib/auth.ts',
    evidence: "if (user.role === 'admin') return false",
    files: FILES,
    ...over,
  }
}

describe('LUM-1150 validateCodeSuggestion', () => {
  it('keeps a single-line fix on an added line', () => {
    expect(validateCodeSuggestion(input())).toEqual({
      startLine: 11,
      endLine: 11,
      code: "  if (user.role !== 'admin') return false",
    })
  })

  it('keeps a multi-line fix over consecutive added lines, trailing newlines trimmed', () => {
    expect(
      validateCodeSuggestion(
        input({
          suggestion: {
            startLine: 11,
            endLine: 12,
            code: "  if (user.role === 'admin') return true\n  return user.owner === true\n\n",
          },
        })
      )
    ).toEqual({
      startLine: 11,
      endLine: 12,
      code: "  if (user.role === 'admin') return true\n  return user.owner === true",
    })
  })

  it.each([
    ['range does not contain the finding line', { startLine: 12, endLine: 13 }],
    [
      'range crosses a context line (two hunks)',
      { startLine: 11, endLine: 16 },
    ],
    ['range starts before the added lines', { startLine: 9, endLine: 11 }],
    ['end before start', { startLine: 11, endLine: 10 }],
    ['non-integer line', { startLine: 10.5, endLine: 11 }],
    ['zero line', { startLine: 0, endLine: 11 }],
  ])('drops an invalid range: %s', (_label, range) => {
    expect(
      validateCodeSuggestion(
        input({ suggestion: { ...range, code: 'return true' } })
      )
    ).toBeNull()
  })

  it(`drops a range longer than ${CODE_SUGGESTION_MAX_LINES} lines`, () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({
      lineNo: i + 1,
      text: `const v${i} = ${i}`,
    }))
    expect(
      validateCodeSuggestion({
        suggestion: { startLine: 1, endLine: 13, code: 'const v = 0' },
        line: 1,
        severity: 'HIGH',
        filePath: 'a.ts',
        evidence: 'const v0 = 0',
        files: [{ path: 'a.ts', lines }],
      })
    ).toBeNull()
  })

  it('drops a fix for another file, a null line, or a LOW finding', () => {
    expect(
      validateCodeSuggestion(input({ filePath: 'lib/other.ts' }))
    ).toBeNull()
    expect(validateCodeSuggestion(input({ line: null }))).toBeNull()
    expect(validateCodeSuggestion(input({ severity: 'LOW' }))).toBeNull()
    expect(validateCodeSuggestion(input({ suggestion: null }))).toBeNull()
  })

  it('drops a fix whose range does not hold the evidence line', () => {
    expect(
      validateCodeSuggestion(input({ evidence: 'return user.owner' }))
    ).toBeNull()
  })

  it('drops a fix that changes nothing', () => {
    expect(
      validateCodeSuggestion(
        input({
          suggestion: {
            startLine: 11,
            endLine: 11,
            code: "  if (user.role === 'admin') return false",
          },
        })
      )
    ).toBeNull()
  })

  it.each([
    ['a fence that would close the block', '  return true\n```\n**fake**'],
    ['a tilde fence', '~~~\nx'],
    [
      'an HTML comment that could forge a Lumo marker',
      '<!-- lumo-security:fp:other -->',
    ],
    ['a carriage return', 'return true\r'],
    ['a secret', `const k = '${FAKE_AWS_KEY}'`],
    ['an oversized body', 'x'.repeat(2001)],
  ])('drops code carrying %s', (_label, code) => {
    expect(
      validateCodeSuggestion(
        input({ suggestion: { startLine: 11, endLine: 11, code } })
      )
    ).toBeNull()
  })

  it('drops a fix over a line the model only saw masked', () => {
    const files = [
      {
        path: 'lib/auth.ts',
        lines: [{ lineNo: 11, text: `const k = '${FAKE_AWS_KEY}'` }],
      },
    ]
    expect(
      validateCodeSuggestion(
        input({
          files,
          evidence: `const k = '${FAKE_AWS_KEY}'`,
          suggestion: {
            startLine: 11,
            endLine: 11,
            code: 'const k = process.env.KEY',
          },
        })
      )
    ).toBeNull()
  })

  it('allows an empty replacement (delete the lines)', () => {
    expect(
      validateCodeSuggestion(
        input({ suggestion: { startLine: 11, endLine: 11, code: '' } })
      )
    ).toEqual({ startLine: 11, endLine: 11, code: '' })
  })
})

describe('LUM-1150 stored-suggestion helpers', () => {
  it('parseCodeSuggestion reads a valid row and rejects malformed ones', () => {
    expect(
      parseCodeSuggestion({ startLine: 3, endLine: 4, code: 'a' })
    ).toEqual({ startLine: 3, endLine: 4, code: 'a' })
    expect(parseCodeSuggestion(null)).toBeNull()
    expect(
      parseCodeSuggestion({ startLine: 4, endLine: 3, code: 'a' })
    ).toBeNull()
    expect(parseCodeSuggestion({ startLine: 1, endLine: 2 })).toBeNull()
    expect(
      parseCodeSuggestion({ startLine: 1, endLine: 1, code: '```' })
    ).toBeNull()
  })

  it('suggestionBlock renders a GitHub suggestion fence', () => {
    expect(suggestionBlock({ startLine: 1, endLine: 2, code: 'a\nb' })).toBe(
      '```suggestion\na\nb\n```'
    )
    expect(suggestionBlock({ startLine: 1, endLine: 1, code: '' })).toBe(
      '```suggestion\n```'
    )
  })

  it('suggestionAnchor: multi-line ranges get start_line, single lines do not', () => {
    expect(suggestionAnchor({ startLine: 3, endLine: 5, code: '' })).toEqual({
      line: 5,
      start_line: 3,
      start_side: 'RIGHT',
    })
    expect(suggestionAnchor({ startLine: 7, endLine: 7, code: '' })).toEqual({
      line: 7,
    })
  })

  it('the judge schema accepts a finding with, without, and missing a suggestion', () => {
    const f = {
      kind: 'logic_error',
      severity: 'HIGH',
      filePath: 'a.ts',
      line: 1,
      title: 't',
      detail: 'd',
      evidence: 'e',
    }
    const prSummary = { intent: 'i', changes: [] }
    expect(
      SecurityJudgeSchema.safeParse({ findings: [f], prSummary }).success
    ).toBe(true)
    expect(
      SecurityJudgeSchema.safeParse({
        findings: [{ ...f, suggestion: null }],
        prSummary,
      }).success
    ).toBe(true)
    expect(
      SecurityJudgeSchema.safeParse({
        findings: [
          { ...f, suggestion: { startLine: 1, endLine: 1, code: 'x' } },
        ],
        prSummary,
      }).success
    ).toBe(true)
  })
})

// ── The inline comment and the review request ───────────────────────────────

const SUGGESTION = {
  startLine: 11,
  endLine: 12,
  code: "  if (user.role === 'admin') return true\n  return user.owner === true",
}

function row(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f1',
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'HIGH',
    provenance: 'LLM_JUDGE',
    filePath: 'lib/auth.ts',
    line: 11,
    title: 'Inverted admin check',
    detail: 'Admins are refused instead of allowed.',
    fingerprint: 'fp1150',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    codeSuggestion: SUGGESTION,
    ...over,
  }
}

function scanRow(findings: ReviewFindingRow[]) {
  return {
    id: 's1',
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    stages: { secrets: 'RAN', external: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    findings,
    pullRequest: {
      repo: 'acme/app',
      number: 945,
      workspaceId: 'w1',
      task: { number: 735, team: { identifier: 'LUM' } },
      workspace: { slug: 'acme' },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.createIssueComment as jest.Mock).mockResolvedValue({
    id: 1,
  })
  createReview.mockResolvedValue({ id: 2, html_url: 'https://gh/review' })
})

describe('LUM-1150 inline comment body', () => {
  it('appends the suggestion block after the detail, before the marker', () => {
    const f: InlineFinding = row()
    expect(buildInlineComment(f, undefined, SUGGESTION)).toBe(
      [
        '**Lumo · LLM review · bug · HIGH** — Inverted admin check',
        '',
        'Admins are refused instead of allowed.',
        '',
        '```suggestion',
        "  if (user.role === 'admin') return true",
        '  return user.owner === true',
        '```',
        '',
        '<!-- lumo-security:fp:fp1150 -->',
      ].join('\n')
    )
  })

  it('without a suggestion the body is unchanged', () => {
    expect(buildInlineComment(row())).toBe(
      [
        '**Lumo · LLM review · bug · HIGH** — Inverted admin check',
        '',
        'Admins are refused instead of allowed.',
        '',
        '<!-- lumo-security:fp:fp1150 -->',
      ].join('\n')
    )
  })

  it('inlineSuggestion: only actionable LLM rows whose line is inside the range', () => {
    expect(inlineSuggestion(row())).toEqual(SUGGESTION)
    expect(inlineSuggestion(row({ severity: 'LOW' }))).toBeNull()
    expect(inlineSuggestion(row({ provenance: 'EXTERNAL_TOOL' }))).toBeNull()
    expect(inlineSuggestion(row({ line: 20 }))).toBeNull()
    expect(inlineSuggestion(row({ line: null }))).toBeNull()
    expect(inlineSuggestion(row({ codeSuggestion: { bad: 1 } }))).toBeNull()
  })
})

describe('LUM-1150 review request', () => {
  it('anchors a multi-line suggestion on exactly its lines', async () => {
    findById.mockResolvedValue(scanRow([row()]))
    await securityPrReviewService.sync('s1')
    const [comment] = createReview.mock.calls[0][0].comments
    expect(comment).toEqual({
      path: 'lib/auth.ts',
      start_line: 11,
      start_side: 'RIGHT',
      line: 12,
      side: 'RIGHT',
      body: buildInlineComment(row(), undefined, SUGGESTION),
    })
  })

  it('anchors a single-line suggestion on its line, no start_line', async () => {
    const one = { startLine: 11, endLine: 11, code: 'return true' }
    findById.mockResolvedValue(scanRow([row({ codeSuggestion: one })]))
    await securityPrReviewService.sync('s1')
    const [comment] = createReview.mock.calls[0][0].comments
    expect(comment.line).toBe(11)
    expect('start_line' in comment).toBe(false)
    expect(comment.body).toContain('```suggestion\nreturn true\n```')
  })

  it('a stored range that no longer holds the line posts the plain comment', async () => {
    findById.mockResolvedValue(scanRow([row({ line: 30 })]))
    await securityPrReviewService.sync('s1')
    const [comment] = createReview.mock.calls[0][0].comments
    expect(comment).toEqual({
      path: 'lib/auth.ts',
      line: 30,
      side: 'RIGHT',
      body: buildInlineComment(row({ line: 30 })),
    })
  })

  it('LOW findings are unchanged: still no inline comment, suggestion or not', async () => {
    findById.mockResolvedValue(scanRow([row({ severity: 'LOW' })]))
    await securityPrReviewService.sync('s1')
    expect(createReview).not.toHaveBeenCalled()
  })

  it('when GitHub refuses the suggestion range, re-posts the comments without suggestions', async () => {
    findById.mockResolvedValue(
      scanRow([
        row(),
        row({ id: 'f2', fingerprint: 'fp2', codeSuggestion: null, line: 13 }),
      ])
    )
    createReview
      .mockRejectedValueOnce(
        new GithubApiError(422, 'line must be part of the diff')
      )
      .mockResolvedValueOnce({ id: 3, html_url: 'https://gh/review' })
    const res = await securityPrReviewService.sync('s1')
    expect(createReview).toHaveBeenCalledTimes(2)
    const retried = createReview.mock.calls[1][0].comments
    expect(retried).toEqual([
      {
        path: 'lib/auth.ts',
        line: 11,
        side: 'RIGHT',
        body: buildInlineComment(row()),
      },
      {
        path: 'lib/auth.ts',
        line: 13,
        side: 'RIGHT',
        body: buildInlineComment(
          row({ id: 'f2', fingerprint: 'fp2', line: 13 })
        ),
      },
    ])
    expect(res.inline).toBe(2)
  })

  it('a 422 with no suggestion in the review is not retried', async () => {
    findById.mockResolvedValue(scanRow([row({ codeSuggestion: null })]))
    createReview.mockRejectedValueOnce(new GithubApiError(422, 'stale'))
    const res = await securityPrReviewService.sync('s1')
    expect(createReview).toHaveBeenCalledTimes(1)
    expect(res).toEqual(expect.objectContaining({ inline: 0, skipped: 1 }))
  })
})

describe('LUM-1150 overlapping suggestions in one review', () => {
  const at = (startLine: number, endLine: number) => ({
    startLine,
    endLine,
    code: `// fix ${startLine}-${endLine}`,
  })
  const bodies = () =>
    createReview.mock.calls[0][0].comments as Array<{
      path: string
      line: number
      start_line?: number
      body: string
    }>

  it('keeps only the higher-severity suggestion; the other comment stays, plain, on its own line', async () => {
    const medium = row({
      id: 'm',
      fingerprint: 'fpM',
      severity: 'MEDIUM',
      line: 11,
      codeSuggestion: at(10, 11),
    })
    const high = row({
      id: 'h',
      fingerprint: 'fpH',
      severity: 'HIGH',
      line: 12,
      codeSuggestion: at(11, 12),
    })
    findById.mockResolvedValue(scanRow([medium, high]))
    await securityPrReviewService.sync('s1')
    const comments = bodies()
    expect(comments).toHaveLength(2)
    const h = comments.find(c => c.body.includes('fpH'))!
    const m = comments.find(c => c.body.includes('fpM'))!
    expect(h.body).toContain('```suggestion')
    expect(h).toEqual(expect.objectContaining({ start_line: 11, line: 12 }))
    expect(m.body).toBe(buildInlineComment(medium))
    expect(m.line).toBe(11)
    expect('start_line' in m).toBe(false)
  })

  it('on equal severity the earlier range wins', async () => {
    const later = row({
      id: 'b',
      fingerprint: 'fpB',
      line: 12,
      codeSuggestion: at(12, 13),
    })
    const earlier = row({
      id: 'a',
      fingerprint: 'fpA',
      line: 11,
      codeSuggestion: at(11, 12),
    })
    findById.mockResolvedValue(scanRow([later, earlier]))
    await securityPrReviewService.sync('s1')
    const comments = bodies()
    expect(comments.find(c => c.body.includes('fpA'))!.body).toContain(
      '```suggestion'
    )
    expect(comments.find(c => c.body.includes('fpB'))!.body).toBe(
      buildInlineComment(later)
    )
  })

  it('disjoint ranges, and the same lines in another file, all keep their suggestions', async () => {
    findById.mockResolvedValue(
      scanRow([
        row({
          id: 'a',
          fingerprint: 'fpA',
          line: 11,
          codeSuggestion: at(11, 11),
        }),
        row({
          id: 'b',
          fingerprint: 'fpB',
          line: 12,
          codeSuggestion: at(12, 12),
        }),
        row({
          id: 'c',
          fingerprint: 'fpC',
          filePath: 'lib/other.ts',
          line: 11,
          codeSuggestion: at(11, 11),
        }),
      ])
    )
    await securityPrReviewService.sync('s1')
    for (const c of bodies()) expect(c.body).toContain('```suggestion')
  })
})

describe('LUM-1150 suggestionWinners', () => {
  it('picks one per overlapping range, ignores rows without a suggestion', () => {
    const r = (fp: string, severity: 'HIGH' | 'MEDIUM', a: number, b: number) =>
      row({
        fingerprint: fp,
        severity,
        line: a,
        codeSuggestion: { startLine: a, endLine: b, code: 'x' },
      })
    expect(
      [
        ...suggestionWinners([
          r('m', 'MEDIUM', 10, 12),
          r('h', 'HIGH', 12, 13),
          r('far', 'MEDIUM', 20, 21),
          row({ fingerprint: 'none', codeSuggestion: null }),
        ]),
      ].sort()
    ).toEqual(['far', 'h'])
  })
})
