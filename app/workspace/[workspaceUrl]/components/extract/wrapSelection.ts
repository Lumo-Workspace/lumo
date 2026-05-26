import type { Editor } from '@tiptap/core'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Serialize the editor to HTML with the current selection wrapped in
 * <span data-extract-pending="true">…</span>. Restores the editor to its
 * pre-call state immediately after serialization (no visible flicker).
 */
export function wrapSelectionWithExtractPending(editor: Editor): string {
  const { from, to } = editor.state.selection
  if (from === to) return editor.getHTML()

  const text = editor.state.doc.textBetween(from, to, '\n', '\n')
  const marker = `__EXTRACT_PENDING_${Date.now()}__`

  editor.chain().insertContentAt({ from, to }, marker).run()
  let html = editor.getHTML()
  editor
    .chain()
    .insertContentAt({ from, to: from + marker.length }, text)
    .run()

  html = html.replace(
    marker,
    `<span data-extract-pending="true">${escapeHtml(text)}</span>`
  )
  return html
}
