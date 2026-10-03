import {
  aggregateRetroStruggle,
  type RetroStruggleInput,
} from '@/lib/services/retro-struggle'

/** Minimal per-task status slice the aggregator consumes. */
function status(
  identifier: string,
  title: string,
  trail: Partial<RetroStruggleInput['struggleTrail']> = {}
): RetroStruggleInput {
  return {
    task: { identifier, title },
    struggleTrail: { pullRequests: [], reopens: [], ...trail },
  }
}

const pr = (n: number) => ({ number: n, url: `https://gh/pr/${n}` })
const reopen = { from: 'IN_REVIEW', to: 'IN_PROGRESS', at: '2026-10-01' }

describe('aggregateRetroStruggle', () => {
  it('reports an all-clean basis when no task carries any negative signal', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', { pullRequests: [pr(1)] }),
      status('LUM-2', 'two'),
    ])
    expect(agg).toEqual({
      tasksConsidered: 2,
      tasksWithStruggle: 0,
      reopens: 0,
      extraPrCycles: 0,
      hardTasks: [],
    })
  })

  it('counts reopens and extra PR cycles (beyond the first PR)', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'one', { pullRequests: [pr(1), pr(2), pr(3)] }),
      status('LUM-2', 'two', { reopens: [reopen, reopen] }),
    ])
    expect(agg.reopens).toBe(2)
    expect(agg.extraPrCycles).toBe(2)
    expect(agg.tasksWithStruggle).toBe(2)
  })

  it('lists only the hard tasks (those carrying a negative signal) with per-task detail', () => {
    const agg = aggregateRetroStruggle([
      status('LUM-1', 'clean', { pullRequests: [pr(1)] }),
      status('LUM-2', 'bounced', {
        reopens: [reopen],
        pullRequests: [pr(4), pr(5)],
      }),
    ])
    expect(agg.hardTasks).toEqual([
      { identifier: 'LUM-2', title: 'bounced', reopens: 1, extraPrCycles: 1 },
    ])
  })
})
