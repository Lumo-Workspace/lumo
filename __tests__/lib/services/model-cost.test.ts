import { toModelCosts, mergeModelCosts } from '@/lib/services/model-cost'

describe('toModelCosts', () => {
  it('returns null for null/empty maps', () => {
    expect(toModelCosts(null)).toBeNull()
    expect(toModelCosts({})).toBeNull()
  })

  it('converts a per-model map to ModelCost[] sorted by total desc', () => {
    expect(
      toModelCosts({
        sonnet: { input: 10, output: 5, cacheRead: 1, cacheCreation: 1 },
        opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
      })
    ).toEqual([
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
      {
        model: 'sonnet',
        input: 10,
        output: 5,
        cacheRead: 1,
        cacheCreation: 1,
        total: 17,
      },
    ])
  })
})

describe('mergeModelCosts', () => {
  it('sums same-model entries across runs and re-sorts', () => {
    const a = [
      {
        model: 'opus',
        input: 10,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 10,
      },
    ]
    const b = [
      {
        model: 'opus',
        input: 5,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 5,
      },
      {
        model: 'sonnet',
        input: 20,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 20,
      },
    ]
    expect(mergeModelCosts([a, b])).toEqual([
      {
        model: 'sonnet',
        input: 20,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 20,
      },
      {
        model: 'opus',
        input: 15,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 15,
      },
    ])
  })
})
