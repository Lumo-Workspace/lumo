// lib/context/budget.ts

/**
 * Rough token estimate: char-count / 4, rounded-sm up. Stable proxy that avoids a
 * tokenizer dependency; mirrors the heuristic memory rendering has always used.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * A budget section knows its per-card token cost (full rendering) and how to
 * render itself given how many leading cards fit as full cards — the remainder
 * degrade to one-line manifests. Manifest lines are NOT counted against the
 * budget: they are already the cheap fallback.
 */
export interface BudgetSection {
  /** Per-card full-rendering token cost, in keep-priority order within the section. */
  cardTokens: number[]
  /** Render heading + first `fullCount` full cards + manifest lines for the rest. "" to omit. */
  render: (fullCount: number) => string
}

/**
 * Build a uniform budget section from a flat card list plus a full renderer and
 * a manifest renderer. Used by slack/web/figma/pr (memory builds its own to keep
 * category sub-grouping).
 */
export function makeBudgetSection<T>(
  heading: string,
  cards: T[],
  renderFull: (card: T) => string,
  renderManifest: (card: T) => string,
  cardSeparator = '\n\n'
): BudgetSection {
  const fulls = cards.map(renderFull)
  const manifests = cards.map(renderManifest)
  return {
    cardTokens: fulls.map(estimateTokens),
    render: (fullCount: number): string => {
      if (fulls.length === 0) return ''
      const keptFulls = fulls.slice(0, fullCount)
      const overflowManifests = manifests.slice(keptFulls.length)
      const parts: string[] = [heading, '']
      if (keptFulls.length > 0) parts.push(keptFulls.join(cardSeparator))
      if (overflowManifests.length > 0) {
        if (keptFulls.length > 0) parts.push('')
        // Agent-facing internal context string (server-rendered markdown injected
        // into the coding agent), not a user-facing UI string — not react-intl.
        parts.push(`Remaining ${overflowManifests.length} (manifest only):`)
        parts.push(...overflowManifests)
      }
      return parts.join('\n').trimEnd()
    },
  }
}

/**
 * Per-section outcome of a budget allocation (LUM-402 injection telemetry).
 * Token figures are the same estimates the allocator budgeted with — full-card
 * rendering cost, excluding headings and manifest fallback lines.
 */
export interface BudgetSectionMetric {
  /** Cards rendered in full. */
  keptCards: number
  /** Cards degraded to one-line manifests (or omitted) by budget exhaustion. */
  droppedCards: number
  /** Estimated tokens of the kept full cards. */
  keptTokens: number
  /** Estimated tokens the dropped cards would have cost if rendered in full. */
  droppedTokens: number
}

/**
 * Greedily fill full cards across sections in array order (= priority). The
 * first card that would exceed `maxTokens` and every card after it (including
 * all later sections) render as manifests. `rendered` is aligned 1:1 with the
 * input sections ("" for sections that produce nothing); `metrics` is the
 * same-index per-section kept/dropped attribution.
 */
export function allocateBudgetWithMetrics(
  sections: BudgetSection[],
  maxTokens: number
): { rendered: string[]; metrics: BudgetSectionMetric[] } {
  let used = 0
  let exhausted = false
  const metrics: BudgetSectionMetric[] = []
  const rendered = sections.map(section => {
    let fullCount = 0
    let keptTokens = 0
    if (!exhausted) {
      for (const cost of section.cardTokens) {
        if (used + cost > maxTokens) {
          exhausted = true
          break
        }
        used += cost
        keptTokens += cost
        fullCount++
      }
    }
    const droppedCosts = section.cardTokens.slice(fullCount)
    metrics.push({
      keptCards: fullCount,
      droppedCards: droppedCosts.length,
      keptTokens,
      droppedTokens: droppedCosts.reduce((sum, cost) => sum + cost, 0),
    })
    return section.render(fullCount)
  })
  return { rendered, metrics }
}

/** `allocateBudgetWithMetrics` for callers that only need the rendered strings. */
export function allocateBudget(
  sections: BudgetSection[],
  maxTokens: number
): string[] {
  return allocateBudgetWithMetrics(sections, maxTokens).rendered
}
