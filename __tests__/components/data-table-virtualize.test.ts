import { shouldVirtualize, LIST_VIRTUALIZE_THRESHOLD } from '@/lib/utils/shouldVirtualize'

describe('DataTable virtualization gating', () => {
  it('does not virtualize at or below threshold', () => {
    expect(shouldVirtualize(LIST_VIRTUALIZE_THRESHOLD, LIST_VIRTUALIZE_THRESHOLD)).toBe(false)
  })
  it('virtualizes above threshold', () => {
    expect(shouldVirtualize(LIST_VIRTUALIZE_THRESHOLD + 1, LIST_VIRTUALIZE_THRESHOLD)).toBe(true)
  })
})
