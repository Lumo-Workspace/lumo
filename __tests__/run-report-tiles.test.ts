/**
 * LUM-496 Task 4: `deriveRunReportTiles` is the pure rule behind the Record
 * tab's Run report KPI tiles (PR iterations / R1 pass rate / cost / rework).
 * Every field is `null` when the underlying signal was never measured
 * (LUM-566 honesty rule) — these tests pin the null cases as hard as the
 * happy-path ones so a future edit can't quietly turn a "not measured" into
 * a fabricated 0.
 */
import { deriveRunReportTiles } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/run-report-tiles'
import type { TaskAcceptanceStatusView } from '@/app/workspace/[workspaceUrl]/types'

function baseData(
  over: Partial<TaskAcceptanceStatusView> = {}
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't1', identifier: 'LUM-1', title: 'Task', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 5,
    escalated: false,
    criteria: [],
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  } as TaskAcceptanceStatusView
}

describe('deriveRunReportTiles', () => {
  describe('prIterations', () => {
    it('is null when there is no struggleTrail (older server)', () => {
      const tiles = deriveRunReportTiles(baseData())
      expect(tiles.prIterations).toBeNull()
    })

    it('is null when struggleTrail has no pull requests', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          struggleTrail: {
            reworkRounds: [],
            sendBacks: [],
            followUps: [],
            pullRequests: [],
            reopens: [],
          },
        })
      )
      expect(tiles.prIterations).toBeNull()
    })

    it('counts PRs and reports first/last in recorded (chronological) order', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          struggleTrail: {
            reworkRounds: [],
            sendBacks: [],
            followUps: [],
            pullRequests: [
              { number: 940, url: 'https://x/940' },
              { number: 943, url: 'https://x/943' },
              { number: 947, url: 'https://x/947' },
            ],
            reopens: [],
          },
        })
      )
      expect(tiles.prIterations).toEqual({ count: 3, first: 940, last: 947 })
    })

    it('handles a single PR (first === last)', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          struggleTrail: {
            reworkRounds: [],
            sendBacks: [],
            followUps: [],
            pullRequests: [{ number: 12, url: 'https://x/12' }],
            reopens: [],
          },
        })
      )
      expect(tiles.prIterations).toEqual({ count: 1, first: 12, last: 12 })
    })
  })

  describe('passRateR1', () => {
    it('is null when there are no verification rounds', () => {
      const tiles = deriveRunReportTiles(baseData({ verificationHistory: [] }))
      expect(tiles.passRateR1).toBeNull()
    })

    it('is null when round 1 has a zero denominator (no verdicts recorded)', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          verificationHistory: [
            { round: 1, recordedAt: 't', passed: 0, failed: 0, verdicts: [] },
          ],
        })
      )
      expect(tiles.passRateR1).toBeNull()
    })

    it('computes passed / (passed + failed) * 100, rounded, from the smallest round number', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          verificationHistory: [
            { round: 2, recordedAt: 't2', passed: 1, failed: 0, verdicts: [] },
            { round: 1, recordedAt: 't1', passed: 2, failed: 1, verdicts: [] },
          ],
        })
      )
      // round 1 (not round 2, and not array order): 2/3 -> 66.67 -> 67
      expect(tiles.passRateR1).toBe(67)
    })

    it('reports 100 when round 1 is all-pass', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          verificationHistory: [
            { round: 1, recordedAt: 't1', passed: 4, failed: 0, verdicts: [] },
          ],
        })
      )
      expect(tiles.passRateR1).toBe(100)
    })
  })

  describe('costTokens', () => {
    it('is null when there is no cost view at all', () => {
      const tiles = deriveRunReportTiles(baseData())
      expect(tiles.costTokens).toBeNull()
    })

    it('is null when cost.tokenCost itself was never measured', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: { tokenCost: null, activeTimeSec: 100, reworkRounds: 0 },
        })
      )
      expect(tiles.costTokens).toBeNull()
    })

    it('passes through a measured token cost, including 0', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: { tokenCost: 0, activeTimeSec: 100, reworkRounds: 0 },
        })
      )
      expect(tiles.costTokens).toBe(0)
    })

    it('passes through a large measured token cost', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: {
            tokenCost: 1_400_000_000,
            activeTimeSec: 100,
            reworkRounds: 0,
          },
        })
      )
      expect(tiles.costTokens).toBe(1_400_000_000)
    })
  })

  describe('activeTimeSec', () => {
    // LUM-560/LUM-642: the active-time reading the old CostSection carried
    // survives on the Cost tile — same fail-closed rule as the rest.
    it('is null when there is no cost view at all', () => {
      expect(deriveRunReportTiles(baseData()).activeTimeSec).toBeNull()
    })

    it('reports a measured 0 active seconds, not null', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: { tokenCost: null, activeTimeSec: 0, reworkRounds: 0 },
        })
      )
      expect(tiles.activeTimeSec).toBe(0)
    })

    it('passes the measured seconds through untouched', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: { tokenCost: 10, activeTimeSec: 134, reworkRounds: 0 },
        })
      )
      expect(tiles.activeTimeSec).toBe(134)
    })
  })

  describe('rework', () => {
    it('is null when there is no cost view at all', () => {
      const tiles = deriveRunReportTiles(baseData())
      expect(tiles.rework).toBeNull()
    })

    it('reports a measured 0 rework rounds, not null', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: { tokenCost: 10, activeTimeSec: 100, reworkRounds: 0 },
        })
      )
      expect(tiles.rework).toBe(0)
    })

    it('passes through a measured rework count', () => {
      const tiles = deriveRunReportTiles(
        baseData({
          cost: { tokenCost: 10, activeTimeSec: 100, reworkRounds: 6 },
        })
      )
      expect(tiles.rework).toBe(6)
    })
  })

  it('derives all four independently from the mockup example', () => {
    const tiles = deriveRunReportTiles(
      baseData({
        struggleTrail: {
          reworkRounds: [],
          sendBacks: [],
          followUps: [],
          pullRequests: [
            { number: 940, url: 'https://x/940' },
            { number: 941, url: 'https://x/941' },
            { number: 942, url: 'https://x/942' },
            { number: 943, url: 'https://x/943' },
            { number: 944, url: 'https://x/944' },
            { number: 946, url: 'https://x/946' },
            { number: 947, url: 'https://x/947' },
          ],
          reopens: [],
        },
        verificationHistory: [
          { round: 1, recordedAt: 't1', passed: 4, failed: 0, verdicts: [] },
        ],
        cost: {
          tokenCost: 1_400_000_000,
          activeTimeSec: 500,
          reworkRounds: 6,
        },
      })
    )
    expect(tiles).toEqual({
      prIterations: { count: 7, first: 940, last: 947 },
      passRateR1: 100,
      costTokens: 1_400_000_000,
      activeTimeSec: 500,
      rework: 6,
    })
  })
})
