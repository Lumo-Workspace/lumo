import { computePopupPosition } from '@/lib/editor/popup-position'

// Helper to build an anchor rect with sensible defaults.
function anchor(partial: Partial<{ top: number; bottom: number; left: number }>) {
  return { top: 100, bottom: 120, left: 50, ...partial }
}

describe('computePopupPosition', () => {
  const viewport = { width: 1000, height: 800 }
  const popupSize = { width: 260, height: 200 }

  it('places the popup below the anchor when there is room', () => {
    const result = computePopupPosition({
      anchorRect: anchor({ bottom: 120 }),
      popupSize,
      viewport,
      gap: 6,
      margin: 8,
    })
    expect(result.placement).toBe('bottom')
    expect(result.top).toBe(126) // bottom + gap
    expect(result.left).toBe(50)
  })

  it('flips above the anchor when there is not enough room below and more room above', () => {
    // Anchor near the bottom edge: below has only ~30px, above has ~700px.
    const result = computePopupPosition({
      anchorRect: anchor({ top: 740, bottom: 760 }),
      popupSize,
      viewport,
      gap: 6,
      margin: 8,
    })
    expect(result.placement).toBe('top')
    // top - gap - popupHeight = 740 - 6 - 200 = 534
    expect(result.top).toBe(534)
  })

  it('keeps the popup below when below is tight but still larger than above', () => {
    // Anchor near the top: below has more room than above even if not a perfect fit.
    const result = computePopupPosition({
      anchorRect: anchor({ top: 20, bottom: 40 }),
      popupSize: { width: 260, height: 900 }, // taller than viewport
      viewport,
      gap: 6,
      margin: 8,
    })
    expect(result.placement).toBe('bottom')
  })

  it('clamps the left edge into the viewport when the anchor is near the right edge', () => {
    const result = computePopupPosition({
      anchorRect: anchor({ left: 950 }),
      popupSize,
      viewport,
      gap: 6,
      margin: 8,
    })
    // 950 + 260 = 1210 overflows; clamp to viewport.width - margin - width = 1000 - 8 - 260 = 732
    expect(result.left).toBe(732)
  })

  it('clamps the left edge to the margin when the anchor is off the left edge', () => {
    const result = computePopupPosition({
      anchorRect: anchor({ left: -40 }),
      popupSize,
      viewport,
      gap: 6,
      margin: 8,
    })
    expect(result.left).toBe(8)
  })

  it('clamps a too-tall popup to the top margin instead of overflowing upward', () => {
    // Flipped placement that would push top negative must clamp to margin.
    const result = computePopupPosition({
      anchorRect: anchor({ top: 300, bottom: 320 }),
      popupSize: { width: 260, height: 500 },
      viewport: { width: 1000, height: 360 },
      gap: 6,
      margin: 8,
    })
    expect(result.top).toBeGreaterThanOrEqual(8)
  })

  it('applies default gap and margin when omitted', () => {
    const result = computePopupPosition({
      anchorRect: anchor({ bottom: 120 }),
      popupSize,
      viewport,
    })
    // default gap 6 → top 126
    expect(result.top).toBe(126)
    expect(result.left).toBe(50)
  })
})
