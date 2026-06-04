import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { resolveInsertTarget } from '@/lib/editor/table/resolve-insert-target'
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
  const firstRow = rows[0]
  if (!firstRow) return null
  const headerCells = Array.from(firstRow.children) as HTMLElement[]
  if (headerCells.length === 0) return null

  const tableRect = table.getBoundingClientRect()

  const columnBoundaries: number[] = [headerCells[0]!.getBoundingClientRect().left]
  for (const c of headerCells) columnBoundaries.push(c.getBoundingClientRect().right)

  const rowBoundaries: number[] = [rows[0]!.getBoundingClientRect().top]
  for (const r of rows) rowBoundaries.push(r.getBoundingClientRect().bottom)

  const target = resolveInsertTarget({
    pointer: { x: clientX, y: clientY },
    tableRect,
    columnBoundaries,
    rowBoundaries,
  })
  if (!target) return null

  const containerRect = container.getBoundingClientRect()

  if (target.axis === 'col') {
    const cell = headerCells[target.anchorIndex]
    if (!cell) return null
    const r = cell.getBoundingClientRect()
    return {
      axis: 'col',
      side: target.side,
      anchorIndex: target.anchorIndex,
      left: target.boundaryCoord - containerRect.left,
      top: tableRect.top - containerRect.top,
      lineLength: tableRect.height,
      cellPoint: { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 },
    }
  }

  const row = rows[target.anchorIndex]
  const cell = row?.children[0] as HTMLElement | undefined
  if (!cell) return null
  const r = cell.getBoundingClientRect()
  return {
    axis: 'row',
    side: target.side,
    anchorIndex: target.anchorIndex,
    left: tableRect.left - containerRect.left,
    top: target.boundaryCoord - containerRect.top,
    lineLength: tableRect.width,
    cellPoint: { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 },
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
    // capture:true catches scrolls on any ancestor scroll container
    window.addEventListener('scroll', clear, true)
    const ro = new ResizeObserver(clear)
    ro.observe(dom)

    return () => {
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', clear)
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
