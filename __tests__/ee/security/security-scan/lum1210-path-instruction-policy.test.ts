/** @jest-environment node */
/**
 * LUM-1210 — a finding the owners' path instruction asked for (a verified
 * `pathInstruction` claim) is outside the verifier / ranker removal policy,
 * like HIGH and security rows: on a controlled set the review applied a
 * concrete instruction in 17 of 18 runs, and the verifier ("no such rule in
 * the repository") and the ranker ("style") removed every genuine one.
 */
import {
  RANKER_KEEP_THRESHOLD,
  applyRankerPolicy,
  applyVerifierPolicy,
  verifierAppliesTo,
} from '@/ee/security/security-scan/verifier'
import { keptLumoFindings } from '@/scripts/analysis/lum1158-review-quality-bench/bench-lib'
import { withVerifiedInstructionClaims } from '@/scripts/analysis/lum1158-review-quality-bench/path-instructions-input'

describe('LUM-1210 removal policy and path-instruction findings', () => {
  it('the verifier policy never applies to a row carrying a verified path instruction', () => {
    expect(
      verifierAppliesTo({
        kind: 'CORRECTNESS',
        severity: 'LOW',
        pathInstruction: 'scripts/**',
      })
    ).toBe(false)
    // No claim (absent, null, empty) — unchanged.
    expect(verifierAppliesTo({ kind: 'CORRECTNESS', severity: 'LOW' })).toBe(
      true
    )
    expect(
      verifierAppliesTo({
        kind: 'CORRECTNESS',
        severity: 'MEDIUM',
        pathInstruction: null,
      })
    ).toBe(true)
    expect(
      verifierAppliesTo({
        kind: 'CORRECTNESS',
        severity: 'MEDIUM',
        pathInstruction: '',
      })
    ).toBe(true)
  })

  it('neither a verifier rejection nor a low rank removes it; other rows are unchanged', () => {
    const rows = [
      {
        id: 'asked',
        kind: 'CORRECTNESS',
        severity: 'LOW',
        ruleId: 'review:api_misuse',
        filePath: 'scripts/probe.ts',
        pathInstruction: 'scripts/**',
      },
      {
        id: 'plain',
        kind: 'CORRECTNESS',
        severity: 'LOW',
        ruleId: 'review:api_misuse',
        filePath: 'scripts/probe.ts',
      },
    ]
    expect(
      applyVerifierPolicy(rows, [
        { id: 'asked', verdict: 'REJECTED', reason: 'r', defaulted: false },
        { id: 'plain', verdict: 'REJECTED', reason: 'r', defaulted: false },
      ]).map(v => v.findingId)
    ).toEqual(['plain'])
    expect(
      applyRankerPolicy(
        rows,
        [
          { id: 'asked', p: 0, reason: 'style' },
          { id: 'plain', p: RANKER_KEEP_THRESHOLD - 1, reason: 'style' },
        ],
        new Set()
      ).map(v => v.findingId)
    ).toEqual(['plain'])
  })
})

describe('LUM-1210 benchmark mirror', () => {
  const finding = (over: Record<string, unknown> = {}) => ({
    kind: 'api_misuse',
    severity: 'LOW',
    filePath: 'scripts/probe.ts',
    line: 61,
    title: 'console.log in a script',
    detail: 'd',
    ...over,
  })

  it('keptLumoFindings keeps a verified path-instruction finding the verifier or ranker would drop', () => {
    const run = {
      findings: [
        finding({ pathInstruction: 'scripts/**' }),
        finding({ title: 'plain' }),
        finding({ title: 'asked, ranked low', pathInstruction: 'scripts/**' }),
      ],
    }
    const kept = keptLumoFindings(
      run,
      {
        results: [
          { id: 'f0', verdict: 'REJECTED' },
          { id: 'f1', verdict: 'REJECTED' },
        ],
      },
      { ranking: [{ id: 'f2', p: 1 }] }
    )
    expect(kept!.map(f => f.id)).toEqual(['f0', 'f2'])
  })

  it('withVerifiedInstructionClaims stores only claims production would keep', () => {
    const sent = [{ path: 'scripts/**', instructions: 'Flag console.log' }]
    const out = withVerifiedInstructionClaims(
      [
        finding({ instruction: 'scripts/**' }),
        finding({ instruction: '[scripts/**]' }),
        // glob not sent
        finding({ instruction: 'lib/**' }),
        // sent glob, but the finding's file does not match it
        finding({ instruction: 'scripts/**', filePath: 'lib/a.ts' }),
        finding({ instruction: null }),
        finding(),
      ],
      sent
    )
    expect(out.map(f => f.pathInstruction)).toEqual([
      'scripts/**',
      'scripts/**',
      null,
      null,
      null,
      null,
    ])
    // The model's raw claim is kept as reported.
    expect((out[2] as { instruction?: unknown }).instruction).toBe('lib/**')
  })
})
