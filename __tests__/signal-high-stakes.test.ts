import {
  selectHighStakesStalls,
  DEFAULT_HIGH_STAKES_CONFIG,
  type TaskContextSample,
} from '@/lib/summaries/high-stakes'
import type { StalledBlockerItem } from '@/types/summary'

const stalled = (
  id: string,
  priority: StalledBlockerItem['priority'] = 'LOW'
): StalledBlockerItem => ({
  id,
  identifier: `LUM-${id}`,
  title: `Task ${id}`,
  updatedAt: '2026-07-15T00:00:00.000Z',
  priority,
})

const sample = (
  taskId: string,
  over: Partial<TaskContextSample> = {}
): TaskContextSample => ({
  taskId,
  sessionCount: 1,
  loopCount: null,
  totalTokens: null,
  ...over,
})

describe('selectHighStakesStalls', () => {
  it('never classifies a task with unmeasured session context as high-stakes', () => {
    const items = [stalled('a'), stalled('b')]
    const result = selectHighStakesStalls({
      stalled: items,
      context: new Map([
        // Sessions exist, but no STOP hook ever carried usage — unknown cost,
        // not zero cost. Must not be promoted, and must not be compared
        // against the threshold as if it were 0.
        ['a', sample('a', { sessionCount: 12 })],
        // No sample at all — same story.
      ]),
    })
    expect(result).toEqual([])
  })

  it('promotes a stalled task whose measured token spend clears the threshold', () => {
    const heavy = stalled('a')
    const result = selectHighStakesStalls({
      stalled: [heavy, stalled('b')],
      context: new Map([
        [
          'a',
          sample('a', { totalTokens: DEFAULT_HIGH_STAKES_CONFIG.minTokens }),
        ],
        ['b', sample('b', { totalTokens: 1_000 })],
      ]),
    })
    expect(result).toEqual([heavy])
  })

  it('promotes on turn count when tokens were never measured', () => {
    const looped = stalled('a')
    const result = selectHighStakesStalls({
      stalled: [looped],
      context: new Map([
        ['a', sample('a', { loopCount: DEFAULT_HIGH_STAKES_CONFIG.minLoops })],
      ]),
    })
    expect(result).toEqual([looped])
  })

  it('promotes a declared-important stall even with no investment at all', () => {
    // A freshly-filed URGENT task that stalled has nothing sunk into it yet.
    // Requiring investment too would hide exactly the case worth surfacing.
    const urgent = stalled('a', 'URGENT')
    const result = selectHighStakesStalls({
      stalled: [urgent, stalled('b', 'MEDIUM')],
      context: new Map(),
    })
    expect(result).toEqual([urgent])
  })

  it('treats HIGH as declared-important and MEDIUM/LOW as not', () => {
    const promoted = selectHighStakesStalls({
      stalled: [stalled('a', 'HIGH')],
      context: new Map(),
    })
    expect(promoted.map(r => r.id)).toEqual(['a'])

    const skipped = selectHighStakesStalls({
      stalled: [stalled('b', 'MEDIUM'), stalled('c', 'LOW')],
      context: new Map(),
    })
    expect(skipped).toEqual([])
  })

  it('ranks a heavily-invested stall above one that only carries priority', () => {
    const heavy = stalled('a')
    const merelyUrgent = stalled('b', 'URGENT')
    const result = selectHighStakesStalls({
      stalled: [merelyUrgent, heavy],
      context: new Map([['a', sample('a', { totalTokens: 5_000_000 })]]),
    })
    expect(result.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('only ever selects from the stalled set, ranked by weight and capped', () => {
    // Not `.map(stalled)` — map would feed the index in as the priority arg.
    const items = ['a', 'b', 'c', 'd', 'e'].map(id => stalled(id))
    const context = new Map(
      items.map((it, i) => [it.id, sample(it.id, { totalTokens: 300_000 + i })])
    )
    // A heavy task that is not stalled must not leak in.
    context.set('zz', sample('zz', { totalTokens: 9_000_000 }))

    const result = selectHighStakesStalls({
      stalled: items,
      context,
    })

    expect(result).toHaveLength(DEFAULT_HIGH_STAKES_CONFIG.maxItems)
    expect(result.map(r => r.id)).toEqual(['e', 'd', 'c', 'b'])
    expect(result.every(r => items.includes(r))).toBe(true)
  })
})
