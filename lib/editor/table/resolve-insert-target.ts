export type InsertAxis = 'row' | 'col'

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
