import { computeActiveTocIndex } from '@/lib/editor/toc-active'

// Heading offsetTops mirror a typical document: the first heading sits below
// the title/metadata block, so its offsetTop is > 0 even at scrollTop 0.
const OFFSETS = [120, 600, 1400, 2200]
const metrics = (...offsets: Array<number | null>) =>
  offsets.map(offsetTop => ({ offsetTop }))

const ACTIVE_OFFSET = 80

describe('computeActiveTocIndex', () => {
  it('returns -1 when there are no headings', () => {
    expect(
      computeActiveTocIndex(
        [],
        { scrollTop: 0, clientHeight: 800, scrollHeight: 3000 },
        ACTIVE_OFFSET
      )
    ).toBe(-1)
  })

  it('highlights the last heading when scrolled to the bottom', () => {
    // Container can no longer scroll further: scrollTop + clientHeight reaches
    // scrollHeight. The last heading still sits below the threshold line, but
    // it must win anyway (the previously-fixed "stuck on top heading" bug).
    expect(
      computeActiveTocIndex(
        metrics(...OFFSETS),
        { scrollTop: 2200, clientHeight: 800, scrollHeight: 3000 },
        ACTIVE_OFFSET
      )
    ).toBe(OFFSETS.length - 1)
  })

  it('treats within-2px of the bottom as bottom', () => {
    expect(
      computeActiveTocIndex(
        metrics(...OFFSETS),
        { scrollTop: 2199, clientHeight: 800, scrollHeight: 3000 },
        ACTIVE_OFFSET
      )
    ).toBe(OFFSETS.length - 1)
  })

  it('picks the last heading whose top is at/above the threshold line', () => {
    // scrollTop 650 + 80 = 730. Headings at 120 and 600 are above the line;
    // 1400 is below. Expect index 1.
    expect(
      computeActiveTocIndex(
        metrics(...OFFSETS),
        { scrollTop: 650, clientHeight: 800, scrollHeight: 3000 },
        ACTIVE_OFFSET
      )
    ).toBe(1)
  })

  it('falls back to the first heading at the very top', () => {
    // scrollTop 0 + 80 = 80, but the first heading is at 120 (below the title
    // block), so nothing crosses the line. Must still highlight heading 0
    // rather than leaving nothing active.
    expect(
      computeActiveTocIndex(
        metrics(...OFFSETS),
        { scrollTop: 0, clientHeight: 800, scrollHeight: 3000 },
        ACTIVE_OFFSET
      )
    ).toBe(0)
  })

  it('ignores headings whose element is missing (null offsetTop)', () => {
    // A heading whose DOM element could not be resolved contributes no
    // candidate; the last resolvable heading above the line wins.
    expect(
      computeActiveTocIndex(
        metrics(120, null, 1400, 2200),
        { scrollTop: 1500, clientHeight: 800, scrollHeight: 4000 },
        ACTIVE_OFFSET
      )
    ).toBe(2)
  })
})
