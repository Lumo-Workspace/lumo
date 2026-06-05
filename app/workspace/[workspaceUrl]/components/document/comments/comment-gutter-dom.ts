import type { ApiDocumentComment } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

/** Vertical offset (px) of `el`'s top relative to `rowEl`'s top. */
export function measureAnchorTop(el: Element, rowEl: Element): number {
  return el.getBoundingClientRect().top - rowEl.getBoundingClientRect().top
}

export interface AnchorPosition {
  id: string
  anchorY: number
}

/**
 * For each OPEN comment, find its `span[data-comment-id]` in the editor DOM and
 * measure its top relative to `rowEl`. A missing span (mark deleted / orphaned)
 * yields `anchorY = +Infinity` so the layout stacks it at the bottom.
 */
export function collectOpenCommentAnchors(
  viewDom: HTMLElement,
  rowEl: Element,
  comments: ApiDocumentComment[]
): AnchorPosition[] {
  return comments
    .filter(c => c.status === 'OPEN')
    .map(c => {
      const span = viewDom.querySelector(`span[data-comment-id="${c.id}"]`)
      return {
        id: c.id,
        anchorY: span
          ? measureAnchorTop(span, rowEl)
          : Number.POSITIVE_INFINITY,
      }
    })
}
