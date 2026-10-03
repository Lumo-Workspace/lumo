// lib/context/injection-metrics.ts
//
// Session-start injection telemetry (LUM-402): per-section token attribution
// for the context the hook injects into the agent. Observe-only — nothing
// here changes what gets injected; the metrics are stamped onto the stored
// SESSION_START HookEvent payload so budget pressure ("which section dropped
// fragments, how big is the injection") is SQL-queryable after the fact,
// the same way `_lumo_validation` makes boundary enforcement auditable.

import { estimateTokens, type BudgetSectionMetric } from '@/lib/context/budget'

/**
 * Reserved payload key carrying the metrics. Server-side only: a
 * client-supplied value is dropped at the hook POST boundary
 * (`lib/validation/hook-payload.ts`), so a stored value can only originate
 * from the session-start route.
 */
export const CONTEXT_METRICS_KEY = '_lumo_context_metrics'

/** Budget-allocated sections, in allocation priority order (LUM-342/LUM-147). */
export interface SessionStartAllocation {
  memory: BudgetSectionMetric
  pr: BudgetSectionMetric
  slack: BudgetSectionMetric
  figma: BudgetSectionMetric
  web: BudgetSectionMetric
  /** Layer-2 review runs its own memory budget (counts only — no token split). */
  layer2Review: { keptCards: number; droppedCards: number }
}

export interface SessionStartContextMetrics {
  version: 1
  /** The shared injection budget the allocation ran under. */
  budgetTokens: number
  /** Per-section kept/dropped card attribution from the budget allocator. */
  allocation: SessionStartAllocation
  /**
   * Estimated tokens of each section string actually shipped to the CLI.
   * `progress` is measured over the rendered Tier-1 progress markdown the
   * agent actually receives (LUM-500), not the structured recovery object.
   */
  sectionTokens: {
    memory: number
    linkedResources: number
    reviewTodos: number
    progress: number
    layer2Review: number
    blockerWarning: number
  }
  /** Sum of sectionTokens — the total estimated injection size. */
  totalTokens: number
  /**
   * Per-tier token split (LUM-500 progressive disclosure):
   *  - tier0 = always-full red-line context: blockerWarning
   *  - tier1 = always-full orienting context: progress + reviewTodos + layer2Review
   *  - tier2 = pull-on-demand index/manifest surface: memory (index) + linkedResources (manifests)
   */
  tierTokens: { tier0: number; tier1: number; tier2: number }
}

interface BuildMetricsInput {
  budgetTokens: number
  allocation: SessionStartAllocation
  memorySection: string
  linkedResourcesSection: string
  reviewTodosSection: string
  progressSection: string
  layer2ReviewSection: string
  blockerWarningSection: string
}

export function buildSessionStartContextMetrics(
  input: BuildMetricsInput
): SessionStartContextMetrics {
  const sectionTokens = {
    memory: estimateTokens(input.memorySection),
    linkedResources: estimateTokens(input.linkedResourcesSection),
    reviewTodos: estimateTokens(input.reviewTodosSection),
    progress: estimateTokens(input.progressSection),
    layer2Review: estimateTokens(input.layer2ReviewSection),
    blockerWarning: estimateTokens(input.blockerWarningSection),
  }
  const totalTokens = Object.values(sectionTokens).reduce(
    (sum, tokens) => sum + tokens,
    0
  )
  const tierTokens = {
    tier0: sectionTokens.blockerWarning,
    tier1:
      sectionTokens.progress +
      sectionTokens.reviewTodos +
      sectionTokens.layer2Review,
    tier2: sectionTokens.memory + sectionTokens.linkedResources,
  }
  return {
    version: 1,
    budgetTokens: input.budgetTokens,
    allocation: input.allocation,
    sectionTokens,
    totalTokens,
    tierTokens,
  }
}
