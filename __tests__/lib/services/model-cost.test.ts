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

describe('withInFlightCost — per-model attribution via liveUsageByModel', () => {
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

  it('attributes the in-flight diff to its model and folds it into the row', () => {
    const settled = toModelCosts({
      'claude-fable-5': {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheCreation: 10,
      },
    })!
    expect(
      withInFlightCost(settled, flat(150, 80, 40, 30), {
        'claude-fable-5': {
          input: 150,
          output: 80,
          cacheRead: 40,
          cacheCreation: 30,
        },
      })
    ).toEqual([
      {
        model: 'claude-fable-5',
        input: 150,
        output: 80,
        cacheRead: 40,
        cacheCreation: 30,
        total: 300,
        inFlight: {
          input: 50,
          output: 30,
          cacheRead: 30,
          cacheCreation: 20,
          total: 130,
        },
      },
    ])
  })

  it('creates a row for a model seen only in the live map (first turn of that model)', () => {
    const settled = toModelCosts({
      opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
    })!
    expect(
      withInFlightCost(settled, flat(140, 70, 10, 10), {
        haiku: { input: 40, output: 20, cacheRead: 0, cacheCreation: 0 },
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
        model: 'haiku',
        input: 40,
        output: 20,
        cacheRead: 0,
        cacheCreation: 0,
        total: 60,
        inFlight: {
          input: 40,
          output: 20,
          cacheRead: 0,
          cacheCreation: 0,
          total: 60,
        },
      },
    ])
  })

  it('clamps a stale live snapshot below the settled anchor to zero (post-STOP self-heal)', () => {
    const settled = toModelCosts({
      opus: { input: 100, output: 50, cacheRead: 10, cacheCreation: 10 },
    })!
    expect(
      withInFlightCost(settled, flat(100, 50, 10, 10), {
        opus: { input: 80, output: 40, cacheRead: 5, cacheCreation: 5 },
      })
    ).toEqual(settled)
  })

  it('routes any remainder the live map does not cover to the sentinel row', () => {
    expect(
      withInFlightCost(null, flat(150, 0, 0, 0), {
        'claude-fable-5': {
          input: 100,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
        },
      })
    ).toEqual([
      {
        model: 'claude-fable-5',
        input: 100,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 100,
        inFlight: {
          input: 100,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 100,
        },
      },
      {
        model: IN_FLIGHT_MODEL,
        input: 50,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 50,
      },
    ])
  })

  it('sorts rows by combined total including the in-flight share', () => {
    const settled = toModelCosts({
      opus: { input: 170, output: 0, cacheRead: 0, cacheCreation: 0 },
    })!
    const rows = withInFlightCost(settled, flat(470, 0, 0, 0), {
      haiku: { input: 300, output: 0, cacheRead: 0, cacheCreation: 0 },
    })!
    expect(rows.map(r => r.model)).toEqual(['haiku', 'opus'])
  })
})

describe('mergeModelCosts — in-flight sub-objects', () => {
  it('sums inFlight across lists and keeps it attached to the merged row', () => {
    const a = [
      {
        model: 'opus',
        input: 100,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 100,
        inFlight: {
          input: 40,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 40,
        },
      },
    ]
    const b = [
      {
        model: 'opus',
        input: 50,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 50,
        inFlight: {
          input: 10,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 10,
        },
      },
    ]
    expect(mergeModelCosts([a, b])).toEqual([
      {
        model: 'opus',
        input: 150,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 150,
        inFlight: {
          input: 50,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 50,
        },
      },
    ])
  })

  it('omits inFlight when no contributing list carries one', () => {
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
    const merged = mergeModelCosts([a])
    expect(merged[0]).not.toHaveProperty('inFlight')
  })
})
