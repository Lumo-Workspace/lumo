import {
  acceptanceCriterionInputSchema,
  criteriaCountWarning,
  machineVerdictInputSchema,
} from '@/lib/validation/acceptance'

const H = { verifierType: 'HUMAN' as const }
const M = { verifierType: 'MACHINE' as const }
const humans = (n: number) => Array(n).fill(H)

describe('criteriaCountWarning (soft cap — warns, never rejects)', () => {
  it('is null inside the 3–7 human range', () => {
    for (const n of [3, 4, 5, 6, 7])
      expect(criteriaCountWarning(humans(n))).toBeNull()
  })
  it('warns above max on human count', () => {
    expect(criteriaCountWarning(humans(8))).toMatch(
      /exceeds the recommended maximum/
    )
  })
  it('warns below min on total', () => {
    expect(criteriaCountWarning(humans(2))).toMatch(
      /below the recommended minimum/
    )
  })
  it('mentions micro task below min', () => {
    expect(criteriaCountWarning(humans(1))).toMatch(/fine for a micro task/)
    expect(criteriaCountWarning(humans(2))).toMatch(/fine for a micro task/)
  })
  it('machine checks do not count toward the max', () => {
    expect(
      criteriaCountWarning([...Array(20).fill(M), ...humans(5)])
    ).toBeNull()
  })
})

describe('acceptanceCriterionInputSchema', () => {
  const base = {
    statement: 'all jest suites pass',
    source: 'AGENT_DRAFT' as const,
  }

  it('accepts a MACHINE criterion with a checkpointer', () => {
    const parsed = acceptanceCriterionInputSchema.safeParse({
      ...base,
      verifierType: 'MACHINE',
      checkpointer: 'npx jest',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a MACHINE criterion without a checkpointer', () => {
    const parsed = acceptanceCriterionInputSchema.safeParse({
      ...base,
      verifierType: 'MACHINE',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['checkpointer'])
    }
  })

  it('accepts a HUMAN criterion without a checkpointer (the demotion target for un-checkable MACHINE drafts)', () => {
    const parsed = acceptanceCriterionInputSchema.safeParse({
      ...base,
      verifierType: 'HUMAN',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a negative addedAtRound', () => {
    const parsed = acceptanceCriterionInputSchema.safeParse({
      ...base,
      verifierType: 'HUMAN',
      addedAtRound: -1,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('machineVerdictInputSchema (agent-facing — the schema-layer red line)', () => {
  it('has no way to express a verifierType (hard-coded MACHINE server-side)', () => {
    const parsed = machineVerdictInputSchema.safeParse({
      criterionId: 'c-1',
      verdict: 'PASS',
      evidencePointer: 'jest run #42',
      verifierType: 'HUMAN',
    })
    // .strict() — an injected verifierType is rejected, not silently dropped
    expect(parsed.success).toBe(false)
  })

  it('rejects the human-only PASS_WITH_FOLLOWUP verdict', () => {
    const parsed = machineVerdictInputSchema.safeParse({
      criterionId: 'c-1',
      verdict: 'PASS_WITH_FOLLOWUP',
      evidencePointer: 'x',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a PASS without an evidencePointer', () => {
    const parsed = machineVerdictInputSchema.safeParse({
      criterionId: 'c-1',
      verdict: 'PASS',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['evidencePointer'])
    }
  })

  it('accepts a PASS with evidence and a FAIL without it', () => {
    expect(
      machineVerdictInputSchema.safeParse({
        criterionId: 'c-1',
        verdict: 'PASS',
        // LUM-343 tightened evidence to enumerated pointer shapes — free text
        // ('jest run #42') is no longer legal evidence.
        evidencePointer: 'cmd:npx jest#exit=0',
      }).success
    ).toBe(true)
    expect(
      machineVerdictInputSchema.safeParse({
        criterionId: 'c-1',
        verdict: 'FAIL',
        rejectionReason: '2 suites failing',
        rejectionReasonEnum: 'CRITERION_UNMET',
      }).success
    ).toBe(true)
  })
})
