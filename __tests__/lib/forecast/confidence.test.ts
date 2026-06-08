import {
  deriveConfidence,
  CONFIDENCE_MEDIUM_MIN,
  CONFIDENCE_HIGH_MIN,
} from '@/lib/forecast/confidence'

describe('deriveConfidence', () => {
  it('returns low for an empty sample list', () => {
    expect(deriveConfidence([])).toBe('low')
  })

  it('returns low below the medium threshold', () => {
    expect(deriveConfidence([CONFIDENCE_MEDIUM_MIN - 1])).toBe('low')
    expect(deriveConfidence([0, 3])).toBe('low')
  })

  it('returns medium between the medium and high thresholds', () => {
    expect(deriveConfidence([CONFIDENCE_MEDIUM_MIN])).toBe('medium')
    expect(deriveConfidence([CONFIDENCE_HIGH_MIN - 1])).toBe('medium')
  })

  it('returns high at or above the high threshold', () => {
    expect(deriveConfidence([CONFIDENCE_HIGH_MIN])).toBe('high')
    expect(deriveConfidence([100])).toBe('high')
  })

  it('takes the strongest leg — a thin cohort does not drag down a broad token basis', () => {
    expect(deriveConfidence([3, CONFIDENCE_HIGH_MIN])).toBe('high')
  })
})
