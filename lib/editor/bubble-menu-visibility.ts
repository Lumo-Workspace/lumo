// Pure decision for whether the editor's selection bubble menu should show.
//
// Extracted from the Tiptap `BubbleMenu.shouldShow` closure so the rule is unit
// testable without an editor instance. `suppressed` lets a caller force-hide the
// bubble (e.g. while the new-comment composer is open over the same selection).

export interface BubbleMenuVisibilityInput {
  /** The editor accepts input (not read-only). */
  editable: boolean
  /** The cursor sits inside a table (table ops should stay reachable). */
  isInTable: boolean
  /** The current text selection is collapsed (no range selected). */
  selectionEmpty: boolean
  /** Force-hide regardless of selection (e.g. comment composer open). */
  suppressed: boolean
}

export function shouldShowBubble({
  editable,
  isInTable,
  selectionEmpty,
  suppressed,
}: BubbleMenuVisibilityInput): boolean {
  if (suppressed) return false
  if (!editable) return false
  // Always show when the cursor is inside a table (for table ops).
  if (isInTable) return true
  // Otherwise only show for non-empty text selections.
  return !selectionEmpty
}
