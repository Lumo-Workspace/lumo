/** @jest-environment node */
import {
  RANKER_KEEP_THRESHOLD,
  RANKER_REASON_PREFIX,
  VERIFIER_HOLD_MS,
  applyRankerPolicy,
  applyVerifierPolicy,
  isRankerExempt,
  isVerifierRejected,
  rankerMayReject,
  verifierAppliesTo,
  verifierHolding,
  verifierKindOf,
} from '@/ee/security/security-scan/verifier'

describe('LUM-988 verifier rules', () => {
  it('only an LLM_JUDGE row with a REJECTED verdict is rejected', () => {
    expect(
      isVerifierRejected({
        provenance: 'LLM_JUDGE',
        verifierVerdict: 'REJECTED',
      })
    ).toBe(true)
    expect(
      isVerifierRejected({
        provenance: 'LLM_JUDGE',
        verifierVerdict: 'CONFIRMED',
      })
    ).toBe(false)
    expect(
      isVerifierRejected({ provenance: 'LLM_JUDGE', verifierVerdict: null })
    ).toBe(false)
    expect(isVerifierRejected({ provenance: 'LLM_JUDGE' })).toBe(false)
    // A stray verdict can never hide a deterministic or external row.
    expect(
      isVerifierRejected({
        provenance: 'DETERMINISTIC',
        verifierVerdict: 'REJECTED',
      })
    ).toBe(false)
    expect(
      isVerifierRejected({
        provenance: 'EXTERNAL_TOOL',
        verifierVerdict: 'REJECTED',
      })
    ).toBe(false)
  })

  it('holds while started and unfinished, within the window', () => {
    const t0 = Date.parse('2026-10-05T00:00:00Z')
    const started = new Date(t0)
    expect(
      verifierHolding({ verifierStartedAt: null, verifiedAt: null }, t0)
    ).toBe(false)
    expect(
      verifierHolding(
        { verifierStartedAt: started, verifiedAt: null },
        t0 + 1000
      )
    ).toBe(true)
    expect(
      verifierHolding(
        { verifierStartedAt: started, verifiedAt: new Date(t0 + 5) },
        t0 + 1000
      )
    ).toBe(false)
    // Past the window a hung run no longer holds anything back.
    expect(
      verifierHolding(
        { verifierStartedAt: started, verifiedAt: null },
        t0 + VERIFIER_HOLD_MS + 1
      )
    ).toBe(false)
    expect(
      verifierHolding(
        { verifierStartedAt: started.toISOString(), verifiedAt: null },
        t0 + 1000
      )
    ).toBe(true)
  })

  it('applies verdicts only to non-HIGH CORRECTNESS rows, never defaulted ones', () => {
    expect(verifierAppliesTo({ kind: 'CORRECTNESS', severity: 'MEDIUM' })).toBe(
      true
    )
    expect(verifierAppliesTo({ kind: 'CORRECTNESS', severity: 'HIGH' })).toBe(
      false
    )
    expect(verifierAppliesTo({ kind: 'VULNERABILITY', severity: 'LOW' })).toBe(
      false
    )
    const findings = [
      { id: 'a', kind: 'CORRECTNESS', severity: 'MEDIUM' },
      { id: 'b', kind: 'CORRECTNESS', severity: 'HIGH' },
      { id: 'c', kind: 'VULNERABILITY', severity: 'MEDIUM' },
      { id: 'd', kind: 'CORRECTNESS', severity: 'LOW' },
    ]
    const out = applyVerifierPolicy(findings, [
      {
        id: 'a',
        verdict: 'REJECTED',
        reason: 'guarded at x.ts:3',
        defaulted: false,
      },
      { id: 'b', verdict: 'REJECTED', reason: 'r', defaulted: false },
      { id: 'c', verdict: 'REJECTED', reason: 'r', defaulted: false },
      { id: 'd', verdict: 'CONFIRMED', reason: '', defaulted: true },
      { id: 'zz', verdict: 'REJECTED', reason: 'r', defaulted: false },
    ])
    expect(out).toEqual([
      { findingId: 'a', verdict: 'REJECTED', reason: 'guarded at x.ts:3' },
    ])
  })

  it('tells the verifier the review kind from the rule id', () => {
    expect(verifierKindOf('review:logic_error')).toBe('logic_error')
    expect(verifierKindOf('vuln:xss')).toBe('xss')
    expect(verifierKindOf('secret:llm-hardcoded-credential')).toBe(
      'hardcoded_credential'
    )
    expect(verifierKindOf('plain')).toBe('plain')
  })
})

describe('LUM-988 ranker policy', () => {
  const rows = [
    {
      id: 'low',
      kind: 'CORRECTNESS',
      severity: 'MEDIUM',
      ruleId: 'review:logic_error',
      filePath: 'src/a.ts',
    },
    {
      id: 'keep',
      kind: 'CORRECTNESS',
      severity: 'LOW',
      ruleId: 'review:logic_error',
      filePath: 'src/a.ts',
    },
    {
      id: 'high',
      kind: 'CORRECTNESS',
      severity: 'HIGH',
      ruleId: 'review:logic_error',
      filePath: 'src/a.ts',
    },
    {
      id: 'sec',
      kind: 'VULNERABILITY',
      severity: 'LOW',
      ruleId: 'vuln:xss',
      filePath: 'src/a.ts',
    },
    {
      id: 'gone',
      kind: 'CORRECTNESS',
      severity: 'LOW',
      ruleId: 'review:logic_error',
      filePath: 'src/a.ts',
    },
    {
      id: 'unranked',
      kind: 'CORRECTNESS',
      severity: 'LOW',
      ruleId: 'review:logic_error',
      filePath: 'src/a.ts',
    },
  ]

  it('rejects only an applicable row ranked below the threshold, with a marked reason', () => {
    const out = applyRankerPolicy(
      rows,
      [
        { id: 'low', p: RANKER_KEEP_THRESHOLD - 1, reason: 'speculative' },
        { id: 'keep', p: RANKER_KEEP_THRESHOLD, reason: 'real' },
        { id: 'high', p: 0, reason: 'x' },
        { id: 'sec', p: 0, reason: 'x' },
        { id: 'gone', p: 0, reason: 'x' },
        { id: 'stranger', p: 0, reason: 'x' },
      ],
      new Set(['gone'])
    )
    expect(out).toEqual([
      {
        findingId: 'low',
        verdict: 'REJECTED',
        reason: `${RANKER_REASON_PREFIX} speculative`,
      },
    ])
  })

  it('a row the ranking omits, or lists twice, is decided once and never lost by omission', () => {
    const out = applyRankerPolicy(
      rows,
      [
        { id: 'low', p: 90, reason: 'first' },
        { id: 'low', p: 0, reason: 'duplicate' },
      ],
      new Set()
    )
    expect(out).toEqual([])
  })

  it('LUM-1194: never removes a test_defect finding, however low it is ranked', () => {
    const out = applyRankerPolicy(
      [
        {
          id: 't',
          kind: 'CORRECTNESS',
          severity: 'LOW',
          ruleId: 'review:test_defect',
          filePath: 'src/a.ts',
        },
        {
          id: 'd',
          kind: 'CORRECTNESS',
          severity: 'LOW',
          ruleId: 'review:doc_mismatch',
          filePath: 'src/a.ts',
        },
      ],
      [
        { id: 't', p: 0, reason: 'test tidiness' },
        { id: 'd', p: 0, reason: 'minor' },
      ],
      new Set()
    )
    expect(out.map(v => v.findingId)).toEqual(['d'])
    expect(
      rankerMayReject({
        kind: 'CORRECTNESS',
        severity: 'LOW',
        ruleId: 'review:test_defect',
        filePath: 'src/a.ts',
      })
    ).toBe(false)
    expect(
      rankerMayReject({
        kind: 'CORRECTNESS',
        severity: 'LOW',
        ruleId: 'review:logic_error',
        filePath: 'src/a.ts',
      })
    ).toBe(true)
    expect(
      rankerMayReject({
        kind: 'CORRECTNESS',
        severity: 'HIGH',
        ruleId: 'review:logic_error',
        filePath: 'src/a.ts',
      })
    ).toBe(false)
    // The verifier still judges test findings: only the ranker's prior is off.
    expect(verifierAppliesTo({ kind: 'CORRECTNESS', severity: 'LOW' })).toBe(
      true
    )
  })

  it('LUM-1194: a finding that cites a test file is a test finding, whatever its kind', () => {
    const race = {
      id: 'r',
      kind: 'CORRECTNESS',
      severity: 'MEDIUM',
      ruleId: 'review:concurrency',
      filePath: 'pkg/cache/upstream/cache_test.go',
    }
    expect(rankerMayReject(race)).toBe(false)
    expect(
      applyRankerPolicy(
        [race],
        [{ id: 'r', p: 7, reason: 'test only' }],
        new Set()
      )
    ).toEqual([])
    expect(isRankerExempt('concurrency', 'src/__tests__/a.test.ts')).toBe(true)
    expect(isRankerExempt('test_defect', 'src/a.rs')).toBe(true)
    expect(isRankerExempt('logic_error', 'src/latest.ts')).toBe(false)
  })

  it('the threshold is the one measured on the replay', () => {
    expect(RANKER_KEEP_THRESHOLD).toBe(18)
  })
})
