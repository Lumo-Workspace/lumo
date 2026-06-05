export interface GutterItem {
  id: string
  /** Desired top (px) from the item's text anchor, relative to the gutter top. */
  anchorY: number
  /** Card height (px) used to reserve space for the next item. */
  height: number
}

/**
 * Resolve a Google-Docs-style comment gutter: every card wants to sit at its
 * anchor's Y, but cards must not overlap. Sort ascending by `anchorY`, then push
 * each card down to `max(anchorY, previousBottom + gap)`.
 *
 * Pure — no DOM, no React. Returns a map of `id → top` (px).
 */
export function resolveGutterLayout(
  items: GutterItem[],
  gap: number
): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.anchorY - b.anchorY)
  const tops: Record<string, number> = {}
  let prevBottom = Number.NEGATIVE_INFINITY
  for (const it of sorted) {
    const floor = Math.max(prevBottom + gap, 0)
    const top = Number.isFinite(it.anchorY) ? Math.max(it.anchorY, floor) : floor
    tops[it.id] = top
    prevBottom = top + it.height
  }
  return tops
}
