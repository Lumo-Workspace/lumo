import {
  buildBurnupChart,
  nearestPointIndex,
  PLOT,
} from '@/app/workspace/[workspaceUrl]/sprints/components/burnup-chart'

type Row = { date: string; scope: number; completed: number | null }

const row = (over: Partial<Row> = {}): Row => ({
  date: '2026-07-27',
  scope: 8,
  completed: 0,
  ...over,
})

const series = (completed: Array<number | null>) =>
  completed.map((c, i) => ({
    ...row({
      completed: c,
      date: `2026-07-${String(27 + i).padStart(2, '0')}`,
    }),
    projected: null,
  }))

describe('buildBurnupChart', () => {
  it('degrades safely with fewer than two measured days', () => {
    expect(buildBurnupChart([{ ...row(), projected: null }], 8).hasData).toBe(
      false
    )
    expect(buildBurnupChart(series([1, null, null]), 8).hasData).toBe(false)
  })

  it('draws the measured line, its filled area and a straight plan line', () => {
    const geo = buildBurnupChart(series([0, 4, 8]), 8)
    expect(geo.hasData).toBe(true)
    // Left edge at 0 completed = plot floor; right edge at scope = plot top.
    const midX = (PLOT.left + PLOT.right) / 2
    const midY = (PLOT.top + PLOT.bottom) / 2
    expect(geo.linePath).toBe(
      `M${PLOT.left} ${PLOT.bottom} L${midX} ${midY} L${PLOT.right} ${PLOT.top}`
    )
    expect(geo.areaPath).toContain(`L${PLOT.right} ${PLOT.bottom}`)
    expect(geo.areaPath.endsWith('Z')).toBe(true)
    expect(geo.idealPath).toBe(
      `M${PLOT.left} ${PLOT.bottom} L${PLOT.right} ${PLOT.top}`
    )
  })

  it('carries a point per day, with the plan filling in past the measured tail', () => {
    const geo = buildBurnupChart(series([0, 4, null, null, null]), 8)
    expect(geo.points).toHaveLength(5)
    expect(geo.points[1]).toMatchObject({ completed: 4, isMeasured: true })

    const last = geo.points[4]!
    expect(last.isMeasured).toBe(false)
    expect(last.completed).toBeNull()
    // Plan ramps 0 → scope across the sprint, so the final day sits at scope.
    expect(last.ideal).toBe(8)
    expect(last.y).toBe(PLOT.top)
  })

  it('keeps an overshooting curve inside the plot by scaling to its own peak', () => {
    const geo = buildBurnupChart(series([0, 6, 12]), 8)
    // 12 completed against a scope of 8 — the peak, not the scope, is the top.
    expect(geo.points[2]!.y).toBe(PLOT.top)
    expect(geo.ticks.map(t => t.value)).toEqual([0, 6, 12])
  })

  it('keeps the scale marks whole — no half-task gridline on an odd ceiling', () => {
    const geo = buildBurnupChart(series([0, 5, 13]), 13)
    expect(geo.ticks.map(t => t.value)).toEqual([0, 7, 13])
    // The gridline sits where its own label says, not at the true midpoint.
    const [, mid] = geo.ticks
    expect(mid!.y).toBeCloseTo(
      PLOT.bottom - (7 / 13) * (PLOT.bottom - PLOT.top),
      6
    )
  })

  it('snaps a pointer position to the nearest day', () => {
    // 14 days spread evenly across the plot width — derive the step rather than
    // hardcoding it, so the assertion survives a change of viewBox scale.
    const step = (PLOT.right - PLOT.left) / 13
    expect(nearestPointIndex(PLOT.left, 14)).toBe(0)
    expect(nearestPointIndex(PLOT.left + step * 1.1, 14)).toBe(1)
    expect(nearestPointIndex(PLOT.right, 14)).toBe(13)
    // Out-of-plot pointers clamp rather than index past the ends.
    expect(nearestPointIndex(-500, 14)).toBe(0)
    expect(nearestPointIndex(5000, 14)).toBe(13)
  })
})
