import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { resolveInsertTarget, dedupeSortedCoords } from '@/lib/editor/table/resolve-insert-target'
import { runTableInsert, type InsertMarker } from '@/lib/editor/table/insert-command'

/** Measure the hovered table and resolve a marker, or null. */
function computeMarker(
  table: HTMLElement,
  container: HTMLElement,
  clientX: number,
  clientY: number
): InsertMarker | null {
  // Only this table's own rows — `:scope >` prevents descending into a
  // nested table inside a cell (which would over-collect rows and break
  // boundary math).
  const rows = Array.from(
    table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr')
  ) as HTMLElement[]
  if (rows.length === 0) return null

  const cells = rows.flatMap(r => Array.from(r.children) as HTMLElement[])
  if (cells.length === 0) return null

  const tableRect = table.getBoundingClientRect()

  // Column/row grid lines = the union of every cell's edges, deduped. Robust
  // to merged cells: a boundary hidden by a colspan/rowspan in one row is still
  // contributed by another row.
  const rects = cells.map(c => c.getBoundingClientRect())
  const columnBoundaries = dedupeSortedCoords(rects.flatMap(r => [r.left, r.right]))
  const rowBoundaries = dedupeSortedCoords(rects.flatMap(r => [r.top, r.bottom]))

  const target = resolveInsertTarget({
    pointer: { x: clientX, y: clientY },
    tableRect,
    columnBoundaries,
    rowBoundaries,
  })
  if (!target) return null

  const EPS = 4
  const midX = (tableRect.left + tableRect.right) / 2
  const midY = (tableRect.top + tableRect.bottom) / 2
  const containerRect = container.getBoundingClientRect()

  if (target.axis === 'col') {
    // 'before' → point just right of the boundary (into the first column);
    // 'after'  → point just left of the boundary (into the anchor column).
    const x = target.side === 'before' ? target.boundaryCoord + EPS : target.boundaryCoord - EPS
    return {
      axis: 'col',
      side: target.side,
      anchorIndex: target.anchorIndex,
      left: target.boundaryCoord - containerRect.left,
      top: tableRect.top - containerRect.top,
      lineLength: tableRect.height,
      cellPoint: { x, y: midY },
    }
  }

  const y = target.side === 'before' ? target.boundaryCoord + EPS : target.boundaryCoord - EPS
  return {
    axis: 'row',
    side: target.side,
    anchorIndex: target.anchorIndex,
    left: tableRect.left - containerRect.left,
    top: target.boundaryCoord - containerRect.top,
    lineLength: tableRect.width,
    cellPoint: { x: midX, y },
  }
}

/**
 * Tracks the hovered table edge and exposes a marker + an insert action.
 * Binds mousemove/leave on the editor DOM; clears the marker on scroll/resize
 * (a stale marker would float away from its boundary — re-derived on next move).
 */
export function useTableInsertHandles(
  editor: Editor | null,
  containerRef: RefObject<HTMLElement | null>
) {
  const [marker, setMarker] = useState<InsertMarker | null>(null)

  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom as HTMLElement

    const onMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      const table = (e.target as HTMLElement | null)?.closest?.('table') as
        | HTMLElement
        | null
      if (!table || !dom.contains(table)) {
        setMarker(null)
        return
      }
      setMarker(computeMarker(table, container, e.clientX, e.clientY))
    }
    const clear = () => setMarker(null)

    dom.addEventListener('mousemove', onMove)
    dom.addEventListener('mouseleave', clear)
    // capture:true because blur doesn't bubble; catches focus leaving the editor
    dom.addEventListener('blur', clear, true)
    // capture:true catches scrolls on any ancestor scroll container
    window.addEventListener('scroll', clear, true)
    const ro = new ResizeObserver(clear)
    ro.observe(dom)

    return () => {
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', clear)
      dom.removeEventListener('blur', clear, true)
      window.removeEventListener('scroll', clear, true)
      ro.disconnect()
    }
  }, [editor, containerRef])

  const onInsert = useCallback(() => {
    if (!editor || !marker) return
    runTableInsert(editor, marker)
    setMarker(null)
  }, [editor, marker])

  return { marker, onInsert }
}
