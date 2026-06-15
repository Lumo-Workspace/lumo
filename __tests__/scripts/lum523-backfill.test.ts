import { computeBatchDeltasForSession } from '@/scripts/migrations/lum523-backfill-batch-usage'

const m = (input: number, output = 0, cacheRead = 0, cacheCreation = 0) => ({
  'claude-opus-4-8': { input, output, cacheRead, cacheCreation },
})

describe('computeBatchDeltasForSession', () => {
  it('diffs each batch cumulative against the previous snapshot batch or STOP', () => {
    const rows = [
      { id: 'stop0', type: 'STOP', cumulative: m(0, 100) },
      { id: 'b1', type: 'POST_TOOL_BATCH', cumulative: m(0, 110) },
      { id: 'b2', type: 'POST_TOOL_BATCH', cumulative: m(0, 130) },
      { id: 'stop1', type: 'STOP', cumulative: m(0, 140) },
    ]
    const deltas = computeBatchDeltasForSession(rows)
    expect(deltas.get('b1')).toEqual(m(0, 10))
    expect(deltas.get('b2')).toEqual(m(0, 20))
    expect(deltas.has('stop1')).toBe(false)
  })

  it('clamps compaction shrink to zero', () => {
    const rows = [
      { id: 'b1', type: 'POST_TOOL_BATCH', cumulative: m(0, 0, 5000) },
      { id: 'b2', type: 'POST_TOOL_BATCH', cumulative: m(0, 0, 1000) },
    ]
    const deltas = computeBatchDeltasForSession(rows)
    expect(deltas.get('b2')).toEqual(m(0, 0, 0))
  })
})
