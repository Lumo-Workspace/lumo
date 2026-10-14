/**
 * @jest-environment node
 */
// LUM-644 — `lumo milestone update --token-budget`: positive integer sets the
// advisory budget, '' clears it, anything else is rejected before any network
// call; the delta summary states the budget change.
import {
  buildMilestoneUpdatePayload,
  formatMilestoneUpdateSummary,
  normalizeTokenBudget,
} from '@/cli/src/commands/milestone-update'

describe('milestone update token budget flag', () => {
  it('normalizes a positive integer and treats empty string as clear', () => {
    expect(normalizeTokenBudget('5000000')).toBe(5000000)
    expect(normalizeTokenBudget('1')).toBe(1)
    expect(normalizeTokenBudget('')).toBeNull()
  })

  it('rejects non-numeric, non-positive, fractional and out-of-range values', () => {
    for (const bad of ['abc', '0', '-5', '1.5', '2147483648', '1e6']) {
      expect(normalizeTokenBudget(bad)).toBeUndefined()
    }
  })

  it('maps --token-budget into the PATCH payload', () => {
    const { payload, flagsGiven } = buildMilestoneUpdatePayload({
      tokenBudget: '5000000',
    })
    expect(payload).toEqual({ tokenBudget: 5000000 })
    expect(flagsGiven).toEqual(['--token-budget'])
  })

  it('maps the clear form to null', () => {
    const { payload } = buildMilestoneUpdatePayload({ tokenBudget: '' })
    expect(payload).toEqual({ tokenBudget: null })
  })

  it('summary states the budget change and the cleared state', () => {
    expect(
      formatMilestoneUpdateSummary(
        { name: 'Q3 Launch', tokenBudget: null },
        { tokenBudget: 5000000 }
      )
    ).toBe('Updated milestone "Q3 Launch": token budget → 5,000,000')
    expect(
      formatMilestoneUpdateSummary(
        { name: 'Q3 Launch', tokenBudget: 5000000 },
        { tokenBudget: null }
      )
    ).toBe('Updated milestone "Q3 Launch": token budget → -')
  })
})
