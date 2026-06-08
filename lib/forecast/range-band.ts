import type { Interval } from './types'

// The forecast IQR is anchored to a fixed central window [LO, HI] of the bar so
// it stays legible no matter how far the actual lands. (LUM-319 follow-up: a
// huge over-budget actual used to dominate the scale — squashing the IQR to a
// left sliver and clipping the dot at the right edge.) The actual marker is
// clamped within [MARGIN, 100-MARGIN] so it never overflows the container; when
// it would land beyond that, an overflow caret points in its direction and the
// precise magnitude is carried by the deltaPct pill above the bar.
export const BAND_WINDOW_LO = 30
export const BAND_WINDOW_HI = 70
export const BAND_CLAMP_MARGIN = 6

export interface BandGeometry {
  iqrLeft: number // % from the left where the IQR band starts
  iqrRight: number // % from the right where the IQR band ends
  medianPos: number // % position of the median tick
  actualPos: number // % position of the actual marker (clamped)
  overflow: 'left' | 'right' | null // actual is off the visible scale
}

/**
 * Geometry for the retrospective token range bar. Pure + deterministic so the
 * clamping / overflow behaviour is unit-testable independently of the DOM.
 */
export function rangeBandGeometry(
  forecast: Interval,
  actual: number
): BandGeometry {
  const iqr = forecast.p75 - forecast.p25

  // Map a value to a bar position, anchoring p25 → LO and p75 → HI. A
  // degenerate (zero-width) IQR can't define a scale, so any value off the
  // single point is treated as off-scale on the matching side.
  const posOf = (v: number): number => {
    if (iqr <= 0) {
      if (v === forecast.p25) return (BAND_WINDOW_LO + BAND_WINDOW_HI) / 2
      return v > forecast.p25 ? 200 : -100
    }
    return (
      BAND_WINDOW_LO + ((v - forecast.p25) / iqr) * (BAND_WINDOW_HI - BAND_WINDOW_LO)
    )
  }
  const clamp = (p: number): number =>
    Math.max(BAND_CLAMP_MARGIN, Math.min(100 - BAND_CLAMP_MARGIN, p))

  const rawActual = posOf(actual)
  const overflow: BandGeometry['overflow'] =
    rawActual > 100 - BAND_CLAMP_MARGIN
      ? 'right'
      : rawActual < BAND_CLAMP_MARGIN
        ? 'left'
        : null

  return {
    iqrLeft: BAND_WINDOW_LO,
    iqrRight: 100 - BAND_WINDOW_HI,
    medianPos: clamp(posOf(forecast.median)),
    actualPos: clamp(rawActual),
    overflow,
  }
}
