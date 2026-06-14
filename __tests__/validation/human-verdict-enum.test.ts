import { humanVerdictBodySchema } from '@/lib/validation/acceptance'

describe('humanVerdictBodySchema', () => {
  it('rejects PASS_WITH_FOLLOWUP (retired write verdict)', () => {
    const r = humanVerdictBodySchema.safeParse({
      verdict: 'PASS_WITH_FOLLOWUP',
    })
    expect(r.success).toBe(false)
  })
  it('still accepts PASS and FAIL', () => {
    expect(humanVerdictBodySchema.safeParse({ verdict: 'PASS' }).success).toBe(
      true
    )
    expect(
      humanVerdictBodySchema.safeParse({ verdict: 'FAIL', note: 'nope' })
        .success
    ).toBe(true)
  })
})
