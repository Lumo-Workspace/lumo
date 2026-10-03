/**
 * LUM-496 Task 4: `deriveRunReportTiles` is the pure rule behind the Record
 * tab's Run report KPI tiles (PR iterations / cost / rework). A token cost
 * that was never measured stays `null` (LUM-566 honesty rule) — these tests
 * pin the null cases as hard as the happy-path ones so a future edit can't
 * quietly turn a "not measured" into a fabricated 0.
 */
import { deriveRunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/run-report-tiles'
import type { TaskStatusView } from '@/app/workspace/[workspaceUrl]/types'

function baseData(over: Partial<TaskStatusView> = {}): TaskStatusView {
  return {
    version: 2,
    task: { id: 't1', identifier: 'LUM-1', title: 'Task', status: 'IN_REVIEW' },
    struggleTrail: { pullRequests: [], reopens: [] },
    cost: { tokenCost: null, activeTimeSec: 0 },
    trend: { cost: [], rework: { reopens: 0, extraPrCycles: 0, total: 0 } },
    ...over,
  }
}

const pr = (n: number) => ({ number: n, url: `https://x/pull/${n}` })

describe('deriveRunReportTiles', () => {
  describe('prIterations', () => {
    it('is null when the task has no pull requests', () => {
      expect(deriveRunReportTiles(baseData()).prIterations).toBeNull()
    })

    it('counts PRs and reports first/last in recorded (chronological) order', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          struggleTrail: { pullRequests: [pr(12), pr(9), pr(15)], reopens: [] },
        })
      )
      expect(tiles.prIterations).toEqual({ count: 3, first: 12, last: 15 })
    })

    it('handles a single PR (first === last)', () => {
      const tiles = deriveRunReportTiles(
        baseData({ struggleTrail: { pullRequests: [pr(7)], reopens: [] } })
      )
      expect(tiles.prIterations).toEqual({ count: 1, first: 7, last: 7 })
    })
  })

  describe('costTokens', () => {
    it('is null when the token cost was never measured', () => {
      expect(deriveRunReportTiles(baseData()).costTokens).toBeNull()
    })

    it('passes through a measured token cost, including 0', () => {
      expect(
        deriveRunReportTiles(
          baseData({ cost: { tokenCost: 0, activeTimeSec: 0 } })
        ).costTokens
      ).toBe(0)
      expect(
        deriveRunReportTiles(
          baseData({ cost: { tokenCost: 1_400_000_000, activeTimeSec: 0 } })
        ).costTokens
      ).toBe(1_400_000_000)
    })
  })

  it('passes the measured active seconds through untouched', () => {
    expect(
      deriveRunReportTiles(
        baseData({ cost: { tokenCost: null, activeTimeSec: 8040 } })
      ).activeTimeSec
    ).toBe(8040)
  })

  it('reports the accrued rework total (reopens + extra PR cycles)', () => {
    expect(deriveRunReportTiles(baseData()).rework).toBe(0)
    expect(
      deriveRunReportTiles(
        baseData({
          trend: {
            cost: [],
            rework: { reopens: 1, extraPrCycles: 2, total: 3 },
          },
        })
      ).rework
    ).toBe(3)
  })
})
