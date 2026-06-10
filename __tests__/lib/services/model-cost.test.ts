import {
  toModelCosts,
  mergeModelCosts,
  withInFlightCost,
} from '@/lib/services/model-cost'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'

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

describe('withInFlightCost', () => {
  const flat = (
    input: number | null,
    output: number | null,
    cacheRead: number | null,
    cacheCreation: number | null
  ) => ({
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
  })

  it('returns null when neither settled nor flat usage exists', () => {
    expect(withInFlightCost(null, flat(null, null, null, null))).toBeNull()
  })

  it('synthesizes a lone in-flight row when nothing is settled yet (long first turn)', () => {
    expect(withInFlightCost(null, flat(100, 50, 10, 5))).toEqual([
      {
        model: IN_FLIGHT_MODEL,
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 5,
        total: 165,
      },
    ])
  })

  it('returns the settled list unchanged when flat equals the settled sum (STOP just ran)', () => {
    const settled = toModelCosts({
      opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
    })!
    expect(withInFlightCost(settled, flat(100, 50, 10, 10))).toBe(settled)
  })

  it('appends the per-kind remainder beyond the settled sum, sorted by total', () => {
    const settled = toModelCosts({
      opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
    })!
    expect(withInFlightCost(settled, flat(150, 60, 1010, 10))).toEqual([
      {
        model: IN_FLIGHT_MODEL,
        input: 50,
        output: 10,
        cacheRead: 1000,
        cacheCreation: 0,
        total: 1060,
      },
      {
        model: 'opus',
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
        total: 170,
      },
    ])
  })

  it('clamps at zero per kind — stale flat columns never produce a negative row', () => {
    const settled = toModelCosts({
      opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
    })!
    expect(withInFlightCost(settled, flat(90, 40, 5, 5))).toBe(settled)
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
