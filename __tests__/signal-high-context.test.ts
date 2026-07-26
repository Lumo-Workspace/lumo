import {
  selectHighContextTasks,
  DEFAULT_HIGH_CONTEXT_CONFIG,
  type TaskContextSample,
} from '@/lib/summaries/high-context'
import type { StalledBlockerItem } from '@/types/summary'

const stalled = (id: string): StalledBlockerItem => ({
  id,
  identifier: `LUM-${id}`,
  title: `Task ${id}`,
  updatedAt: '2026-07-15T00:00:00.000Z',
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

describe('selectHighContextTasks', () => {
  it('never classifies a task with unmeasured session context as high-context', () => {
    const items = [stalled('a'), stalled('b')]
    const result = selectHighContextTasks({
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
    const result = selectHighContextTasks({
      stalled: [heavy, stalled('b')],
      context: new Map([
        [
          'a',
          sample('a', { totalTokens: DEFAULT_HIGH_CONTEXT_CONFIG.minTokens }),
        ],
        ['b', sample('b', { totalTokens: 1_000 })],
      ]),
    })
    expect(result).toEqual([heavy])
  })

  it('promotes on turn count when tokens were never measured', () => {
    const looped = stalled('a')
    const result = selectHighContextTasks({
      stalled: [looped],
      context: new Map([
        ['a', sample('a', { loopCount: DEFAULT_HIGH_CONTEXT_CONFIG.minLoops })],
      ]),
    })
    expect(result).toEqual([looped])
  })

  it('only ever selects from the stalled set, ranked by weight and capped', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map(stalled)
    const context = new Map(
      items.map((it, i) => [it.id, sample(it.id, { totalTokens: 300_000 + i })])
    )
    // A heavy task that is not stalled must not leak in.
    context.set('zz', sample('zz', { totalTokens: 9_000_000 }))

    const result = selectHighContextTasks({ stalled: items, context })

    expect(result).toHaveLength(DEFAULT_HIGH_CONTEXT_CONFIG.maxItems)
    expect(result.map(r => r.id)).toEqual(['e', 'd', 'c', 'b'])
    expect(result.every(r => items.includes(r))).toBe(true)
  })
})
