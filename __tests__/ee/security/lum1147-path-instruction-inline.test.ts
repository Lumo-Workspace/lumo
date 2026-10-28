/**
 * @jest-environment node
 *
 * LUM-1147 follow-up — a finding the AI review reported because a
 * repository path instruction asked for it is commented INLINE under chill
 * and assertive, whatever severity the model gave it (production TC5: a
 * `scripts/**=Flag any console.log` finding rated LOW was summary-only under
 * chill, so nothing appeared on the diff). Quiet keeps it in the summary.
 * The marker is the model's claim, kept only when that instruction was sent
 * for the finding's file.
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))
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
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn().mockResolvedValue(undefined),
  },
}))
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

import { generateObject } from 'ai'
import {
  planPathInstructions,
  verifyPathInstructionClaim,
} from '@/ee/security/security-scan/path-instructions'
import {
  heldByProfile,
  inlineEligibleUnder,
  REVIEW_PROFILE_DESCRIPTIONS,
  type ProfileFinding,
} from '@/ee/security/security-scan/review-profile'
import { DEFAULT_SECURITY_POLICY } from '@/ee/security/security-scan/policy'
import {
  judgeSecurity,
  SecurityJudgeSchema,
} from '@/ee/security/llm/security-judge-client'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import type { ReviewFindingRow } from '@/ee/security/repositories/pr-security-scan.repository'
import { guardPromptLineText } from '@/lib/security-scan/inject-guard'

const P = DEFAULT_SECURITY_POLICY
const id = (s: string) => s

const LIST = [
  { path: 'scripts/**', instructions: 'Flag any console.log.' },
  { path: '*.sql', instructions: 'Every query needs a LIMIT.' },
]

describe('planPathInstructions — what was sent', () => {
  it('returns the block and exactly the entries in it', () => {
    const plan = planPathInstructions(LIST, ['scripts/probe.ts'], id)
    expect(plan.text).toBe('- [scripts/**] Flag any console.log.')
    expect(plan.sent).toEqual([LIST[0]])
  })

  it('nothing matches → empty block, nothing sent', () => {
    expect(planPathInstructions(LIST, ['lib/a.ts'], id)).toEqual({
      text: '',
      sent: [],
    })
  })

  it('an entry cut by the size cap is not "sent"', () => {
    const long = Array.from({ length: 6 }, (_, i) => ({
      path: `d${i}/**`,
      instructions: 'x'.repeat(900),
    }))
    const plan = planPathInstructions(
      long,
      long.map((_, i) => `d${i}/f.ts`),
      id
    )
    expect(plan.sent.length).toBeGreaterThan(0)
    expect(plan.sent.length).toBeLessThan(long.length)
    expect(plan.text.split('\n')).toHaveLength(plan.sent.length)
  })
})

describe('verifyPathInstructionClaim — never trust an unmatched claim', () => {
  const sent = [LIST[0]!]
  const check = (claim: unknown, file = 'scripts/probe.ts') =>
    verifyPathInstructionClaim(claim, file, sent, guardPromptLineText)

  it('a sent glob matching the finding file is kept', () => {
    expect(check('scripts/**')).toBe('scripts/**')
    expect(check(' [scripts/**] ')).toBe('scripts/**')
  })

  it('a glob that was not sent, does not match the file, or is no string is dropped', () => {
    expect(check('*.sql', 'q.sql')).toBeNull()
    expect(check('scripts/**', 'lib/a.ts')).toBeNull()
    expect(check('**')).toBeNull()
    expect(check('')).toBeNull()
    expect(check(null)).toBeNull()
    expect(check(undefined)).toBeNull()
    expect(check(42)).toBeNull()
  })
})

describe('the profile rule for path-instruction findings', () => {
  const f = (over: Partial<ProfileFinding> = {}): ProfileFinding => ({
    ruleId: 'vuln:sql_injection',
    line: 3,
    severity: 'LOW',
    provenance: 'LLM_JUDGE',
    disposition: null,
    suggestedDisposition: null,
    ...over,
  })

  it.each(['LOW', 'MEDIUM'] as const)(
    '%s with a path instruction: inline under chill and assertive, summary under quiet',
    severity => {
      const row = f({ severity, pathInstruction: 'scripts/**' })
      expect(inlineEligibleUnder('chill', row, P)).toBe(true)
      expect(inlineEligibleUnder('assertive', row, P)).toBe(true)
      expect(inlineEligibleUnder('quiet', row, P)).toBe(false)
      // quiet lists it in the summary instead of dropping it.
      expect(heldByProfile('quiet', row, P)).toBe(true)
    }
  )

  it('without the marker a LOW finding stays summary-only under chill', () => {
    expect(inlineEligibleUnder('chill', f(), P)).toBe(false)
    expect(inlineEligibleUnder('chill', f({ pathInstruction: null }), P)).toBe(
      false
    )
  })

  it('the marker never puts a line-less or suggested-FP finding inline', () => {
    const marked = { pathInstruction: 'scripts/**' }
    expect(inlineEligibleUnder('chill', f({ ...marked, line: null }), P)).toBe(
      false
    )
    expect(
      inlineEligibleUnder(
        'chill',
        f({ ...marked, suggestedDisposition: 'FALSE_POSITIVE' }),
        P
      )
    ).toBe(false)
  })

  it('the profile descriptions state the rule', () => {
    expect(REVIEW_PROFILE_DESCRIPTIONS.chill).toContain('path instruction')
    expect(REVIEW_PROFILE_DESCRIPTIONS.quiet).toContain('path-instruction')
  })
})

describe('the AI review output carries the claim', () => {
  const gen = generateObject as jest.Mock
  afterEach(() => gen.mockReset())

  it('the finding schema has an optional `instruction` field', () => {
    const base = {
      kind: 'logic_error',
      severity: 'LOW',
      filePath: 'scripts/probe.ts',
      line: 3,
      title: 't',
      detail: 'd',
      evidence: 'e',
    }
    const parsed = SecurityJudgeSchema.parse({
      findings: [base, { ...base, instruction: 'scripts/**' }],
      prSummary: { intent: 'x', changes: [] },
    })
    expect(parsed.findings[0]!.instruction).toBeUndefined()
    expect(parsed.findings[1]!.instruction).toBe('scripts/**')
  })

  it('judgeSecurity passes the claim through, and asks for it when instructions are sent', async () => {
    gen.mockResolvedValue({
      object: {
        findings: [
          {
            kind: 'logic_error',
            severity: 'LOW',
            filePath: 'scripts/probe.ts',
            line: 3,
            title: 't',
            detail: 'd',
            evidence: 'e',
            instruction: 'scripts/**',
          },
        ],
        prSummary: { intent: 'x', changes: [] },
      },
    })
    const out = await judgeSecurity({
      diff: 'd',
      context: '',
      timeoutMs: 1000,
      pathInstructions: '- [scripts/**] Flag any console.log.',
    })
    expect(out.findings[0]!.instruction).toBe('scripts/**')
    expect(gen.mock.calls[0]![0].system).toContain('instruction field')
  })
})

// ── The TC5 scenario on the write-back ──────────────────────────────────

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const createReview = prCommentClient.createReview as jest.Mock

function finding(over: Partial<ReviewFindingRow> = {}): ReviewFindingRow {
  return {
    id: 'f',
    kind: 'CORRECTNESS',
    ruleId: 'review:logic_error',
    severity: 'LOW',
    provenance: 'LLM_JUDGE',
    filePath: 'scripts/probe.ts',
    line: 3,
    title: 'console.log left in a script',
    detail: 'The path instruction asks to flag every console.log.',
    fingerprint: 'fp',
    externalRef: null,
    disposition: null,
    persisting: false,
    suggestedDisposition: null,
    verifierVerdict: null,
    verifierReason: null,
    ...over,
  }
}

const ROWS = [
  finding({ id: 'pi', fingerprint: 'fpPI', pathInstruction: 'scripts/**' }),
  finding({ id: 'lo', fingerprint: 'fpLO', line: 4, title: 'Other nit' }),
]

function scanRow(profile: string | null) {
  return {
    id: 's1',
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    status: 'FINDINGS',
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    verifierStartedAt: new Date(0),
    verifiedAt: new Date(0),
    reviewProfile: profile,
    findings: ROWS,
    pullRequest: {
      repo: 'acme/app',
      number: 9,
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
  }
}

async function posted(profile: string | null): Promise<string[]> {
  findById.mockResolvedValue(scanRow(profile))
  await securityPrReviewService.sync('s1')
  const call = createReview.mock.calls[0]
  if (!call) return []
  return (call[0].comments as Array<{ body: string }>).map(
    c => /lumo-security:fp:(\S+) -->/.exec(c.body)![1]!
  )
}

function summaryBody(): string {
  return createIssue.mock.calls[0]![0].body as string
}

describe('TC5 — a LOW path-instruction finding on the diff', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
    ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
    ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
    createIssue.mockResolvedValue({ id: 1 })
    ;(prCommentClient.updateIssueComment as jest.Mock).mockResolvedValue({
      id: 1,
    })
    createReview.mockResolvedValue({ id: 2 })
  })

  it('chill (the default) comments it inline; the unmarked LOW stays one summary line', async () => {
    expect(await posted('chill')).toEqual(['fpPI'])
    expect(summaryBody()).toContain('1 low-severity finding')
  })

  it('a scan from before the profile column (null) behaves as chill', async () => {
    expect(await posted(null)).toEqual(['fpPI'])
  })

  it('assertive comments both', async () => {
    expect((await posted('assertive')).sort()).toEqual(['fpLO', 'fpPI'])
  })

  it('quiet keeps it off the diff and lists it in the summary (not also in the LOW count)', async () => {
    expect(await posted('quiet')).toEqual([])
    const body = summaryBody()
    expect(body).toContain(
      '1 more finding not commented on the diff (review profile: quiet)'
    )
    expect(body).toContain('console.log left in a script')
    expect(body).toContain('1 low-severity finding')
  })
})
