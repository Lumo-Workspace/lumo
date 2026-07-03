import {
  fromRetrospectiveMetric,
  fromSample,
  fromMergeRate,
  noBaseline,
} from '@/lib/baseline/adapters'
import { MIN_BASELINE_SAMPLE } from '@/lib/baseline/types'
import type { RetrospectiveMetric } from '@/lib/forecast/retrospective-types'

describe('baseline adapters', () => {
  describe('fromRetrospectiveMetric', () => {
    it('carries forecast median as base + band + delta', () => {
      const m: RetrospectiveMetric = {
        forecast: { p25: 6, median: 8, p75: 10 },
        actual: 12,
        deltaPct: 50,
        band: 'above',
      }
      const s = fromRetrospectiveMetric(m, 7, 'magnitude')
      expect(s.current).toBe(12)
      expect(s.base).toBe(8)
      expect(s.spread).toEqual({ p25: 6, p75: 10 })
      expect(s.band).toBe('above')
      expect(s.deltaPct).toBe(50)
      expect(s.sampleSize).toBe(7)
      expect(s.deltaKind).toBe('magnitude')
    })

    it('no forecast → base null (暂无基线)', () => {
      const m: RetrospectiveMetric = {
        forecast: null,
        actual: 5,
        deltaPct: null,
        band: null,
      }
      const s = fromRetrospectiveMetric(m, 0, 'magnitude')
      expect(s.current).toBe(5)
      expect(s.base).toBeNull()
      expect(s.band).toBeNull()
    })
  })

  describe('fromSample', () => {
    it('median of prior sample as base, delta computed', () => {
      const s = fromSample(60, [70, 80, 75], 'rate')
      expect(s.current).toBe(60)
      expect(s.base).toBe(75) // median of [70,75,80]
      expect(s.sampleSize).toBe(3)
      expect(s.deltaKind).toBe('rate')
      expect(s.deltaPct).toBe(-20) // (60-75)/75 = -20%
      expect(s.band).toBe('below') // 60 < p25
    })

    it('empty sample → base null', () => {
      const s = fromSample(60, [], 'rate')
      expect(s.base).toBeNull()
      expect(s.sampleSize).toBe(0)
      expect(s.band).toBeNull()
    })

    it('current null → base still present, band null', () => {
      const s = fromSample(null, [70, 80, 75], 'rate')
      expect(s.current).toBeNull()
      expect(s.base).toBe(75)
      expect(s.band).toBeNull()
      expect(s.deltaPct).toBeNull()
    })

    it('base 0 → deltaPct null (no divide-by-zero)', () => {
      const s = fromSample(3, [0, 0, 0], 'magnitude')
      expect(s.base).toBe(0)
      expect(s.deltaPct).toBeNull()
    })
  })

  describe('fromMergeRate', () => {
    it('used vs base rate, rate deltaKind', () => {
      const s = fromMergeRate(0.5, 0.4, 12)
      expect(s.current).toBe(0.5)
      expect(s.base).toBe(0.4)
      expect(s.sampleSize).toBe(12)
      expect(s.deltaKind).toBe('rate')
    })
  })

  describe('noBaseline', () => {
    it('base null, sampleSize 0', () => {
      const s = noBaseline(3)
      expect(s.current).toBe(3)
      expect(s.base).toBeNull()
      expect(s.sampleSize).toBe(0)
      expect(s.band).toBeNull()
      expect(s.deltaPct).toBeNull()
    })
    it('MIN_BASELINE_SAMPLE is a positive int', () => {
      expect(MIN_BASELINE_SAMPLE).toBeGreaterThanOrEqual(1)
    })
  })
})
