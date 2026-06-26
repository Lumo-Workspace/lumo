/**
 * LUM-564 — 規律2 声称vs核验: the agent's CLAIM (its run summary, "what it says
 * it did") must sit beside the measured verification conclusion, so the
 * "two-column" contrast is two populated columns, not just the verification
 * one. Two layers:
 *   1. selectClaim (service) picks the claim from the latest session's run
 *      material by the SAME two-layer rule the web card uses for
 *      latestRunSummary — LLM run summary, else STOP turn digest, else null —
 *      so the CLI and web claim are same-source and cannot drift.
 *   2. formatTaskStatus renders the "Claim vs verification" pairing: the claim
 *      tagged as an unverified self-report (estimate-tier — 估, not 测) against
 *      the measured verdict (测), fail-closed when either side is absent.
 */
import { selectClaim } from '../lib/services/task-claim'
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../cli/src/commands/task-status'

function baseResponse(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-564',
      title: 'demo',
      status: 'IN_REVIEW',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

function passingMachineCriterion(
  id: string
): TaskStatusResponse['criteria'][number] {
  return {
    id,
    statement: `does the thing ${id}`,
    verifierType: 'MACHINE',
    checkpointer: 'npx jest x',
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    verdictStale: false,
    checkMismatch: false,
    machinePassed: true,
    latestVerdict: {
      round: 1,
      verdict: 'PASS',
      evidencePointer: 'cmd:npx jest x#exit=0',
      rejectionReason: null,
      rejectionReasonEnum: null,
      recordedAt: '2026-06-02T10:00:00Z',
    },
    sendBackResolution: null,
  }
}

describe('selectClaim (service — same-source two-layer rule)', () => {
  it('claim selection prefers run summary then digest then null', () => {
    // 1) LLM run summary wins even when a digest is also present, and is trimmed.
    expect(
      selectClaim({
        runSummary: '  Refactored the parser.  ',
        turnSummaries: ['ran tests', 'fixed lint'],
      })
    ).toEqual({ text: 'Refactored the parser.', source: 'RUN_SUMMARY' })

    // 2) No run summary → fall back to the turn digest, joined ' · ', empties
    //    dropped, capped to the last 5 lines (mirrors web deriveRunDigest).
    expect(
      selectClaim({
        runSummary: null,
        turnSummaries: ['a', '   ', 'b', 'c', 'd', 'e', 'f'],
      })
    ).toEqual({ text: 'b · c · d · e · f', source: 'DIGEST' })

    // 3) An empty/whitespace run summary is treated as absent (falls to digest).
    expect(
      selectClaim({ runSummary: '   ', turnSummaries: ['only line'] })
    ).toEqual({ text: 'only line', source: 'DIGEST' })

    // 4) Neither source → null claim (no fabrication).
    expect(selectClaim({ runSummary: null, turnSummaries: [] })).toEqual({
      text: null,
      source: null,
    })
    expect(selectClaim({ runSummary: '', turnSummaries: ['  ', ''] })).toEqual({
      text: null,
      source: null,
    })

    // 5) No session at all → null claim.
    expect(selectClaim(null)).toEqual({ text: null, source: null })
  })
})

describe('formatTaskStatus — Claim vs verification pairing (LUM-564)', () => {
  it('task status pairs claim alongside verification conclusion', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [
          passingMachineCriterion('c-1'),
          passingMachineCriterion('c-2'),
        ],
        machineVerification: {
          total: 2,
          machineVerified: 2,
          humanOverridden: 0,
        },
        claim: {
          text: 'Added the claim column to task status',
          source: 'RUN_SUMMARY',
        },
      })
    )

    // The pairing section exists, with BOTH columns populated.
    expect(out).toContain('Claim vs verification:')
    // Claim side: the agent's self-report text.
    expect(out).toContain('Added the claim column to task status')
    // LUM-597: a RUN_SUMMARY claim is a summarizer paraphrase fallback (no
    // agent self-report), labelled SYNTHESIZED rather than the authoritative
    // "agent self-report" source.
    expect(out).toContain('↳ source: synthesized run summary (no self-report)')
    // Verification side: the measured machine-verification conclusion.
    expect(out).toContain(
      '2 machine-verified / 0 human override (of 2 MACHINE criteria)'
    )
    expect(out).toContain('2 of 2 criteria met by their latest verdict')

    // The two columns sit together — claim before verification, the whole
    // pairing ahead of the per-criterion Criteria list.
    const claimIdx = out.indexOf('▸ Claim')
    const verifyIdx = out.indexOf('▸ Verification')
    const criteriaIdx = out.indexOf('Criteria (2 total')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(verifyIdx).toBeGreaterThan(claimIdx)
    expect(criteriaIdx).toBeGreaterThan(verifyIdx)

    // The relocated machine-verification rollup is NOT also printed as a
    // standalone line in the criteria header (no duplication).
    const rollup =
      '2 machine-verified / 0 human override (of 2 MACHINE criteria)'
    expect(out.split(rollup).length - 1).toBe(1)
  })

  it('claim is labeled self report and fails closed when absent', () => {
    // Estimate-tier provenance: the claim side is explicitly an unverified
    // self-report, distinct from the measured verification side.
    const withClaim = formatTaskStatus(
      baseResponse({
        criteria: [passingMachineCriterion('c-1')],
        machineVerification: {
          total: 1,
          machineVerified: 1,
          humanOverridden: 0,
        },
        claim: { text: 'did some work', source: 'DIGEST' },
      })
    )
    expect(withClaim).toContain('agent self-report')
    expect(withClaim).toContain('estimated, not verification')
    expect(withClaim).toContain('what was actually confirmed (measured)')
    // LUM-583 ③ / LUM-574: a digest-sourced claim is NOT a formal run summary —
    // the raw digest is withheld and the line says it's still generating, rather
    // than dumping the digest as if it were the agent's report.
    expect(withClaim).toContain(
      'generating — the formal run summary is still being synthesized'
    )
    expect(withClaim).not.toContain('did some work')

    // Fail-closed: no claim → an explicit not-generated line, never a fabricated
    // claim. (claim field omitted entirely — older server / in-flight task.)
    const noClaim = formatTaskStatus(
      baseResponse({ criteria: [passingMachineCriterion('c-1')] })
    )
    expect(noClaim).toContain('Claim vs verification:')
    expect(noClaim).toMatch(/not generated yet/i)
    expect(noClaim).toMatch(/synthesized when the task reaches DONE/i)

    // Fail-closed on the verification side too: nothing verified yet → the
    // claim is explicitly unconfirmed, never an implied pass.
    const unverified = formatTaskStatus(
      baseResponse({
        currentRound: 0,
        criteria: [passingMachineCriterion('c-1')],
        claim: { text: 'I finished everything', source: 'RUN_SUMMARY' },
      })
    )
    expect(unverified).toContain('I finished everything')
    expect(unverified).toMatch(/no verification has run yet/i)
    expect(unverified).toMatch(/the claim is unconfirmed/i)
  })

  // LUM-583: the faithfulness third state — does the claim itself match the
  // delivery — surfaced same-source with the web honest report.
  it('renders the faithfulness conclusion with its verdict and evidence pointer', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [passingMachineCriterion('c-1')],
        claim: { text: 'I refactored everything', source: 'RUN_SUMMARY' },
        faithfulness: {
          state: 'OVERSTATED',
          verdict: 'OVERSTATED',
          evidence: ['claim exceeds the diff'],
          reasoning: 'overclaim',
          diffShas: ['a1b2c3d4e5'],
          prNumbers: [710],
          judgedAt: '2026-06-20T12:00:00.000Z',
          judgedClaimAt: '2026-06-20T10:00:00.000Z',
        },
      })
    )
    expect(out).toMatch(/Faithfulness — does the claim match the delivery/)
    expect(out).toContain('overstated')
    expect(out).toContain('evidence: PR #710 · a1b2c3d')
  })

  it('reads PENDING distinctly from a UNJUDGEABLE verdict, and flags STALE', () => {
    const pending = formatTaskStatus(
      baseResponse({
        criteria: [passingMachineCriterion('c-1')],
        faithfulness: {
          state: 'PENDING',
          verdict: null,
          evidence: [],
          reasoning: null,
          diffShas: [],
          prNumbers: [],
          judgedAt: null,
          judgedClaimAt: null,
        },
      })
    )
    expect(pending).toMatch(/not yet judged/i)
    expect(pending).not.toMatch(/unjudgeable/i)

    const stale = formatTaskStatus(
      baseResponse({
        criteria: [passingMachineCriterion('c-1')],
        faithfulness: {
          state: 'STALE',
          verdict: 'FAITHFUL',
          evidence: [],
          reasoning: null,
          diffShas: [],
          prNumbers: [],
          judgedAt: '2026-06-20T12:00:00.000Z',
          judgedClaimAt: '2026-06-20T10:00:00.000Z',
        },
      })
    )
    expect(stale).toMatch(/faithful/i)
    expect(stale).toMatch(/stale — re-checked on the next batch/i)
  })

  // Older server that doesn't emit faithfulness → the section is simply absent,
  // never fabricated.
  it('omits the faithfulness line when the server did not emit the field', () => {
    const out = formatTaskStatus(
      baseResponse({
        criteria: [passingMachineCriterion('c-1')],
        claim: { text: 'work', source: 'RUN_SUMMARY' },
      })
    )
    expect(out).not.toMatch(/Faithfulness — does the claim match/)
  })
})
