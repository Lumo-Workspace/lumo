import { agentVerdictBodySchema } from '@/lib/validation/acceptance'

/**
 * LUM-422 ② red line: the agent send-back schema can never express a passing
 * verdict. It has NO verdict field at all (the service hard-codes FAIL), so
 * PASS / PASS_WITH_FOLLOWUP are unrepresentable — and the structured rejection
 * enum is required (the agent pays the tax a human is spared).
 */
describe('agentVerdictBodySchema', () => {
  it('accepts a minimal send-back: just the required rejectionReasonEnum', () => {
    expect(
      agentVerdictBodySchema.safeParse({
        rejectionReasonEnum: 'CRITERION_UNMET',
      }).success
    ).toBe(true)
  })

  it('accepts an optional note and a criterionIds narrowing', () => {
    const parsed = agentVerdictBodySchema.safeParse({
      rejectionReasonEnum: 'SCOPE_MISMATCH',
      note: 'the retry path is still missing',
      criterionIds: ['c-1', 'c-2'],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects a body missing rejectionReasonEnum (required for agents)', () => {
    expect(agentVerdictBodySchema.safeParse({}).success).toBe(false)
    expect(agentVerdictBodySchema.safeParse({ note: 'no enum' }).success).toBe(
      false
    )
  })

  it('cannot express PASS: a smuggled verdict field is rejected by strict()', () => {
    expect(
      agentVerdictBodySchema.safeParse({
        rejectionReasonEnum: 'OTHER',
        verdict: 'PASS',
      }).success
    ).toBe(false)
    expect(
      agentVerdictBodySchema.safeParse({
        rejectionReasonEnum: 'OTHER',
        verdict: 'PASS_WITH_FOLLOWUP',
      }).success
    ).toBe(false)
    // Even FAIL is not a field here — the verdict is server-decided.
    expect(
      agentVerdictBodySchema.safeParse({
        rejectionReasonEnum: 'OTHER',
        verdict: 'FAIL',
      }).success
    ).toBe(false)
  })

  it('cannot smuggle a verifierType (red-line lock, like the machine schema)', () => {
    expect(
      agentVerdictBodySchema.safeParse({
        rejectionReasonEnum: 'OTHER',
        verifierType: 'HUMAN',
      }).success
    ).toBe(false)
  })

  it('rejects an invalid rejection reason value and an empty criterionIds array', () => {
    expect(
      agentVerdictBodySchema.safeParse({ rejectionReasonEnum: 'NOPE' }).success
    ).toBe(false)
    expect(
      agentVerdictBodySchema.safeParse({
        rejectionReasonEnum: 'OTHER',
        criterionIds: [],
      }).success
    ).toBe(false)
  })
})
