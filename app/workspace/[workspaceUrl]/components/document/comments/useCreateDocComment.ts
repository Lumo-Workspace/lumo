import '@/lib/editor/marks/comment-mark'
import type { Editor } from '@tiptap/core'
import type { CreateDocCommentArgs } from '@/app/workspace/[workspaceUrl]/hooks/useDocumentComments'

export interface PendingComment {
  id: string
  body: string
  from: number
  to: number
  quotedText: string
}

export function buildCreateCommentPayload(
  editor: Editor,
  p: PendingComment
): CreateDocCommentArgs {
  editor
    .chain()
    .setTextSelection({ from: p.from, to: p.to })
    .setComment(p.id)
    .run()
  return {
    id: p.id,
    body: p.body,
    from: p.from,
    to: p.to,
    quotedText: p.quotedText,
    content: editor.getHTML(),
  }
}

export function newCommentId(): string {
  return crypto.randomUUID()
}
