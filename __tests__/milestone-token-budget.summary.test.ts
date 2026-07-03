import { computeMilestoneTokenBudget } from '@/lib/summaries/milestone-token-budget'

describe('token budget fail-closed', () => {
  it('returns null when no budget is set — nothing to say, no fabricated block', () => {
    expect(
      computeMilestoneTokenBudget({ tokenBudget: null, tokenCost: 5000 })
    ).toBeNull()
  })

  it('treats a nonsensical stored budget as unset', () => {
    expect(
      computeMilestoneTokenBudget({ tokenBudget: 0, tokenCost: 5000 })
    ).toBeNull()
    expect(
      computeMilestoneTokenBudget({ tokenBudget: -10, tokenCost: 5000 })
    ).toBeNull()
  })

  it('unmeasured burn yields exceeded null — unknown, never an all-clear or an alert', () => {
    expect(
      computeMilestoneTokenBudget({ tokenBudget: 1000, tokenCost: null })
    ).toEqual({
      tokenBudget: 1000,
      tokenCost: null,
      usedRatio: null,
      exceeded: null,
      overBy: null,
    })
  })

  it('exceeded is true only when the measured burn strictly exceeds the budget', () => {
    // At exactly the budget: not exceeded — no false positive.
    expect(
      computeMilestoneTokenBudget({ tokenBudget: 1000, tokenCost: 1000 })
    ).toEqual({
      tokenBudget: 1000,
      tokenCost: 1000,
      usedRatio: 1,
      exceeded: false,
      overBy: null,
    })
    expect(
      computeMilestoneTokenBudget({ tokenBudget: 1000, tokenCost: 1500 })
    ).toEqual({
      tokenBudget: 1000,
      tokenCost: 1500,
      usedRatio: 1.5,
      exceeded: true,
      overBy: 500,
    })
  })

  it('a real measured zero burn is under budget, not unknown', () => {
    expect(
      computeMilestoneTokenBudget({ tokenBudget: 1000, tokenCost: 0 })
    ).toEqual({
      tokenBudget: 1000,
      tokenCost: 0,
      usedRatio: 0,
      exceeded: false,
      overBy: null,
    })
  })
})
