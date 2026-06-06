import '@/lib/editor/marks/comment-mark'
import type { Editor } from '@tiptap/core'

const ACTIVE_CLASS = 'comment-highlight--active'
const RESOLVED_CLASS = 'comment-highlight--resolved'
const SELECTOR = 'span[data-comment-id]'

/** Walk up from a clicked node/element to the enclosing comment span's id, or null. */
export function commentIdFromEventTarget(
  target: EventTarget | Node | null
): string | null {
  const el =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null
  const span = el?.closest(SELECTOR) ?? null
  return span?.getAttribute('data-comment-id') ?? null
}

function editorDom(editor: Editor): HTMLElement | null {
  return (
    (editor as unknown as { view?: { dom?: HTMLElement } }).view?.dom ?? null
  )
}

/** Toggle the active emphasis class so only the given comment id's spans are active. */
export function setActiveEditorAnchor(
  editor: Editor,
  commentId: string | null
): void {
  const dom = editorDom(editor)
  if (!dom) return
  dom
    .querySelectorAll(`${SELECTOR}.${ACTIVE_CLASS}`)
    .forEach(s => s.classList.remove(ACTIVE_CLASS))
  if (commentId) {
    dom
      .querySelectorAll(`${SELECTOR}[data-comment-id="${commentId}"]`)
      .forEach(s => s.classList.add(ACTIVE_CLASS))
  }
}

/**
 * Reflect resolved-thread state onto the inline spans. A resolved comment keeps
 * its span in the document (resolve is reversible from the gutter's resolved
 * section), so we can't strip it like a delete does — instead we toggle a class
 * that hides the highlight via CSS. View-only DOM mutation (no ProseMirror
 * transaction), so it never triggers a content save, mirroring
 * setActiveEditorAnchor.
 */
export function setResolvedEditorAnchors(
  editor: Editor,
  resolvedIds: Iterable<string>
): void {
  const dom = editorDom(editor)
  if (!dom) return
  const resolved = new Set(resolvedIds)
  dom.querySelectorAll(SELECTOR).forEach(span => {
    const id = span.getAttribute('data-comment-id')
    span.classList.toggle(RESOLVED_CLASS, !!id && resolved.has(id))
  })
}

/**
 * Delete a comment, then drop its inline mark from the live editor — the
 * delete-path twin of setResolvedEditorAnchors. The server strips the anchor
 * span from stored content on a successful delete, but the open ProseMirror
 * instance keeps the mark until it remounts, so the body highlight would linger.
 *
 * Two deliberate choices:
 * - Unlike resolve (a reversible class toggle), a delete is permanent, so we
 *   remove the mark from the document model via editor.commands.unsetComment. A
 *   pure DOM unwrap would desync ProseMirror state and the span would reappear.
 * - We strip ONLY after the server confirms the delete (the await rejects
 *   otherwise). unsetComment dispatches a transaction that persists a content
 *   save; stripping optimistically would orphan a still-live comment if the
 *   delete then failed.
 */
export async function deleteCommentAndStripAnchor(
  editor: Editor | null,
  commentId: string,
  deleteComment: (commentId: string) => Promise<void>
): Promise<void> {
  await deleteComment(commentId)
  editor?.commands.unsetComment(commentId)
}

/**
 * Reconcile the open editor with a server-confirmed doc-comment Pusher event.
 * A `doc-comment:deleted` event means the server already stripped the anchor
 * span from stored content, so we drop the matching mark from the live editor —
 * this is what clears a REMOTE delete's lingering highlight (our own delete is
 * already handled synchronously by deleteCommentAndStripAnchor, for which this
 * no-ops since the mark is gone). Only deletes strip; create/resolve/reopen are
 * reconciled by the comments refetch. The event is server-confirmed (the comment
 * is truly gone), so unsetComment here can't orphan a live comment.
 */
export function reconcileEditorOnDocCommentEvent(
  editor: Editor | null,
  event: { type?: string; commentId?: string }
): void {
  if (event.type === 'doc-comment:deleted' && event.commentId) {
    editor?.commands.unsetComment(event.commentId)
  }
}

/** Briefly flash the given comment's spans (mirrors the task-comment 1.5s flash). */
export function flashEditorAnchor(editor: Editor, commentId: string): void {
  const dom = editorDom(editor)
  if (!dom) return
  const spans = dom.querySelectorAll(
    `${SELECTOR}[data-comment-id="${commentId}"]`
  )
  spans.forEach(s => s.classList.add(ACTIVE_CLASS))
  setTimeout(() => spans.forEach(s => s.classList.remove(ACTIVE_CLASS)), 1500)
}

type DocEventish = { type?: string; [key: string]: unknown }
/** True when a pusher document event concerns comments and should refetch. */
export function docCommentEventNeedsRefetch(event: DocEventish): boolean {
  return (
    typeof event?.type === 'string' && event.type.startsWith('doc-comment:')
  )
}
