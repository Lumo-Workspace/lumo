/**
 * Pure computation of which table-of-contents heading is "active" for a given
 * scroll position. Extracted from DescriptionEditor's scroll listener so the
 * active-heading semantics are unit-testable and the listener can stay a thin,
 * rAF-throttled shell that only reads cached geometry.
 *
 * The geometry is passed in as plain numbers (offsetTop per heading + the
 * container's scroll metrics) so this stays free of DOM/Tiptap dependencies.
 */

export interface TocHeadingMetric {
  /**
   * offsetTop of the heading element within the scroll root, or null when the
   * element could not be resolved (e.g. mid-edit the node was replaced). A null
   * metric contributes no candidate.
   */
  offsetTop: number | null
}

export interface TocScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

/**
 * Returns the index of the active heading, or -1 when there are no headings.
 *
 * Rules (mirroring the original inline logic):
 *  - At the bottom → the last heading. Once the container can scroll no
 *    further, the last heading still sits below the threshold line, so it
 *    would otherwise never win — this keeps the highlight from sticking on
 *    whichever heading is flush with the top edge.
 *  - Otherwise → the last heading whose top is at or above the threshold line
 *    (scrollTop + activeOffset).
 *  - When nothing has crossed the line yet (at the very top, where the first
 *    heading lives below the title/metadata block) → fall back to the first
 *    heading so something is always highlighted.
 */
export function computeActiveTocIndex(
  metrics: readonly TocHeadingMetric[],
  scroll: TocScrollMetrics,
  activeOffset: number
): number {
  if (metrics.length === 0) return -1

  const atBottom =
    scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2
  if (atBottom) return metrics.length - 1

  const line = scroll.scrollTop + activeOffset
  let activeIdx = -1
  metrics.forEach((m, i) => {
    if (m.offsetTop !== null && m.offsetTop <= line) {
      activeIdx = i
    }
  })

  return activeIdx === -1 ? 0 : activeIdx
}
