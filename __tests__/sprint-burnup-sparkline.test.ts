/** @jest-environment node */
import { buildBurnupSparkline } from '@/app/workspace/[workspaceUrl]/sprints/components/burnup-sparkline'
import type { SprintBurnupResponse } from '@/lib/api-client/sprints'

const row = (
  over: Partial<SprintBurnupResponse['series'][number]>
): SprintBurnupResponse['series'][number] => ({
  date: '2026-07-13',
  scope: 8,
  completed: null,
  projected: null,
  ...over,
})

describe('buildBurnupSparkline', () => {
  it('returns no-data geometry for <2 points', () => {
    const geo = buildBurnupSparkline([row({ completed: 0 })], 8)
    expect(geo.hasData).toBe(false)
    expect(geo.linePath).toBe('')
    // Ceiling guide is always drawn so the empty card still reads as a chart.
    expect(geo.ceilingPath).toContain('M4 10')
  })

  it('builds a completed line + closed area from >=2 completed points', () => {
    const geo = buildBurnupSparkline(
      [row({ completed: 0 }), row({ completed: 4 }), row({ completed: 8 })],
      8
    )
    expect(geo.hasData).toBe(true)
    // Line starts with a moveto and has two lineto segments.
    expect(geo.linePath.startsWith('M')).toBe(true)
    expect((geo.linePath.match(/L/g) ?? []).length).toBe(2)
    // Area path is closed.
    expect(geo.areaPath.endsWith('Z')).toBe(true)
    // Full completion (8/8) reaches the top (y=10).
    expect(geo.linePath).toContain('10')
  })

  it('emits a dashed projected path only when >=2 projected points exist', () => {
    const withProj = buildBurnupSparkline(
      [
        row({ completed: 0 }),
        row({ completed: 4 }),
        row({ completed: null, projected: 6 }),
        row({ completed: null, projected: 8 }),
      ],
      8
    )
    expect(withProj.projectedPath).not.toBe('')

    const noProj = buildBurnupSparkline(
      [row({ completed: 0 }), row({ completed: 8 })],
      8
    )
    expect(noProj.projectedPath).toBe('')
  })

  it('floors the scope ceiling at 1 so an all-zero sprint still scales', () => {
    const geo = buildBurnupSparkline(
      [row({ completed: 0, scope: 0 }), row({ completed: 0, scope: 0 })],
      0
    )
    // 0/1 completion stays at the baseline (y=120), no divide-by-zero.
    expect(geo.hasData).toBe(true)
    expect(geo.linePath).toContain('120')
  })
})
