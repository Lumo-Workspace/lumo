import { percentile, interval } from '@/lib/forecast/percentile'

describe('percentile', () => {
  it('returns the single value for a one-element sample', () => {
    expect(percentile([5], 0.25)).toBe(5)
    expect(percentile([5], 0.5)).toBe(5)
    expect(percentile([5], 0.75)).toBe(5)
  })

  it('computes linear-interpolated quantiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2)
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4)
  })

  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75)
  })

  it('sorts unsorted input', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
  })

  it('throws on empty input', () => {
    expect(() => percentile([], 0.5)).toThrow()
  })
})

describe('interval', () => {
  it('returns p25/median/p75', () => {
    expect(interval([1, 2, 3, 4, 5])).toEqual({ p25: 2, median: 3, p75: 4 })
  })
})
