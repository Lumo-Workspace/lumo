import {
  machineVerdictInputSchema,
  machineRoundBodySchema,
  criteriaSetBodySchema,
} from '@/lib/validation/acceptance'
import {
  isValidEvidencePointer,
  buildCmdEvidencePointer,
  EVIDENCE_POINTER_MAX,
} from '../shared/src/acceptance-evidence'

function verdict(over: Record<string, unknown> = {}) {
  return {
    criterionId: 'c-1',
    verdict: 'PASS',
    evidencePointer: 'cmd:npx jest#exit=0',
    ...over,
  }
}

describe('machineVerdictInputSchema — red line', () => {
  it('accepts a PASS with a cmd evidence pointer', () => {
    expect(machineVerdictInputSchema.safeParse(verdict()).success).toBe(true)
  })

  it('has no verifierType field — strict schema rejects it', () => {
    const r = machineVerdictInputSchema.safeParse(
      verdict({ verifierType: 'HUMAN' })
    )
    expect(r.success).toBe(false)
  })

  it('rejects human-vocabulary verdicts (PASS_WITH_FOLLOWUP)', () => {
    const r = machineVerdictInputSchema.safeParse(
      verdict({ verdict: 'PASS_WITH_FOLLOWUP' })
    )
    expect(r.success).toBe(false)
  })

  it('rejects a PASS without evidence', () => {
    const r = machineVerdictInputSchema.safeParse(
      verdict({ evidencePointer: undefined })
    )
    expect(r.success).toBe(false)
  })

  it('allows a FAIL without evidence but with a reason', () => {
    const r = machineVerdictInputSchema.safeParse(
      verdict({
        verdict: 'FAIL',
        evidencePointer: undefined,
        rejectionReason: 'tests failed',
        rejectionReasonEnum: 'CRITERION_UNMET',
      })
    )
    expect(r.success).toBe(true)
  })
})

describe('evidencePointer format gate (superRefine)', () => {
  it.each([
    'commit:abc1234',
    'commit:0123456789abcdef0123456789abcdef01234567',
    'file:lib/services/task-verification.service.ts:42',
    'file:lib/foo.ts:10-25',
    'cmd:npx jest __tests__/x.test.ts#exit=0',
    'cmd:npm test -- -t "escalation"#exit=2',
  ])('accepts %s', ptr => {
    expect(isValidEvidencePointer(ptr)).toBe(true)
    expect(
      machineVerdictInputSchema.safeParse(verdict({ evidencePointer: ptr }))
        .success
    ).toBe(true)
  })

  it.each([
    'I looked at the code and it seems right',
    'commit:xyz', // not hex
    'commit:abc12', // too short
    'file:lib/foo.ts', // no line number
    'file:has space.ts:3',
    'cmd:npx jest', // no exit marker
    'see PR #455',
  ])('rejects free text / malformed: %s', ptr => {
    expect(isValidEvidencePointer(ptr)).toBe(false)
    expect(
      machineVerdictInputSchema.safeParse(verdict({ evidencePointer: ptr }))
        .success
    ).toBe(false)
  })

  it('buildCmdEvidencePointer keeps the exit marker under the length cap', () => {
    const long = 'npx jest ' + 'a'.repeat(3000)
    const ptr = buildCmdEvidencePointer(long, 1)
    expect(ptr.length).toBeLessThanOrEqual(EVIDENCE_POINTER_MAX)
    expect(ptr.startsWith('cmd:npx jest ')).toBe(true)
    expect(ptr.endsWith('#exit=1')).toBe(true)
    expect(isValidEvidencePointer(ptr)).toBe(true)
  })
})

describe('machineRoundBodySchema', () => {
  it('accepts a round of verdicts', () => {
    const r = machineRoundBodySchema.safeParse({ results: [verdict()] })
    expect(r.success).toBe(true)
  })

  it('rejects an empty round and unknown keys', () => {
    expect(machineRoundBodySchema.safeParse({ results: [] }).success).toBe(
      false
    )
    expect(
      machineRoundBodySchema.safeParse({
        results: [verdict()],
        verifierType: 'HUMAN',
      }).success
    ).toBe(false)
  })
})

describe('criteriaSetBodySchema causeTag', () => {
  // LUM-733: PENDING_OUTCOME is no longer a task-criterion kind — a HUMAN
  // criterion may only declare EXTERNAL_FACT | AGENT_CONSTRUCTED_STATE.
  const items = [
    {
      statement: 's',
      verifierType: 'HUMAN',
      referentKind: 'AGENT_CONSTRUCTED_STATE',
    },
  ]

  it('accepts a causeTag on HUMAN_EDIT', () => {
    const r = criteriaSetBodySchema.safeParse({
      source: 'HUMAN_EDIT',
      criteria: items,
      causeTag: 'SCOPE_CHANGE',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a causeTag on AGENT_DRAFT and unknown tags', () => {
    expect(
      criteriaSetBodySchema.safeParse({
        source: 'AGENT_DRAFT',
        criteria: items,
        causeTag: 'SCOPE_CHANGE',
      }).success
    ).toBe(false)
    expect(
      criteriaSetBodySchema.safeParse({
        source: 'HUMAN_EDIT',
        criteria: items,
        causeTag: 'BECAUSE',
      }).success
    ).toBe(false)
  })
})
