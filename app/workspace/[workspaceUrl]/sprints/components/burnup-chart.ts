import type { SprintBurnupResponse } from '@/lib/api-client/sprints'

/**
 * Pure shaping of a burnup series into the detail page's chart geometry — no
 * axes library, no React. Split out from the component so the maths is
 * unit-testable without the react-query hook chain.
 *
 * The chart carries two lines: the measured `completed` curve (solid + filled
 * area) and a straight-line plan from 0 to the sprint scope (dashed). The
 * per-day `points` exist so the component can resolve a hover to a day without
 * re-deriving the scale.
 */

// The viewBox carries the plot only — tick and axis labels are HTML around it,
// so their type stays at the design-system size however wide the card gets.
//
// The aspect ratio is what decides how tall the card renders, since the SVG
// scales to its column: at the old 5:1 the curve collapsed to a ~54px sliver
// once the card moved into the ~320px right rail (LUM-718). ~2.1:1 keeps the
// plot readable there, and the wider left gutter gives the tick labels room.
export const CHART_VB_W = 340
export const CHART_VB_H = 160

const PLOT_LEFT = 40
const PLOT_RIGHT = 300
const PLOT_TOP = 20
const PLOT_BOTTOM = 140

export interface BurnupPoint {
  /** Index into the source series. */
  index: number
  x: number
  /** Y of the hover dot — the measured curve where it exists, else the plan. */
  y: number
  date: string
  /** Completed count that day; `null` once past the last measured day. */
  completed: number | null
  /** Straight-line plan value for that day (0 at the start, scope at the end). */
  ideal: number
  /** True while `completed` is a real measurement rather than a plan value. */
  isMeasured: boolean
}

export interface BurnupChartGeometry {
  hasData: boolean
  points: BurnupPoint[]
  /** Solid measured line. */
  linePath: string
  /** Filled area under the measured line. */
  areaPath: string
  /** Dashed straight-line plan. */
  idealPath: string
  /** Horizontal grid lines, bottom to top. */
  ticks: Array<{ y: number; value: number }>
}

const EMPTY: BurnupChartGeometry = {
  hasData: false,
  points: [],
  linePath: '',
  areaPath: '',
  idealPath: '',
  ticks: [],
}

export function buildBurnupChart(
  series: SprintBurnupResponse['series'],
  scopeTotal: number
): BurnupChartGeometry {
  if (series.length < 2) return EMPTY

  const measured = series.filter(row => row.completed !== null)
  if (measured.length < 2) return EMPTY

  // The plan tops out at the scope, but a sprint can overshoot it (scope cut
  // mid-flight); take the curve's own peak so the line never leaves the plot.
  const maxY = Math.max(
    scopeTotal,
    ...measured.map(row => row.completed ?? 0),
    1
  )
  const n = series.length
  const x = (i: number) => PLOT_LEFT + (i / (n - 1)) * (PLOT_RIGHT - PLOT_LEFT)
  const y = (v: number) => PLOT_BOTTOM - (v / maxY) * (PLOT_BOTTOM - PLOT_TOP)
  const idealAt = (i: number) => (scopeTotal * i) / (n - 1)

  const points: BurnupPoint[] = series.map((row, i) => {
    const ideal = idealAt(i)
    const isMeasured = row.completed !== null
    return {
      index: i,
      x: x(i),
      y: y(isMeasured ? (row.completed as number) : ideal),
      date: row.date,
      completed: row.completed,
      ideal,
      isMeasured,
    }
  })

  const measuredPoints = points.filter(p => p.isMeasured)
  const linePath = measuredPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
    .join(' ')
  const first = measuredPoints[0]!
  const last = measuredPoints[measuredPoints.length - 1]!
  const areaPath = `${linePath} L${last.x} ${PLOT_BOTTOM} L${first.x} ${PLOT_BOTTOM} Z`
  const idealPath = `M${PLOT_LEFT} ${y(0)} L${PLOT_RIGHT} ${y(scopeTotal)}`

  // Tasks are whole things — a "6.5" gridline on an odd ceiling reads as a
  // half-finished task rather than a scale mark. The middle tick snaps to a
  // whole task, and its gridline sits at that same whole value so the line and
  // its label agree.
  const ticks = [0, Math.round(maxY / 2), maxY].map(value => ({
    y: y(value),
    value,
  }))

  return { hasData: true, points, linePath, areaPath, idealPath, ticks }
}

/** Resolve a pointer position (in viewBox units) to the nearest day index. */
export function nearestPointIndex(vbX: number, count: number): number {
  if (count < 2) return 0
  const step = (PLOT_RIGHT - PLOT_LEFT) / (count - 1)
  const i = Math.round((vbX - PLOT_LEFT) / step)
  return Math.max(0, Math.min(count - 1, i))
}

export const PLOT = {
  left: PLOT_LEFT,
  right: PLOT_RIGHT,
  top: PLOT_TOP,
  bottom: PLOT_BOTTOM,
}
