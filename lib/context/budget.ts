// lib/context/budget.ts

/**
 * Rough token estimate: char-count / 4, rounded-sm up. Stable proxy that avoids a
 * tokenizer dependency; mirrors the heuristic memory rendering has always used.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Per-section injection telemetry (LUM-402): how many cards of a session-start
 * section were rendered in full vs degraded, with their estimated token cost.
 */
export interface BudgetSectionMetric {
  /** Cards rendered in full. */
  keptCards: number
  /** Cards degraded to one-line manifests (or omitted). */
  droppedCards: number
  /** Estimated tokens of the kept full cards. */
  keptTokens: number
  /** Estimated tokens the dropped cards would have cost if rendered in full. */
  droppedTokens: number
}
