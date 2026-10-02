/**
 * @jest-environment node
 *
 * LUM-932 P3: the one predicate deciding which sessions' events the
 * recompute may backfill — shared by the pure assignment and the commit's
 * in-transaction re-check.
 */
import {
  isBackfillEligible,
  isStewardBinding,
  type BackfillSessionFields,
} from '@/lib/attribution/backfill-eligibility'

const s = (
  over: Partial<BackfillSessionFields> = {}
): BackfillSessionFields => ({
  taskId: null,
  role: 'IMPLEMENTATION',
  milestoneId: null,
  ...over,
})

describe('isStewardBinding', () => {
  it('is a STEWARD role with a milestone only', () => {
    expect(isStewardBinding(s({ role: 'STEWARD', milestoneId: 'ms' }))).toBe(
      true
    )
    expect(isStewardBinding(s({ role: 'STEWARD' }))).toBe(false)
    expect(isStewardBinding(s({ milestoneId: 'ms' }))).toBe(false)
    expect(isStewardBinding(undefined)).toBe(false)
    expect(isStewardBinding(null)).toBe(false)
  })
})

describe('isBackfillEligible', () => {
  it('an unbound implementation root is eligible', () => {
    expect(isBackfillEligible(s(), null)).toBe(true)
  })

  it('an explicitly bound session is not', () => {
    expect(isBackfillEligible(s({ taskId: 't1' }), null)).toBe(false)
  })

  it('an unbound child of an explicitly bound parent is not', () => {
    expect(isBackfillEligible(s(), s({ taskId: 't1' }))).toBe(false)
  })

  it('a STEWARD session and a child of a STEWARD parent are not', () => {
    const steward = s({ role: 'STEWARD', milestoneId: 'ms' })
    expect(isBackfillEligible(steward, null)).toBe(false)
    expect(isBackfillEligible(s(), steward)).toBe(false)
  })

  it('an unbound child of an unbound implementation parent is', () => {
    expect(isBackfillEligible(s(), s())).toBe(true)
  })
})
