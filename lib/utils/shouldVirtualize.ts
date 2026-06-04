/** Row count above which the task list switches to virtualized rendering. */
export const LIST_VIRTUALIZE_THRESHOLD = 80

/** Per-column card count above which a board column switches to virtualized rendering. */
export const BOARD_COLUMN_VIRTUALIZE_THRESHOLD = 50

/**
 * Decide whether a collection is large enough to warrant virtualization.
 * Strictly greater than the threshold so small/medium datasets keep the
 * existing, already-verified non-virtual render path (zero behavior change).
 */
export function shouldVirtualize(count: number, threshold: number): boolean {
  return count > threshold
}
