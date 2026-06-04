// Viewport-aware positioning for the mention/slash suggestion popups.
//
// The editor renders these popups in a `position: fixed` portal anchored to the
// caret rect. A naive `top: rect.bottom` placement gets clipped when the caret
// sits near the bottom of the viewport. This helper decides between a below /
// above placement (flip) and clamps the final coordinates into the visible area
// so the popup is never cut off by a viewport edge.
//
// Kept as a pure function (no DOM, no React) so the flip/clamp logic is unit
// testable in isolation.

export interface PopupPositionInput {
  /** Caret/anchor rect in viewport coordinates (from getBoundingClientRect). */
  anchorRect: { top: number; bottom: number; left: number }
  /** Measured popup size. */
  popupSize: { width: number; height: number }
  /** Viewport size (window.innerWidth / innerHeight). */
  viewport: { width: number; height: number }
  /** Gap between the anchor and the popup. */
  gap?: number
  /** Minimum distance to keep from every viewport edge. */
  margin?: number
}

export interface PopupPosition {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

const DEFAULT_GAP = 6
const DEFAULT_MARGIN = 8

/**
 * Clamp `value` into the inclusive range [min, max]. If the range is inverted
 * (max < min, i.e. the popup is larger than the available space) we pin to
 * `min` so the popup's top/left edge stays visible.
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export function computePopupPosition({
  anchorRect,
  popupSize,
  viewport,
  gap = DEFAULT_GAP,
  margin = DEFAULT_MARGIN,
}: PopupPositionInput): PopupPosition {
  // Available room for the popup body on each side of the anchor.
  const spaceBelow = viewport.height - margin - (anchorRect.bottom + gap)
  const spaceAbove = anchorRect.top - gap - margin

  // Flip-first: prefer below, but flip above when below can't fit the popup and
  // above genuinely has more room. Otherwise stay below and clamp.
  const placement: 'top' | 'bottom' =
    popupSize.height > spaceBelow && spaceAbove > spaceBelow ? 'top' : 'bottom'

  const rawTop =
    placement === 'top'
      ? anchorRect.top - gap - popupSize.height
      : anchorRect.bottom + gap

  const top = clamp(
    rawTop,
    margin,
    viewport.height - margin - popupSize.height
  )
  const left = clamp(
    anchorRect.left,
    margin,
    viewport.width - margin - popupSize.width
  )

  return { top, left, placement }
}
