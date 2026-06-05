/** Viewport rect (subset) returned by ProseMirror's `view.coordsAtPos`. */
export interface PosCoords {
  top: number
  bottom: number
  left: number
  right: number
}

/** Anchor rect consumed by {@link computePopupPosition} / EditorSuggestionPopup. */
export interface AnchorRect {
  top: number
  bottom: number
  left: number
}

/**
 * Derive the new-comment composer's anchor rect from a text selection: pin the
 * top-left to the selection start and let the bottom reach the selection end so
 * the popup placement (flip/clamp) accounts for the full selected span.
 *
 * Pure — takes a `coordsAtPos` resolver (ProseMirror `view.coordsAtPos`) so the
 * mapping is unit testable without a live editor/layout.
 */
export function selectionAnchorRect(
  coordsAtPos: (pos: number) => PosCoords,
  from: number,
  to: number
): AnchorRect {
  const start = coordsAtPos(from)
  const end = coordsAtPos(to)
  return { top: start.top, bottom: end.bottom, left: start.left }
}
