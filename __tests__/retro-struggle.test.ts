import {
  aggregateRetroStruggle,
  type RetroStruggleInput,
} from '@/lib/services/retro-struggle'

/** Minimal per-task status slice the aggregator consumes. */
function status(
  identifier: string,
  title: string,
  overrides: Partial<RetroStruggleInput> = {}
): RetroStruggleInput {
  return {
    task: { identifier, title },
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    ...overrides,
  }
}

describe('aggregateRetroStruggle', () => {
  it('reports an all-clean basis when no task carries any negative signal', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one'),
      status('LUM-2', 'two'),
    ])
    expect(agg.tasksConsidered).toBe(2)
    expect(agg.tasksWithStruggle).toBe(0)
    expect(agg.reworkRounds).toBe(0)
    expect(agg.failedVerdicts).toBe(0)
    expect(agg.openSendBacks).toBe(0)
    expect(agg.resolvedSendBacks).toBe(0)
    expect(agg.reopens).toBe(0)
    expect(agg.followUps).toBe(0)
    expect(agg.extraPrCycles).toBe(0)
    expect(agg.machineVerified).toBe(0)
    expect(agg.humanOverridden).toBe(0)
    expect(agg.hardTasks).toEqual([])
  })

  it('sums rework rounds and failed verdicts across tasks', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', {
        struggleTrail: {
          reworkRounds: [
            { round: 1, failed: 2 },
            { round: 2, failed: 1 },
          ],
          sendBacks: [],
          followUps: [],
          pullRequests: [],
          reopens: [],
        },
      }),
      status('LUM-2', 'two', {
        struggleTrail: {
          reworkRounds: [{ round: 1, failed: 3 }],
          sendBacks: [],
          followUps: [],
          pullRequests: [],
          reopens: [],
        },
      }),
    ])
    expect(agg.reworkRounds).toBe(3)
    expect(agg.failedVerdicts).toBe(6)
    expect(agg.tasksWithStruggle).toBe(2)
  })

  it('splits send-backs into open vs resolved', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', {
        struggleTrail: {
          reworkRounds: [],
          sendBacks: [
            {
              criterionId: 'c1',
              statement: 's',
              status: 'open',
              failedAtRound: 1,
              resolvedAtRound: null,
            },
            {
              criterionId: 'c2',
              statement: 's',
              status: 'resolved',
              failedAtRound: 1,
              resolvedAtRound: 2,
            },
          ],
          followUps: [],
          pullRequests: [],
          reopens: [],
        },
      }),
    ])
    expect(agg.openSendBacks).toBe(1)
    expect(agg.resolvedSendBacks).toBe(1)
  })

  it('counts reopens, follow-ups, and extra PR cycles (beyond the first PR)', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', {
        struggleTrail: {
          reworkRounds: [],
          sendBacks: [],
          followUps: [{ criterionId: 'c1', statement: 's', round: 1 }],
          pullRequests: [
            { number: 1, url: 'u1' },
            { number: 2, url: 'u2' },
            { number: 3, url: 'u3' },
          ],
          reopens: [{ from: 'DONE', to: 'IN_PROGRESS', at: 't' }],
        },
      }),
    ])
    expect(agg.followUps).toBe(1)
    expect(agg.reopens).toBe(1)
    expect(agg.extraPrCycles).toBe(2) // 3 PRs → 2 extra cycles
  })

  it('rolls up machine-verified vs human-overridden counts', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', {
        machineVerification: {
          total: 3,
          machineVerified: 2,
          humanOverridden: 1,
        },
      }),
      status('LUM-2', 'two', {
        machineVerification: {
          total: 2,
          machineVerified: 1,
          humanOverridden: 1,
        },
      }),
    ])
    expect(agg.machineTotal).toBe(5)
    expect(agg.machineVerified).toBe(3)
    expect(agg.humanOverridden).toBe(2)
  })

  it('lists only the hard tasks (those carrying a negative signal) with per-task detail', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-CLEAN', 'clean'),
      status('LUM-HARD', 'hard', {
        struggleTrail: {
          reworkRounds: [{ round: 1, failed: 1 }],
          sendBacks: [
            {
              criterionId: 'c1',
              statement: 's',
              status: 'open',
              failedAtRound: 1,
              resolvedAtRound: null,
            },
          ],
          followUps: [],
          pullRequests: [
            { number: 1, url: 'u1' },
            { number: 2, url: 'u2' },
          ],
          reopens: [{ from: 'IN_REVIEW', to: 'IN_PROGRESS', at: 't' }],
        },
        machineVerification: {
          total: 1,
          machineVerified: 0,
          humanOverridden: 1,
        },
      }),
    ])
    expect(agg.hardTasks).toHaveLength(1)
    expect(agg.hardTasks[0]).toMatchObject({
      identifier: 'LUM-HARD',
      title: 'hard',
      reworkRounds: 1,
      openSendBacks: 1,
      reopens: 1,
      extraPrCycles: 1,
      humanOverridden: 1,
    })
  })

  it('flags a task as struggling when only a human override carries it (no FAIL)', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', {
        machineVerification: {
          total: 1,
          machineVerified: 0,
          humanOverridden: 1,
        },
      }),
    ])
    expect(agg.tasksWithStruggle).toBe(1)
    expect(agg.hardTasks).toHaveLength(1)
  })
})
