/**
 * LUM-644: advisory milestone token budget — burn vs budget, no hard gate.
 *
 * Fail-closed by construction, mirroring the LUM-627 cost rollup it reads:
 * an unmeasured burn (`tokenCost: null` — 没测到 ≠ 花了 0) yields
 * `exceeded: null` (unknown, stated as such), never a false all-clear and
 * never a fabricated alert. `exceeded` is only ever `true` when a MEASURED
 * burn strictly exceeds a set budget. No budget set → the whole block is
 * `null` (nothing to say — the UI renders no budget content at all).
 */

export interface MilestoneTokenBudgetStatus {
  /** The advisory budget a human set on the milestone (always > 0). */
  tokenBudget: number
  /** Measured burn from the LUM-627 rollup; `null` = not measured. */
  tokenCost: number | null
  /** burn / budget (may exceed 1); `null` when burn is unmeasured. */
  usedRatio: number | null
  /** `true` = measured burn > budget; `null` = unknown (burn unmeasured). */
  exceeded: boolean | null
  /** Tokens past the budget when exceeded; `null` otherwise. */
  overBy: number | null
}

export function computeMilestoneTokenBudget(input: {
  tokenBudget: number | null
  tokenCost: number | null
}): MilestoneTokenBudgetStatus | null {
  const { tokenBudget, tokenCost } = input
  // No budget set (or a nonsensical stored value) → no budget story to tell.
  // `== null` also catches an undefined slipping past a JS caller.
  if (tokenBudget == null || tokenBudget <= 0) return null
  if (tokenCost === null) {
    return {
      tokenBudget,
      tokenCost: null,
      usedRatio: null,
      exceeded: null,
      overBy: null,
    }
  }
  const exceeded = tokenCost > tokenBudget
  return {
    tokenBudget,
    tokenCost,
    usedRatio: tokenCost / tokenBudget,
    exceeded,
    overBy: exceeded ? tokenCost - tokenBudget : null,
  }
}
