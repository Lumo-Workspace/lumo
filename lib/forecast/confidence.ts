import type { ForecastConfidence } from './types'

// Sample-size thresholds for the confidence badge. They sit above the MIN_COHORT
// floor (3): a forecast resting on a handful of tasks is honestly "low", and
// only a broad sample earns "high". Tuned for current project scale (tens of
// completed tasks), not a statistical guarantee.
export const CONFIDENCE_MEDIUM_MIN = 6
export const CONFIDENCE_HIGH_MIN = 12

/**
 * Derive how much historical evidence backs a forecast from the sample sizes
 * feeding its displayed tracks (e.g. cohort size, token-cost basis). We take
 * the LARGEST sample: a well-supported token forecast shouldn't be marked
 * "low" just because the similarity cohort happens to be thin — the badge
 * reflects the strongest leg the reader can lean on. Empty input → 'low'.
 */
export function deriveConfidence(samples: number[]): ForecastConfidence {
  const n = samples.length > 0 ? Math.max(...samples) : 0
  if (n >= CONFIDENCE_HIGH_MIN) return 'high'
  if (n >= CONFIDENCE_MEDIUM_MIN) return 'medium'
  return 'low'
}
