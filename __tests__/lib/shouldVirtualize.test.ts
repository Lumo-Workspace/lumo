import {
  shouldVirtualize,
  LIST_VIRTUALIZE_THRESHOLD,
  BOARD_COLUMN_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'

describe('shouldVirtualize', () => {
  it('returns false at or below the threshold', () => {
    expect(shouldVirtualize(0, 80)).toBe(false)
    expect(shouldVirtualize(80, 80)).toBe(false)
  })

  it('returns true strictly above the threshold', () => {
    expect(shouldVirtualize(81, 80)).toBe(true)
    expect(shouldVirtualize(5000, 80)).toBe(true)
  })

  it('exposes list and board thresholds as constants', () => {
    expect(LIST_VIRTUALIZE_THRESHOLD).toBe(80)
    expect(BOARD_COLUMN_VIRTUALIZE_THRESHOLD).toBe(50)
  })
})
