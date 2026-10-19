/**
 * LUM-646 (F4/自治边界): the agent-claimable autonomy gate for
 * `lumo status --next --claimable`. Pure — no network/IO — so it can be unit-tested
 * directly and kept out of the ranking comparator.
 *
 * A task is inside the autonomy boundary only when ALL THREE hold:
 *   1. claimable === true         — a steward/human triaged it (fail-closed)
 *   2. no open blockers            — F3 topology (blockedByOpenCount === 0)
 *   3. milestone not over budget   — F2 advisory budget (milestoneBudgetExceeded !== true)
 *
 * Budget is advisory and fail-open on the unknown: only a MEASURED overrun
 * (`milestoneBudgetExceeded === true`) excludes a task. `false` / `null` /
 * absent (no budget set, or unmeasured burn) never excludes — mirroring the
 * LUM-644 rule that the budget never fabricates an all-clear OR a false alert.
 */

import type { NextTask } from './rank-tasks'

export interface ClaimableExclusions {
  /** Not triaged claimable (claimable is false or unset on that task). */
  notClaimable: number
  /** Claimable but still gated by ≥1 open blocker (F3). */
  blocked: number
  /** Claimable and unblocked but its milestone is measured over budget (F2). */
  overBudget: number
}

export interface ClaimableFilterResult {
  /**
   * False when the server sent NO `claimable` field on any task — an older
   * server that predates F4. The caller degrades to the standard ranking
   * rather than silently returning an empty list.
   */
  supported: boolean
  /** Tasks inside the autonomy boundary, in input order (ranking is separate). */
  kept: NextTask[]
  /** Per-reason tally of everything excluded (mutually exclusive buckets). */
  excluded: ClaimableExclusions
}

/** A new server always sends a boolean claimable; an old one omits it. */
function serverSupportsClaimable(tasks: NextTask[]): boolean {
  return tasks.some(t => typeof t.claimable === 'boolean')
}

/**
 * Apply the three-part autonomy gate. Each excluded task is counted under its
 * FIRST failing reason (claimable → blocked → budget), so the buckets sum to
 * `tasks.length - kept.length` exactly.
 */
export function filterClaimable(tasks: NextTask[]): ClaimableFilterResult {
  const excluded: ClaimableExclusions = {
    notClaimable: 0,
    blocked: 0,
    overBudget: 0,
  }

  if (!serverSupportsClaimable(tasks)) {
    return { supported: false, kept: [], excluded }
  }

  const kept: NextTask[] = []
  for (const t of tasks) {
    if (t.claimable !== true) {
      excluded.notClaimable++
      continue
    }
    if ((t.blockedByOpenCount ?? 0) > 0) {
      excluded.blocked++
      continue
    }
    if (t.milestoneBudgetExceeded === true) {
      excluded.overBudget++
      continue
    }
    kept.push(t)
  }

  return { supported: true, kept, excluded }
}

/**
 * Render the exclusion tally as a one-line, human-readable clause (omitting
 * zero buckets). Returns '' when nothing was excluded. Pure.
 */
export function formatClaimableExclusions(
  excluded: ClaimableExclusions
): string {
  const parts: string[] = []
  if (excluded.notClaimable > 0) {
    parts.push(`${excluded.notClaimable} not triaged claimable`)
  }
  if (excluded.blocked > 0) {
    parts.push(`${excluded.blocked} blocked by open deps`)
  }
  if (excluded.overBudget > 0) {
    parts.push(`${excluded.overBudget} over milestone budget`)
  }
  return parts.join(', ')
}
