// lib/context/budget.ts

/**
 * Rough token estimate: char-count / 4, rounded up. Stable proxy that avoids a
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
  renderManifest: (card: T) => string
): BudgetSection {
  const fulls = cards.map(renderFull)
  return {
    cardTokens: fulls.map(estimateTokens),
    render: (fullCount: number): string => {
      if (cards.length === 0) return ''
      const keptFulls = fulls.slice(0, fullCount)
      const overflow = cards.slice(fullCount)
      const parts: string[] = [heading, '']
      if (keptFulls.length > 0) parts.push(keptFulls.join('\n\n'))
      if (overflow.length > 0) {
        if (keptFulls.length > 0) parts.push('')
        parts.push(`其余 ${overflow.length} 条（仅清单）：`)
        parts.push(...overflow.map(renderManifest))
      }
      return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
    },
  }
}

/**
 * Greedily fill full cards across sections in array order (= priority). The
 * first card that would exceed `maxTokens` and every card after it (including
 * all later sections) render as manifests. Returns rendered strings aligned 1:1
 * with the input sections ("" for sections that produce nothing).
 */
export function allocateBudget(
  sections: BudgetSection[],
  maxTokens: number
): string[] {
  let used = 0
  let exhausted = false
  return sections.map(section => {
    let fullCount = 0
    if (!exhausted) {
      for (const cost of section.cardTokens) {
        if (used + cost > maxTokens) {
          exhausted = true
          break
        }
        used += cost
        fullCount++
      }
    }
    return section.render(fullCount)
  })
}
