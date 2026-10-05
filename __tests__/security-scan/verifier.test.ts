/** @jest-environment node */
import {
  VERIFIER_HOLD_MS,
  applyVerifierPolicy,
  isVerifierRejected,
  verifierAppliesTo,
  verifierHolding,
  verifierKindOf,
} from '@/lib/security-scan/verifier'

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
