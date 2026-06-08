import { rangeBandGeometry } from '@/lib/forecast/range-band'

const iv = (p25: number, median: number, p75: number) => ({ p25, median, p75 })

describe('rangeBandGeometry', () => {
  it('anchors the IQR to a fixed central window regardless of actual', () => {
    const g = rangeBandGeometry(iv(1500, 2234, 2800), 2400)
    expect(g.iqrLeft).toBe(30)
    expect(g.iqrRight).toBe(30)
  })

  it('places an in-range actual inside the window without a caret', () => {
    const g = rangeBandGeometry(iv(1500, 2234, 2800), 2400)
    expect(g.overflow).toBeNull()
    expect(g.actualPos).toBeGreaterThan(30)
    expect(g.actualPos).toBeLessThan(70)
  })

  it('clamps a far over-budget actual to the right edge and flags right overflow', () => {
    const g = rangeBandGeometry(iv(1500, 2234, 2800), 4906)
    expect(g.overflow).toBe('right')
    expect(g.actualPos).toBe(94)
  })

  it('clamps an extreme under-budget actual and flags left overflow', () => {
    const g = rangeBandGeometry(iv(1500, 2234, 2800), 0)
    expect(g.overflow).toBe('left')
    expect(g.actualPos).toBe(6)
  })

  it('keeps a mild below-range actual on-scale without a caret', () => {
    const g = rangeBandGeometry(iv(1500, 2234, 2800), 1000)
    expect(g.overflow).toBeNull()
    expect(g.actualPos).toBeGreaterThan(6)
    expect(g.actualPos).toBeLessThan(30)
  })

  it('never lets the marker reach the clipping edges', () => {
    for (const actual of [-1e9, 0, 5000, 1e9]) {
      const g = rangeBandGeometry(iv(1000, 2000, 3000), actual)
      expect(g.actualPos).toBeGreaterThanOrEqual(6)
      expect(g.actualPos).toBeLessThanOrEqual(94)
    }
  })

  it('handles a degenerate zero-width IQR without dividing by zero', () => {
    const g = rangeBandGeometry(iv(2000, 2000, 2000), 2000)
    expect(g.medianPos).toBe(50)
    expect(Number.isFinite(g.actualPos)).toBe(true)
    expect(rangeBandGeometry(iv(2000, 2000, 2000), 3000).overflow).toBe('right')
    expect(rangeBandGeometry(iv(2000, 2000, 2000), 1000).overflow).toBe('left')
  })
})
