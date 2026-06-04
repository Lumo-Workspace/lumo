export type InsertAxis = 'row' | 'col'

/**
 * Sort coordinates ascending and collapse near-duplicates (within `tol` px) to
 * a single representative. Used to derive a table's true column/row grid lines
 * from the union of every cell's edges — which is robust to merged cells
 * (colspan/rowspan), since a boundary hidden by a merge in one row is exposed
 * by another row.
 */
export function dedupeSortedCoords(coords: number[], tol = 0.5): number[] {
  const sorted = [...coords].sort((a, b) => a - b)
  const out: number[] = []
  for (const c of sorted) {
    const last = out[out.length - 1]
    if (last === undefined || Math.abs(c - last) > tol) out.push(c)
  }
  return out
}

export interface InsertTarget {
  axis: InsertAxis
  side: 'before' | 'after'
  /** column index (col axis) or row index (row axis) of the cell to anchor the command on */
  anchorIndex: number
  /** viewport x (col) or y (row) of the boundary line, for rendering */
  boundaryCoord: number
}

export interface ResolveInput {
  pointer: { x: number; y: number }
  tableRect: { left: number; top: number; right: number; bottom: number }
  /** ascending x coordinates, length = columnCount + 1 (outer-left … outer-right) */
  columnBoundaries: number[]
  /** ascending y coordinates, length = rowCount + 1 (outer-top … outer-bottom) */
  rowBoundaries: number[]
  /** max distance (px) from a boundary to trigger. Default 6. */
  threshold?: number
  /** how far the edge trigger band extends in/out from the table edge. Default 12. */
  edgeBand?: number
}

/** Index of the boundary within `threshold` of `coord` and closest to it, or -1. */
function nearestBoundaryIndex(
  boundaries: number[],
  coord: number,
  threshold: number
): number {
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i]
    if (b === undefined) continue
    const d = Math.abs(b - coord)
    if (d <= threshold && d < bestDist) {
      best = i
      bestDist = d
    }
  }
  return best
}

/** boundary index k (0…count) → which cell to anchor on and which side to insert. */
function targetFromBoundary(
  axis: InsertAxis,
  k: number,
  boundaries: number[]
): InsertTarget | null {
  const coord = boundaries[k]
  if (coord === undefined) return null
  if (k === 0) return { axis, side: 'before', anchorIndex: 0, boundaryCoord: coord }
  // any other boundary == "after the column/row to its left"
  return { axis, side: 'after', anchorIndex: k - 1, boundaryCoord: coord }
}

/**
 * Resolve which column or row insert handle should be active given the current
 * pointer position relative to a table.
 *
 * Intentional design (Notion-style):
 * - Only the table's **top** edge triggers column inserts: hovering in the
 *   horizontal band above/below `tableRect.top` while close to a column
 *   boundary lets the user insert a column at that position.
 * - Only the table's **left** edge triggers row inserts: hovering in the
 *   vertical band left/right of `tableRect.left` while close to a row
 *   boundary lets the user insert a row at that position.
 * - The outermost boundaries (first and last entries in each boundaries array)
 *   already cover "append before the first / after the last column or row",
 *   so bottom and right edges are intentionally not handled.
 *
 * Note: `tableRect.right` and `tableRect.bottom` are part of the `ResolveInput`
 * type for DOMRect compatibility at the call site but are not currently read
 * inside this function.
 */
export function resolveInsertTarget(input: ResolveInput): InsertTarget | null {
  const threshold = input.threshold ?? 6
  const edgeBand = input.edgeBand ?? 12
  const { pointer, tableRect, columnBoundaries, rowBoundaries } = input

  // Column insert: pointer hugging the table's top edge.
  if (
    pointer.y >= tableRect.top - edgeBand &&
    pointer.y <= tableRect.top + edgeBand
  ) {
    const k = nearestBoundaryIndex(columnBoundaries, pointer.x, threshold)
    if (k !== -1) return targetFromBoundary('col', k, columnBoundaries)
  }

  // Row insert: pointer hugging the table's left edge.
  if (
    pointer.x >= tableRect.left - edgeBand &&
    pointer.x <= tableRect.left + edgeBand
  ) {
    const k = nearestBoundaryIndex(rowBoundaries, pointer.y, threshold)
    if (k !== -1) return targetFromBoundary('row', k, rowBoundaries)
  }

  return null
}
