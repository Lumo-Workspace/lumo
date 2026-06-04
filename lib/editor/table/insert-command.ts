import type { Editor } from '@tiptap/core'
import type { InsertAxis } from './resolve-insert-target'

export interface InsertMarker {
  axis: InsertAxis
  side: 'before' | 'after'
  anchorIndex: number
  /** container-relative px: center of the + button (also the line's anchor end) */
  left: number
  top: number
  /** px length of the positioning line along the table edge */
  lineLength: number
  /** viewport coords of the anchor cell's center, for posAtCoords */
  cellPoint: { x: number; y: number }
}

/**
 * Place the editor selection inside the anchor cell, then run the stock
 * Tiptap insert command for the marker's axis + side. No-op if the cell
 * point can't be mapped to a document position.
 */
export function runTableInsert(editor: Editor, marker: InsertMarker): void {
  const resolved = editor.view.posAtCoords({
    left: marker.cellPoint.x,
    top: marker.cellPoint.y,
  })
  if (!resolved) return

  const chain = editor.chain().focus().setTextSelection(resolved.pos)
  if (marker.axis === 'col') {
    if (marker.side === 'before') chain.addColumnBefore().run()
    else chain.addColumnAfter().run()
  } else {
    if (marker.side === 'before') chain.addRowBefore().run()
    else chain.addRowAfter().run()
  }
}
