import type { Interval } from './types'

/** Linear-interpolation percentile (q in [0,1]) over a numeric sample. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) {
    throw new Error('percentile: empty values')
  }
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const frac = pos - lo
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac
}

/** p25 / median / p75 interval over a numeric sample. */
export function interval(values: number[]): Interval {
  return {
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
  }
}
