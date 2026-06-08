import { progressMetric } from '@/lib/forecast/progress-metric'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

describe('progressMetric', () => {
  it('on-track when actual is within the band, no deltaPct', () => {
    const m = progressMetric(iv(12, 22, 35), 18)
    expect(m.band).toBe('on-track')
    expect(m.deltaPct).toBeNull()
  })

  it('on-track (NOT below) when actual is under p25 — partial mid-flight value', () => {
    const m = progressMetric(iv(12, 22, 35), 8)
    expect(m.band).toBe('on-track')
    expect(m.deltaPct).toBeNull()
  })

  it('on-track at the p75 boundary (strictly greater triggers over)', () => {
    expect(progressMetric(iv(12, 22, 35), 35).band).toBe('on-track')
  })

  it('over when actual exceeds p75, with deltaPct from median', () => {
    const m = progressMetric(iv(12, 22, 35), 52)
    expect(m.band).toBe('over')
    expect(m.deltaPct).toBe(136) // round((52-22)/22*100)
  })

  it('over with median 0 yields null deltaPct (no divide-by-zero)', () => {
    expect(progressMetric(iv(0, 0, 1), 5).deltaPct).toBeNull()
  })

  it('degrades when forecast is null', () => {
    expect(progressMetric(null, 10)).toEqual({
      forecast: null,
      actual: 10,
      deltaPct: null,
      band: null,
    })
  })

  it('degrades when actual is null', () => {
    const m = progressMetric(iv(1, 2, 3), null)
    expect(m.band).toBeNull()
    expect(m.actual).toBeNull()
  })
})
