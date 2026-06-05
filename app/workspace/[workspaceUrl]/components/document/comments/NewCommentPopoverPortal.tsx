'use client'
import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { WorkspaceMemberInfo } from '@/app/workspace/[workspaceUrl]/types'
import { EditorSuggestionPopup } from '../../EditorSuggestionPopup'
import { NewCommentPopover } from './NewCommentPopover'
import { selectionAnchorRect, type AnchorRect } from './comment-anchor-rect'

export interface NewCommentPopoverPortalProps {
  editor: Editor
  from: number
  to: number
  quotedText: string
  members?: WorkspaceMemberInfo[] | undefined
  onCancel: () => void
  onSubmit: (body: string) => void
}

/**
 * Floating new-comment composer anchored to the text selection. Unlike the
 * gutter cards it lives in a viewport-fixed portal (via EditorSuggestionPopup),
 * so it flips/clamps into view instead of being clipped by the narrow rail, and
 * works at every breakpoint — including widths where the xl-only gutter is
 * hidden. Tracks scroll/resize so it stays pinned to the selection.
 */
export function NewCommentPopoverPortal({
  editor,
  from,
  to,
  quotedText,
  members,
  onCancel,
  onSubmit,
}: NewCommentPopoverPortalProps) {
  const [rect, setRect] = useState<AnchorRect | null>(null)

  useEffect(() => {
    const update = () => {
      try {
        setRect(selectionAnchorRect(p => editor.view.coordsAtPos(p), from, to))
      } catch {
        // Position can be transiently invalid (e.g. mid content swap) — drop
        // the composer's placement rather than throwing during measurement.
        setRect(null)
      }
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [editor, from, to])

  if (!rect) return null

  return (
    <EditorSuggestionPopup anchorRect={rect} className='w-80'>
      <NewCommentPopover
        open
        quotedText={quotedText}
        onCancel={onCancel}
        onSubmit={onSubmit}
        {...(members ? { members } : {})}
      />
    </EditorSuggestionPopup>
  )
}
