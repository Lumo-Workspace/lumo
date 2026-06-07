import { tierOf, rankByLineage, type LineageStat } from '@/lib/lineage/ranking'

describe('tierOf', () => {
  it('cold (tier 1) when no stat', () => {
    expect(tierOf(undefined)).toBe(1)
  })
  it('cold (tier 1) below the resolved-tasks floor', () => {
    expect(tierOf({ resolvedTasks: 2, mergedTasks: 2 })).toBe(1)
  })
  it('high (tier 0) at or above 50% with enough samples', () => {
    expect(tierOf({ resolvedTasks: 3, mergedTasks: 2 })).toBe(0) // 66%
    expect(tierOf({ resolvedTasks: 4, mergedTasks: 2 })).toBe(0) // exactly 50% -> high
  })
  it('low (tier 2) below 50% with enough samples', () => {
    expect(tierOf({ resolvedTasks: 4, mergedTasks: 1 })).toBe(2) // 25%
  })
})

describe('rankByLineage', () => {
  const key = (s: string) => s
  const stats = (entries: [string, LineageStat][]) => new Map(entries)

  it('orders high -> cold -> low', () => {
    const items = ['low', 'cold', 'high']
    const out = rankByLineage(
      items,
      key,
      stats([
        ['high', { resolvedTasks: 3, mergedTasks: 3 }], // 100% -> high
        ['low', { resolvedTasks: 4, mergedTasks: 1 }], // 25% -> low
        // 'cold' has no stat -> cold
      ])
    )
    expect(out).toEqual(['high', 'cold', 'low'])
  })

  it('sorts the high tier by merge% descending', () => {
    const out = rankByLineage(
      ['a', 'b'],
      key,
      stats([
        ['a', { resolvedTasks: 4, mergedTasks: 2 }], // 50%
        ['b', { resolvedTasks: 4, mergedTasks: 4 }], // 100%
      ])
    )
    expect(out).toEqual(['b', 'a'])
  })

  it('breaks high-tier ties by evidence (resolvedTasks) descending', () => {
    const out = rankByLineage(
      ['few', 'many'],
      key,
      stats([
        ['few', { resolvedTasks: 3, mergedTasks: 3 }], // 100%, 3 samples
        ['many', { resolvedTasks: 6, mergedTasks: 6 }], // 100%, 6 samples
      ])
    )
    expect(out).toEqual(['many', 'few'])
  })

  it('preserves input order within the cold tier (stable)', () => {
    const out = rankByLineage(['x', 'y', 'z'], key, stats([]))
    expect(out).toEqual(['x', 'y', 'z'])
  })

  it('is the identity permutation when everything is cold', () => {
    const items = ['p', 'q', 'r']
    expect(rankByLineage(items, key, stats([]))).toEqual(items)
  })
})
