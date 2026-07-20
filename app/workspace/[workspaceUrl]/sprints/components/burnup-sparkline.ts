import type { SprintBurnupResponse } from '@/lib/api-client/sprints'

/**
 * Pure shaping of a burnup series into sparkline SVG paths — no axes, no
 * library, no React. Split out from the component so it is unit-testable
 * without pulling in the react-query hook chain.
 */

export const SPARKLINE_VB_W = 300
export const SPARKLINE_VB_H = 130
const PAD_X = 4
const TOP = 10
const BOTTOM = 120

export interface SparklineGeometry {
  /** Filled area under the completed line. */
  areaPath: string
  /** Solid completed line. */
  linePath: string
  /** Dashed projected line (empty when no projection). */
  projectedPath: string
  /** Horizontal scope-ceiling guide. */
  ceilingPath: string
  hasData: boolean
}

export function buildBurnupSparkline(
  series: SprintBurnupResponse['series'],
  scopeTotal: number
): SparklineGeometry {
  const ceilingPath = `M${PAD_X} ${TOP}H${SPARKLINE_VB_W - PAD_X}`
  const empty: SparklineGeometry = {
    areaPath: '',
    linePath: '',
    projectedPath: '',
    ceilingPath,
    hasData: false,
  }
  if (series.length < 2) return empty

  const maxY = Math.max(scopeTotal, 1)
  const n = series.length
  const x = (i: number) => PAD_X + (i / (n - 1)) * (SPARKLINE_VB_W - 2 * PAD_X)
  const y = (v: number) => BOTTOM - (v / maxY) * (BOTTOM - TOP)

  const completedPts: Array<[number, number]> = []
  const projectedPts: Array<[number, number]> = []
  series.forEach((row, i) => {
    if (row.completed !== null) completedPts.push([x(i), y(row.completed)])
    if (row.projected !== null) projectedPts.push([x(i), y(row.projected)])
  })
  if (completedPts.length < 2) return empty

  const toLine = (pts: Array<[number, number]>) =>
    pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px} ${py}`).join(' ')

  const linePath = toLine(completedPts)
  const first = completedPts[0]!
  const last = completedPts[completedPts.length - 1]!
  const areaPath = `${linePath} L${last[0]} ${BOTTOM} L${first[0]} ${BOTTOM} Z`
  const projectedPath = projectedPts.length >= 2 ? toLine(projectedPts) : ''

  return { areaPath, linePath, projectedPath, ceilingPath, hasData: true }
}
