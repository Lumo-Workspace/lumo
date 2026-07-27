import {
  resolveInsertTarget,
  dedupeSortedCoords,
} from '@/lib/editor/table/resolve-insert-target'

// 3-column / 2-row table. Column boundaries at x = 0,100,200,300.
// Row boundaries at y = 0,40,80. Table spans (0,0)→(300,80).
const tableRect = { left: 0, top: 0, right: 300, bottom: 80 }
const columnBoundaries = [0, 100, 200, 300]
const rowBoundaries = [0, 40, 80]
const base = { tableRect, columnBoundaries, rowBoundaries }

describe('resolveInsertTarget', () => {
  it('returns null when pointer is in the table interior (no edge band)', () => {
    expect(
      resolveInsertTarget({ ...base, pointer: { x: 150, y: 40 } })
    ).toBeNull()
  })

  it('resolves an inner column boundary near the top edge → after previous column', () => {
    expect(resolveInsertTarget({ ...base, pointer: { x: 201, y: 2 } })).toEqual(
      { axis: 'col', side: 'after', anchorIndex: 1, boundaryCoord: 200 }
    )
  })

  it('resolves the outermost-left column boundary → before column 0', () => {
    expect(resolveInsertTarget({ ...base, pointer: { x: 1, y: 2 } })).toEqual({
      axis: 'col',
      side: 'before',
      anchorIndex: 0,
      boundaryCoord: 0,
    })
  })

  it('resolves the outermost-right column boundary → after last column', () => {
    expect(resolveInsertTarget({ ...base, pointer: { x: 299, y: 2 } })).toEqual(
      { axis: 'col', side: 'after', anchorIndex: 2, boundaryCoord: 300 }
    )
  })

  it('resolves a row boundary near the left edge → after previous row', () => {
    expect(resolveInsertTarget({ ...base, pointer: { x: 2, y: 41 } })).toEqual({
      axis: 'row',
      side: 'after',
      anchorIndex: 0,
      boundaryCoord: 40,
    })
  })

  it('returns null when near the top band but not near any column boundary', () => {
    expect(
      resolveInsertTarget({ ...base, pointer: { x: 150, y: 2 } })
    ).toBeNull()
  })

  it('returns null when columnBoundaries is empty', () => {
    expect(
      resolveInsertTarget({
        ...base,
        columnBoundaries: [],
        rowBoundaries: [],
        pointer: { x: 1, y: 2 },
      })
    ).toBeNull()
  })

  it('corner overlap: pointer in both top band and left band resolves to column (col zone checked first)', () => {
    // pointer (1,1): within top edgeBand (y=1 near tableRect.top=0) AND
    // within left edgeBand (x=1 near tableRect.left=0); nearest column boundary
    // is 0 and nearest row boundary is 0 — column wins because col zone is
    // evaluated first in the function.
    expect(resolveInsertTarget({ ...base, pointer: { x: 1, y: 1 } })).toEqual({
      axis: 'col',
      side: 'before',
      anchorIndex: 0,
      boundaryCoord: 0,
    })
  })
})

describe('dedupeSortedCoords', () => {
  it('sorts ascending', () => {
    expect(dedupeSortedCoords([300, 0, 100])).toEqual([0, 100, 300])
  })

  it('collapses near-duplicates within default tolerance', () => {
    expect(dedupeSortedCoords([0, 0.3, 100, 100.4, 200])).toEqual([0, 100, 200])
  })

  it('keeps coords farther apart than tolerance', () => {
    expect(dedupeSortedCoords([0, 1, 2])).toEqual([0, 1, 2])
  })

  it('returns empty array for empty input', () => {
    expect(dedupeSortedCoords([])).toEqual([])
  })
})
